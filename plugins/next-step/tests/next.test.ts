import { expect, test } from 'claude-code/testing'

import { freshTurn, suggestion } from '../hooks/register'

test('suggestions follow what the turn did', async () => {
  expect(suggestion({ ...freshTurn(), testsRun: true, testsFailed: true }, 'done')).toBe('fix the failing tests')
  expect(suggestion({ ...freshTurn(), failedCommand: 'npm i' }, 'done')).toBe('fix the error above')
  expect(suggestion({ ...freshTurn(), edits: 2 }, 'done')).toBe('run the tests to check these changes')
  expect(suggestion({ ...freshTurn(), edits: 2, testsRun: true }, 'done')).toBe('commit these changes with a clear message')
  expect(suggestion({ ...freshTurn(), edits: 2 }, 'Want me to continue?')).toBeUndefined()
  expect(suggestion(freshTurn(), 'hello')).toBeUndefined()
})
