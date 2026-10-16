import { expect, test } from 'claude-code/testing'

import { addSpend, dayKey, weekChart } from '../hooks/register'

test('spend by day', async () => {
  const day = dayKey(Date.parse('2026-10-16T12:00:00'))
  expect(day).toBe('2026-10-16')
  const days = addSpend(addSpend({}, day, 1.5), day, 2)
  expect(days[day]).toBe(3.5)
  const many: Record<string, number> = {}
  for (let i = 1; i <= 20; i += 1) many[`2026-09-${String(i).padStart(2, '0')}`] = i
  expect(Object.keys(addSpend(many, day, 1)).length).toBe(14)
  expect(weekChart(days, Date.parse('2026-10-16T12:00:00'))).toContain('$3.50')
})
