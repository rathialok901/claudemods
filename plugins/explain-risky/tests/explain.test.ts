import { expect, test } from 'claude-code/testing'

import { needsExplaining, oneSentence } from '../hooks/register'

test('only non-trivial commands are explained', async () => {
  expect(needsExplaining('ls -la')).toBe(false)
  expect(needsExplaining('git status')).toBe(false)
  expect(needsExplaining('find . -name "*.log" | xargs rm')).toBe(true)
  expect(needsExplaining('npm publish')).toBe(true)
  expect(oneSentence('a\n  b')).toBe('a b')
})
