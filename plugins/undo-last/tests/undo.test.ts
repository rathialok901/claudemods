import { expect, test } from 'claude-code/testing'

import { shortPath, summary } from '../hooks/register'

test('checkpoint summary', async () => {
  const text = summary(
    {
      turn: 1,
      at: 0,
      prompt: 'add login',
      files: [
        { path: '/repo/src/a.ts', original: 'x' },
        { path: '/repo/src/new.ts', original: null },
      ],
    },
    '/repo',
  )
  expect(text).toBe('1 changed, 1 created: src/a.ts, src/new.ts')
  expect(shortPath('/other/x', '/repo')).toBe('/other/x')
})
