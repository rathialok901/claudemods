import { expect, test } from 'claude-code/testing'

import { contextBlock, isVague, tail } from '../hooks/register'

test('vague prompts', async () => {
  expect(isVague('fix it')).toBe(true)
  expect(isVague('still failing, why?')).toBe(true)
  expect(isVague('why')).toBe(true)
  expect(isVague('/zen')).toBe(false)
  expect(isVague('add a dark mode toggle to the settings page with a persisted preference')).toBe(false)
})

test('context block', async () => {
  const block = contextBlock({ command: 'npm test', tail: 'FAIL app.test.ts' }, ['src/app.ts'], 'npm test')
  expect(block).toContain('`npm test`')
  expect(block).toContain('FAIL app.test.ts')
  expect(block).toContain('src/app.ts')
  expect(tail('a\nb\nc', 2)).toBe('b\nc')
})
