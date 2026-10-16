import { expect, test } from 'claude-code/testing'

import { bar, meter, untilReset } from '../hooks/register'

test('meter shows context, limits and cost with a colour by the worst figure', async () => {
  const line = meter(
    { window: 200000, tokens: 124000, percent: 62 },
    [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 12 }],
    { usd: 1.844 },
  )
  expect(line).toBe('🟡 ctx ▓▓▓▓░░ 62% · 5h 40% · 7d 12% · $1.84')
})

test('meter turns red near a limit and is empty with no figures', async () => {
  expect(meter({ window: 200000, percent: 10 }, [{ kind: 'five_hour', percentUsed: 91 }], undefined)).toBe(
    '🔴 ctx ▓░░░░░ 10% · 5h 91%',
  )
  expect(meter({ window: 200000 }, [], undefined)).toBe('')
})

test('bar and reset countdown', async () => {
  expect(bar(100)).toBe('▓▓▓▓▓▓')
  expect(bar(0)).toBe('░░░░░░')
  const now = Date.parse('2026-10-16T10:00:00Z')
  expect(untilReset('2026-10-16T12:10:00Z', now)).toBe('2h 10m')
  expect(untilReset('2026-10-16T10:25:00Z', now)).toBe('25m')
  expect(untilReset(undefined, now)).toBe('')
})
