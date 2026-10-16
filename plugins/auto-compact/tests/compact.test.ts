import { expect, test } from 'claude-code/testing'

import { shouldCompact } from '../hooks/register'

test('compacts past the threshold, not while busy', async () => {
  expect(shouldCompact(82, 80, false)).toBe(true)
  expect(shouldCompact(79, 80, false)).toBe(false)
  expect(shouldCompact(90, 80, true)).toBe(false)
  expect(shouldCompact(undefined, 80, false)).toBe(false)
})
