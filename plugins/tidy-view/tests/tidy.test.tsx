import { describe, expect, test } from 'claude-code/testing'

import { oneLine, shortPath, summarize } from '../hooks/register'

const EDIT = {
  tool_use_id: 'tu1',
  tool: 'Edit',
  input: { file_path: '/home/me/project/src/app.ts', old_string: 'a\nb', new_string: 'a\nb\nc\nd' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
}

describe('summaries', () => {
  test('edit, write, bash and unknown tools', async () => {
    expect(summarize('Edit', EDIT.input)).toEqual(['✏️', '…/src/app.ts', '+4 −2'])
    expect(summarize('Write', { file_path: 'a.md', content: 'x\ny' })).toEqual(['📝', 'a.md', '2 lines'])
    expect(summarize('Bash', { command: 'npm test', description: 'Run the tests' })).toEqual(['💻', 'Run the tests', ''])
    expect(summarize('SomethingElse', {})).toBeUndefined()
    expect(shortPath('/a/b/c/d.ts')).toBe('…/c/d.ts')
    expect(oneLine('x'.repeat(100), 10)).toBe('xxxxxxxxx…')
  })
})

test('an Edit row draws as one line on every surface', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tidy-view', surface, component: 'ToolUse', props: EDIT })
    const row = await ui.find({ type: 'Text', text: /app\.ts/ })
    expect(row?.text).toContain('+4 −2')
    await ui.unmount()
  }
})

test('a successful Edit result block is hidden, and drawing nothing', async $ => {
  const ok = await $.ui.mount({
    plugin: 'tidy-view',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'tu1', tool: 'Edit', output: {}, isErrored: false },
  })
  expect(await ok.find({ type: 'Text' })).toBeUndefined()
  await ok.unmount()
})
