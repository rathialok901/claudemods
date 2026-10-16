import { expect, test } from 'claude-code/testing'

import { family, isJudgeable, parseTier, quickTier, wasJudged, withModel } from '../hooks/register'

test('quick decisions skip the classifier', async () => {
  expect(quickTier('yes')).toBe('keep')
  expect(quickTier('go ahead!')).toBe('keep')
  expect(quickTier('/model opus')).toBe('keep')
  expect(quickTier('what is git')).toBe('simple')
  expect(quickTier('refactor the auth module to use JWT and update all callers')).toBeUndefined()
})

test('classifier replies and model families', async () => {
  expect(parseTier(' SIMPLE')).toBe('simple')
  expect(parseTier('COMPLEX.')).toBe('complex')
  expect(parseTier('maybe')).toBeUndefined()
  expect(family('claude-opus-5-5')).toBe('opus')
  expect(family('sonnet[1m]')).toBe('sonnet')
})

test('drafts judged while typing', async () => {
  expect(isJudgeable('design a multi region rate limiter')).toBe(true)
  expect(isJudgeable('fix it')).toBe(false)
  expect(isJudgeable('/model-advisor status now please ok')).toBe(false)
  expect(wasJudged('design a cache layer', 'design a cache layer')).toBe(true)
  expect(wasJudged('design a cache layer for the api!', 'design a cache layer for the api')).toBe(true)
  expect(wasJudged('design a cache layer for the api and also migrate the db', 'design a cache layer')).toBe(false)
  expect(wasJudged('anything', '')).toBe(false)
})

test('restoring the settings file touches only the model', async () => {
  const before = JSON.stringify({ theme: 'auto', model: 'opus', env: { A: '1' } })
  expect(JSON.parse(withModel(before, 'sonnet'))).toEqual({ theme: 'auto', model: 'sonnet', env: { A: '1' } })
  expect(JSON.parse(withModel(before, 'default'))).toEqual({ theme: 'auto', env: { A: '1' } })
})
