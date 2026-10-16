import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pending } from '../types'

const isOn = atom({ plugin: 'budget-guard', key: 'isOn' } as const, true)
const pending = atom({ plugin: 'budget-guard', key: 'pending' } as const, null)
// Once the person confirms going over, the spend they allowed before asking again.
const allowUntil = atom({ plugin: 'budget-guard', key: 'allowUntil' } as const, 0)

export const DEFAULT_LIMIT = 25
const WARN_AT = [0.5, 0.8]
const CONFIRM_WINDOW_MS = 3 * 60 * 1000

export function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addSpend(days: Record<string, number>, day: string, usd: number): Record<string, number> {
  const next = { ...days, [day]: (days[day] ?? 0) + usd }
  const keep = Object.keys(next).sort().slice(-14)

  return Object.fromEntries(keep.map(key => [key, next[key] ?? 0]))
}

export function weekChart(days: Record<string, number>, today: number): string {
  const rows: string[] = []
  const values: number[] = []
  for (let i = 6; i >= 0; i -= 1) {
    values.push(days[dayKey(today - i * 86_400_000)] ?? 0)
  }
  const top = Math.max(1, ...values)
  for (let i = 6; i >= 0; i -= 1) {
    const value = values[6 - i] ?? 0
    const label = new Date(today - i * 86_400_000).toDateString().slice(0, 3)
    rows.push(`  ${label} ${'█'.repeat(Math.round((value / top) * 20)).padEnd(20, '·')} $${value.toFixed(2)}`)
  }

  return rows.join('\n')
}

async function daysOf($: EngineInterface): Promise<Record<string, number>> {
  const value = await $.store.get('days')

  return value !== null && typeof value === 'object' ? (value as Record<string, number>) : {}
}

async function limitOf($: EngineInterface): Promise<number> {
  const value = await $.store.get('limit')

  return typeof value === 'number' && value > 0 ? value : DEFAULT_LIMIT
}

let lastCost: number | undefined

async function record($: EngineInterface, cost: number) {
  if (lastCost === undefined || cost < lastCost) {
    lastCost = cost
    return
  }
  const delta = cost - lastCost
  lastCost = cost
  if (delta <= 0) {
    return
  }
  const now = await $.clock.now()
  const day = dayKey(now)
  const before = (await daysOf($))[day] ?? 0
  await $.store.set('days', addSpend(await daysOf($), day, delta))
  const limit = await limitOf($)
  const after = before + delta
  for (const share of WARN_AT) {
    if (before < limit * share && after >= limit * share) {
      $.ui.toast(`💰 ${Math.round(share * 100)}% of today's budget used: $${after.toFixed(2)} of $${limit}`)
    }
  }
  if (before < limit && after >= limit) {
    $.ui.toast(`💰 Daily budget reached: $${after.toFixed(2)} of $${limit}. I'll ask before the next message.`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'budget',
      description: 'Daily spend budget: /budget, /budget <dollars>, /budget off',
      argumentHint: '<dollars>|on|off',
    })
    const ran = await next(e)
    // Count only what this session spends from now on (a resumed session carries its old cost).
    lastCost = (await $.session.usage()).cost?.usd

    return ran
  })

  on('session.measure', async ($, e, next) => {
    if (e.cost !== undefined && e.changed.includes('cost')) {
      await record($, e.cost.usd)
    }

    return next(e)
  })

  on('command.run', { command: 'budget' }, async ($, e) => {
    const arg = e.args.trim().replace('$', '').toLowerCase()
    if (arg === 'off') {
      await update($, isOn, () => false)
      return { text: 'Budget guard off for this session (spend is still counted).' }
    }
    if (arg === 'on') {
      await update($, isOn, () => true)
    } else if (arg !== '') {
      const n = Number(arg)
      if (!Number.isFinite(n) || n <= 0) {
        return { text: 'Give a dollar amount, e.g. /budget 30' }
      }
      await $.store.set('limit', n)
      await update($, allowUntil, () => 0)
    }
    const now = await $.clock.now()
    const days = await daysOf($)
    const today = days[dayKey(now)] ?? 0
    const limit = await limitOf($)
    const week = Object.entries(days)
      .filter(([key]) => key >= dayKey(now - 6 * 86_400_000))
      .reduce((sum, [, usd]) => sum + usd, 0)

    return {
      text:
        `💰 Today: $${today.toFixed(2)} of $${limit} (${Math.round((today / limit) * 100)}%) · last 7 days: $${week.toFixed(2)}\n` +
        `${weekChart(days, now)}\n` +
        'Costs are Claude Code’s API-price estimates; on a Pro/Max plan they measure usage, not your bill.\n' +
        `${(await read($, isOn)) ? '' : '⚠️ Off this session. '}/budget <dollars> to change the limit.`,
    }
  }).catch(() => ({ text: 'Budget guard: could not run that.' }))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') {
      return next(e)
    }
    if (!(await read($, isOn)) || e.text.trim().startsWith('/')) {
      return next(e)
    }
    const now = await $.clock.now()
    const today = (await daysOf($))[dayKey(now)] ?? 0
    const limit = await limitOf($)
    if (today < limit || today < (await read($, allowUntil))) {
      return next(e)
    }
    const waiting = await read($, pending)
    if (waiting !== null && waiting.text === e.text && now - waiting.at < CONFIRM_WINDOW_MS) {
      await update($, pending, () => null)
      // Go on, and ask again after another quarter of the budget.
      await update($, allowUntil, () => today + limit * 0.25)
      return next(e)
    }
    const ask: Pending = { text: e.text, at: now }
    await update($, pending, () => ask)

    return {
      drop:
        `💰 Daily budget reached: $${today.toFixed(2)} of $${limit} today. ` +
        'Send the same message again within 3 minutes to continue, or /budget <dollars> to raise the limit.',
    }
  }).catch(($, e, next) => next(e))
}
