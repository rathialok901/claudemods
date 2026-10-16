import { describe, expect, mock, test } from 'claude-code/testing'

import { bar, changesFor, counts, DEFAULTS, onOff, prettyModel, PROFILES } from '../hooks/register'
import { alivePids, folderName, lastPromptOf, parseSessionFile, transcriptPath, uptime } from '../hooks/sessions'
import { nextTheme, THEME_ORDER, themeOf } from '../hooks/themes'

const PANE = { title: 'Mods', isFocused: true, bodyColumns: 70, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const USAGE = { value: { startedAt: 0, context: { window: 1_000_000, tokens: 40_000, percent: 4 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }], cost: { usd: 1 } } }

describe('helpers', () => {
  test('bars, counts, models', async () => {
    expect(bar(0.5)).toBe('█████░░░░░')
    expect(onOff(false)).toEqual({ tone: 'off', status: 'OFF' })
    expect(counts([{ title: 'A', color: 'red', rows: [{ key: 'a', icon: '', name: 'a', tone: 'on', status: '' }, { key: 'b', icon: '', name: 'b', tone: 'off', status: '' }] }])).toEqual({ total: 2, on: 1, off: 1 })
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  })

  test('profiles change only what differs', async () => {
    expect(changesFor(DEFAULTS, PROFILES.focus!.switches)).toEqual(['zen', 'mascot', 'next'])
    expect(changesFor(DEFAULTS, DEFAULTS)).toEqual([])
  })

  test('themes cycle and fall back', async () => {
    expect(nextTheme('mono')).toBe('classic')
    expect(THEME_ORDER.map(nextTheme).length).toBe(THEME_ORDER.length)
    expect(themeOf('nope').label).toBe('🌈 Classic')
  })
})

describe('sessions', () => {
  const FILE = JSON.stringify({ pid: 20571, sessionId: 'abc1', cwd: '/home/me/proj', kind: 'interactive', status: 'busy', name: 'laptop-57', startedAt: 1 })

  test('session files', async () => {
    expect(parseSessionFile(FILE, 'abc1')).toMatchObject({ pid: 20571, name: 'laptop-57', isMe: true, status: 'busy' })
    expect(parseSessionFile(JSON.stringify({ pid: 2, sessionId: 'x', spare: true }), 'abc1')).toBeUndefined()
    expect(parseSessionFile('not json', 'abc1')).toBeUndefined()
    expect([...alivePids(' 20571\n 26769\n')]).toEqual([20571, 26769])
  })

  test('transcripts and labels', async () => {
    expect(transcriptPath('/home/me/.claude', '/home/me/my.proj', 'id1')).toBe('/home/me/.claude/projects/-home-me-my-proj/id1.jsonl')
    const tail = [
      JSON.stringify({ type: 'user', message: { content: 'build the login page' } }),
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
      JSON.stringify({ type: 'user', message: { content: '<command-name>/zen</command-name>' } }),
    ].join('\n')
    expect(lastPromptOf(tail)).toBe('build the login page')
    expect(folderName('/home/me/proj', '/home/me')).toBe('~/proj')
    expect(uptime(125 * 60_000)).toBe('2h 5m')
  })
})

describe('the panel', () => {
  test('draws tabs, gauges, profiles and every group', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.usage', () => USAGE)
    on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'mods-center', surface, component: 'Pane', requestId: 'mods-center', props: PANE })
      for (const text of [/LOOK & FEEL/, /SMARTER/, /SAFETY/, /STATUS/, /PROFILES/, /Sonnet 5\.5/, /compacts at 80%/]) {
        expect([String(text), await ui.find({ type: 'Text', text })]).not.toEqual([String(text), undefined])
      }
      for (const key of ['tab-mods', 'tab-sessions', 'tab-activity', 'profile-focus', 'do-zen', 'theme']) {
        expect([key, await ui.find({ key })]).not.toEqual([key, undefined])
      }
      await ui.unmount()
    }
  })

  test('tabs switch, and buttons run the right commands', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.usage', () => USAGE)
    on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
    const ran: string[] = []
    on('command.run', ($, e) => {
      ran.push(`${e.command} ${e.args}`.trim())
      return { text: 'ok' }
    })
    const ui = await $.ui.mount({ plugin: 'mods-center', surface: 'terminal', component: 'Pane', requestId: 'mods-center', props: PANE })
    await ui.press({ key: 'do-zen' })
    await ui.press({ key: 'do-guardrails' })
    expect(ran.slice(0, 2)).toEqual(['zen', 'guardrails off'])
    await ui.press({ key: 'profile-focus' })
    expect(ran).toContain('mascot')
    await ui.press({ key: 'tab-activity' })
    expect(await ui.find({ type: 'Text', text: /What your mods have been doing/ })).toBeDefined()
    await ui.press({ key: 'tab-sessions' })
    expect(await ui.find({ type: 'Text', text: /Claude session/ })).toBeDefined()
    await ui.unmount()
  })
})
