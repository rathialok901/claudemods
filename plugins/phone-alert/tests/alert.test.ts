import { expect, test } from 'claude-code/testing'

import {
  approvalAlert,
  channelsOf,
  doneAlert,
  duration,
  idleSeconds,
  inQuiet,
  isHandle,
  isTopic,
  newTopic,
  parseQuiet,
  parseSettings,
} from '../hooks/register'

test('settings fill in defaults and list channels', async () => {
  const s = parseSettings(undefined)
  expect(s).toMatchObject({ isOn: true, awayMinutes: 2 })
  expect(channelsOf(s)).toEqual([])
  const both = parseSettings({ ntfy: { topic: 'claude-abc123' }, imessage: { to: '+15551234567' } })
  expect(both.ntfy?.server).toBe('https://ntfy.sh')
  expect(channelsOf(both)).toEqual(['ntfy', 'iMessage'])
})

test('quiet hours, including ones that cross midnight', async () => {
  const night = parseQuiet('23-7')
  expect(night).toEqual({ from: 23, to: 7 })
  expect(inQuiet(23, night)).toBe(true)
  expect(inQuiet(3, night)).toBe(true)
  expect(inQuiet(7, night)).toBe(false)
  expect(inQuiet(12, night)).toBe(false)
  expect(inQuiet(13, parseQuiet('12-14'))).toBe(true)
  expect(parseQuiet('25-3')).toBeUndefined()
  expect(inQuiet(3, undefined)).toBe(false)
})

test('idle time from ioreg', async () => {
  expect(idleSeconds('  |   "HIDIdleTime" = 185000000000\n')).toBe(185)
  expect(idleSeconds('nothing here')).toBeUndefined()
})

test('handles, topics and generated topics', async () => {
  expect(isHandle('+1 555 123 4567')).toBe(true)
  expect(isHandle('me@icloud.com')).toBe(true)
  expect(isHandle('hello')).toBe(false)
  const topic = newTopic()
  expect(isTopic(topic)).toBe(true)
  expect(topic.startsWith('claude-')).toBe(true)
  expect(isTopic('a b')).toBe(false)
})

test('alert text: status only for ntfy, the command only as iMessage detail', async () => {
  expect(doneAlert('myapp', 245, false).body).toBe('✅ Done in myapp (4m 5s)')
  expect(doneAlert('myapp', 40, true).priority).toBe('high')
  const ask = approvalAlert('myapp', 'Bash', 'rm -rf build')
  expect(ask.body).not.toContain('rm -rf')
  expect(ask.detail).toBe('rm -rf build')
  expect(duration(3725)).toBe('1h 2m')
})
