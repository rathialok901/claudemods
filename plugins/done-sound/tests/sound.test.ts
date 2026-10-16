import { expect, test } from 'claude-code/testing'

import { soundFor } from '../hooks/register'

test('chimes on long turns, buzzes on errors, stays quiet otherwise', async () => {
  expect(soundFor('answer', false, 45)).toBe('sounds/done.wav')
  expect(soundFor('error', false, 45)).toBe('sounds/error.wav')
  expect(soundFor('answer', false, 5)).toBeUndefined()
  expect(soundFor('answer', true, 300)).toBeUndefined()
})
