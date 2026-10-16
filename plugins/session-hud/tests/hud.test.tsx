import { expect, test } from 'claude-code/testing'

import { compactionEta, duration, kTokens, parseShortstat, prettyModel, progressBar, relative } from '../hooks/register'

test('helpers', async () => {
  expect(duration(12 * 60000)).toBe('12m')
  expect(duration(75 * 60000)).toBe('1h 15m')
  expect(parseShortstat(' 5 files changed, 120 insertions(+), 30 deletions(-)\n')).toEqual({
    files: 5,
    insertions: 120,
    deletions: 30,
  })
  expect(parseShortstat(' 1 file changed, 1 insertion(+)\n')).toEqual({ files: 1, insertions: 1, deletions: 0 })
  expect(progressBar(3, 5)).toBe('▓▓▓▓▓▓░░░░')
  expect(relative('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
})

test('model names, token counts and compaction timing', async () => {
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-sonnet-5-5', 1_000_000)).toBe('Sonnet 5.5 (1M)')
  expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(kTokens(68_400)).toBe('68k')
  expect(kTokens(1_000_000)).toBe('1M')
  expect(compactionEta({ tokens: 68_000, window: 200_000, percent: 34 }, 80, [12_000, 14_000])).toEqual({ left: 92_000, turns: 8 })
  expect(compactionEta({ tokens: 170_000, window: 200_000 }, 80, [])).toEqual({ left: 0 })
  expect(compactionEta({ window: 200_000 }, 80, [])).toBeUndefined()
})

test('the pane draws on every surface', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 34 }, rateLimits: [], cost: { usd: 0.82 } } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'session-hud',
      surface,
      component: 'Pane',
      requestId: 'session-hud',
      props: {
        title: 'Session',
        isFocused: false,
        bodyColumns: 60,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /No tasks yet/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    await ui.unmount()
  }
})
