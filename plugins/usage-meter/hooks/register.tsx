import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

const WARN_AT = [80, 95]

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

export function bar(percent: number, cells = 6): string {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))

  return '▓'.repeat(filled) + '░'.repeat(cells - filled)
}

export function dot(percent: number): string {
  return percent >= 85 ? '🔴' : percent >= 60 ? '🟡' : '🟢'
}

export function untilReset(resetsAt: string | undefined, now: number): string {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(at) || at <= now) {
    return ''
  }
  const minutes = Math.round((at - now) / 60000)
  const hours = Math.floor(minutes / 60)

  if (hours >= 24) {
    return `${Math.floor(hours / 24)}d ${hours % 24}h`
  }

  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

export function meter(
  context: SessionContextUsage,
  rateLimits: readonly SessionRateLimit[],
  cost: SessionCost | undefined,
): string {
  const parts: string[] = []
  const ctx = context.percent

  if (ctx !== undefined) {
    parts.push(`ctx ${bar(ctx)} ${Math.round(ctx)}%`)
  }
  for (const limit of rateLimits) {
    parts.push(`${LABELS[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`)
  }
  if (cost !== undefined) {
    parts.push(`$${cost.usd.toFixed(2)}`)
  }
  if (parts.length === 0) {
    return ''
  }
  const worst = Math.max(ctx ?? 0, ...rateLimits.map(limit => limit.percentUsed))

  return `${dot(worst)} ${parts.join(' · ')}`
}

// Highest warning threshold already toasted, per rate-limit window.
const warned = new Map<string, number>()

export async function warn(
  $: EngineInterface,
  rateLimits: readonly SessionRateLimit[],
) {
  const now = await $.clock.now()
  for (const limit of rateLimits) {
    const passed = WARN_AT.filter(at => limit.percentUsed >= at).pop() ?? 0
    if (passed > (warned.get(limit.kind) ?? 0)) {
      const reset = untilReset(limit.resetsAt, now)
      $.ui.toast(
        `⚠️ ${LABELS[limit.kind] ?? limit.kind} limit at ${Math.round(limit.percentUsed)}%` +
          (reset ? `, resets in ${reset}` : ''),
        { timeoutMs: 8000 },
      )
    }
    warned.set(limit.kind, passed)
  }
}

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    // The figures draw in the mascot's band; this mod only warns near a limit.
    await warn($, e.rateLimits)

    return next(e)
  })
}
