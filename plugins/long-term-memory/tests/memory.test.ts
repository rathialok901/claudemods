import { expect, test } from 'claude-code/testing'

import { merge, parseCapture, parseMemory, renderMemory, sectionText } from '../hooks/register'

const CTX = { project: 'coffee-fever', date: '2026-10-16', session: 'abc12345' }

test('the file round-trips, including hand edits', async () => {
  const memory = { preferences: ['Short answers'], decisions: ['[coffee-fever] Use Postgres (2026-10-16)'], history: ['2026-10-16 · coffee-fever · Set up auth <!--s:abc12345-->'] }
  expect(parseMemory(renderMemory(memory))).toEqual(memory)
  const edited = renderMemory(memory).replace('- Short answers', '- Short answers\n* Explain like I am learning')
  expect(parseMemory(edited).preferences).toEqual(['Short answers', 'Explain like I am learning'])
  expect(parseMemory(renderMemory({ preferences: [], decisions: [], history: [] }))).toEqual({ preferences: [], decisions: [], history: [] })
})

test('merging adds only new items and keeps one history line per session', async () => {
  const start = { preferences: ['Prefers short answers.'], decisions: ['[coffee-fever] Use Postgres, not SQLite (2026-10-15)'], history: [] }
  const first = merge(start, { summary: 'Building login', decisions: ['Use Postgres, not SQLite', 'Use JWT for auth'], preferences: ['prefers short answers', 'Likes TypeScript'] }, CTX)
  expect(first.added).toEqual({ decisions: 1, preferences: 1 })
  expect(first.memory.decisions[1]).toBe('[coffee-fever] Use JWT for auth (2026-10-16)')
  expect(first.memory.history).toEqual(['2026-10-16 · coffee-fever · Building login <!--s:abc12345-->'])
  const second = merge(first.memory, { summary: 'Login done, tests pass', decisions: [], preferences: [] }, CTX)
  expect(second.memory.history).toEqual(['2026-10-16 · coffee-fever · Login done, tests pass <!--s:abc12345-->'])
})

test('lists stay within their limits', async () => {
  let memory = { preferences: [] as string[], decisions: [] as string[], history: [] as string[] }
  for (let i = 0; i < 50; i += 1) {
    memory = merge(memory, { summary: `s${i}`, decisions: [`decision number ${i}`], preferences: [`preference number ${i}`] }, { ...CTX, session: `s${i}` }).memory
  }
  expect(memory.preferences.length).toBe(30)
  expect(memory.decisions.length).toBe(40)
  expect(memory.history.length).toBe(15)
  expect(memory.preferences.at(-1)).toBe('preference number 49')
})

test('capture replies are read leniently', async () => {
  expect(parseCapture('Here you go:\n```json\n{"summary":"x","decisions":["a"],"preferences":[]}\n```')).toEqual({ summary: 'x', decisions: ['a'], preferences: [] })
  expect(parseCapture('no json here')).toBeUndefined()
})

test('a new session gets this project’s decisions, not other projects’', async () => {
  const memory = {
    preferences: ['Short answers'],
    decisions: ['[coffee-fever] Use Postgres (2026-10-16)', '[rca-rag] Use FAISS (2026-10-05)', 'Always write tests'],
    history: ['2026-10-16 · coffee-fever · Set up auth <!--s:abc-->'],
  }
  const text = sectionText(memory, 'coffee-fever')
  expect(text).toContain('Use Postgres')
  expect(text).toContain('Always write tests')
  expect(text).not.toContain('FAISS')
  expect(text).not.toContain('<!--')
  expect(sectionText({ preferences: [], decisions: [], history: [] }, 'x')).toBe('')
})
