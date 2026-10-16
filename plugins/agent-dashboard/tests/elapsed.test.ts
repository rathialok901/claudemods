import { expect, test } from 'claude-code/testing'

import { doingOf, elapsed } from '../hooks/register'

test('elapsed formats seconds and minutes', async () => {
  expect(elapsed(4200)).toBe('4s')
  expect(elapsed(72000)).toBe('1m 12s')
  expect(elapsed(-50)).toBe('0s')
})


test('what an agent is doing, in a few words', async () => {
  expect(doingOf('Read', { file_path: '/repo/src/app.ts' })).toBe('📖 reading app.ts')
  expect(doingOf('Edit', { file_path: '/repo/src/app.ts' })).toBe('✏️ editing app.ts')
  expect(doingOf('Bash', { command: 'npm test', description: 'Run the unit tests' })).toBe('💻 Run the unit tests')
  expect(doingOf('Grep', { pattern: 'TODO' })).toBe('🔍 searching for TODO')
  expect(doingOf('WebFetch', { url: 'https://docs.example.com/guide' })).toBe('🌐 reading docs.example.com/guide')
  expect(doingOf('mcp__github__list_issues', {})).toBe('🔧 github › list_issues')
})
