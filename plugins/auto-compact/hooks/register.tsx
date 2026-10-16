import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const isOn = atom({ plugin: 'auto-compact', key: 'isOn' } as const, true)

export const DEFAULT_THRESHOLD = 80

export function shouldCompact(percent: number | undefined, threshold: number, isBusy: boolean): boolean {
  return !isBusy && percent !== undefined && percent >= threshold
}

async function thresholdOf($: EngineInterface): Promise<number> {
  const value = await $.store.get('threshold')

  return typeof value === 'number' && value >= 20 && value <= 95 ? value : DEFAULT_THRESHOLD
}

let isBusy = false

async function compactNow($: EngineInterface, percent: number) {
  isBusy = true
  try {
    $.ui.toast(`🗜 Context at ${Math.round(percent)}%, compacting…`)
    const done = await $.session.compact({
      instructions: 'Keep the current goal, decisions made, files changed and any open problems or next steps.',
    })
    if (done.messages !== undefined) {
      const freed =
        done.tokensBefore !== undefined && done.tokensAfter !== undefined
          ? ` (${Math.round(done.tokensBefore / 1000)}k → ${Math.round(done.tokensAfter / 1000)}k tokens)`
          : ''
      $.ui.toast(`🗜 Compacted${freed}`)
    }
  } finally {
    isBusy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'compact-at',
      description: 'Compact early: /compact-at <percent>, on, off',
      argumentHint: '<percent>|on|off',
    })

    return next(e)
  })

  on('command.run', { command: 'compact-at' }, async ($, e) => {
    const arg = e.args.trim().replace('%', '').toLowerCase()
    const n = Number(arg)
    if (arg === 'off') {
      await update($, isOn, () => false)
      return { text: 'Auto-compact off for this session (Claude Code still compacts on its own near the limit).' }
    }
    if (arg !== '' && arg !== 'on') {
      if (!Number.isFinite(n) || n < 20 || n > 95) {
        return { text: 'Give a percentage between 20 and 95, e.g. /compact-at 75' }
      }
      await $.store.set('threshold', Math.round(n))
    }
    await update($, isOn, () => true)

    return { text: `Auto-compact on: compacts after a turn once context passes ${await thresholdOf($)}%.` }
  }).catch(() => ({ text: 'Could not change auto-compact.' }))

  on('session.measure', async ($, e, next) => {
    const ran = await next(e)
    const percent = e.context.percent
    if (e.changed.includes('context') && (await read($, isOn)) && shouldCompact(percent, await thresholdOf($), isBusy)) {
      void compactNow($, percent ?? 0).catch(() => undefined)
    }

    return ran
  })
}
