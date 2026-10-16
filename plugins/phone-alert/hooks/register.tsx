import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const isOn = atom({ plugin: 'phone-alert', key: 'isOn' } as const, false)
const channels = atom({ plugin: 'phone-alert', key: 'channels' } as const, [])
const lastSent = atom({ plugin: 'phone-alert', key: 'lastSent' } as const, null)

// Turns shorter than this never alert: nobody walks away from a 10-second answer.
const MIN_TURN_SECONDS = 30
// How often a waiting approval re-checks whether you've gone away, and for how long.
const APPROVAL_POLL_MS = 30_000
const APPROVAL_GIVE_UP_MS = 30 * 60_000
const LIMIT_AT = 95

export type Settings = {
  isOn: boolean
  ntfy?: { server: string; topic: string }
  imessage?: { to: string }
  quiet?: { from: number; to: number }
  // Minutes without keyboard or mouse input before you count as away; 0 alerts always.
  awayMinutes: number
}

export const DEFAULTS: Settings = { isOn: true, awayMinutes: 2 }

export type Alert = { title: string; body: string; tag: string; priority: 'default' | 'high'; detail?: string }

// ── Pure helpers ────────────────────────────────────────────────────────────

export function parseSettings(value: unknown): Settings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<Settings>

  return {
    isOn: v.isOn !== false,
    ntfy: v.ntfy && typeof v.ntfy.topic === 'string' ? { server: v.ntfy.server || 'https://ntfy.sh', topic: v.ntfy.topic } : undefined,
    imessage: v.imessage && typeof v.imessage.to === 'string' ? { to: v.imessage.to } : undefined,
    quiet: v.quiet && typeof v.quiet.from === 'number' && typeof v.quiet.to === 'number' ? v.quiet : undefined,
    awayMinutes: typeof v.awayMinutes === 'number' && v.awayMinutes >= 0 ? v.awayMinutes : DEFAULTS.awayMinutes,
  }
}

export function channelsOf(s: Settings): string[] {
  return [...(s.ntfy ? ['ntfy'] : []), ...(s.imessage ? ['iMessage'] : [])]
}

// "23-7" → { from: 23, to: 7 }
export function parseQuiet(text: string): { from: number; to: number } | undefined {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(text.trim())
  if (!m) {
    return undefined
  }
  const from = Number(m[1])
  const to = Number(m[2])

  return from <= 23 && to <= 23 && from !== to ? { from, to } : undefined
}

export function inQuiet(hour: number, quiet: { from: number; to: number } | undefined): boolean {
  if (!quiet) {
    return false
  }

  return quiet.from < quiet.to ? hour >= quiet.from && hour < quiet.to : hour >= quiet.from || hour < quiet.to
}

// Seconds since the last keyboard or mouse input, from `ioreg -c IOHIDSystem -d 4`.
export function idleSeconds(ioreg: string): number | undefined {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(ioreg)

  return m ? Math.floor(Number(m[1]) / 1e9) : undefined
}

// A phone number or an Apple ID email.
export function isHandle(text: string): boolean {
  return /^\+?[\d\s()-]{7,}$/.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
}

export function isTopic(text: string): boolean {
  return /^[A-Za-z0-9_-]{6,64}$/.test(text)
}

export function newTopic(random: () => number = Math.random): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz23456789'
  let id = ''
  for (let i = 0; i < 14; i += 1) {
    id += letters[Math.floor(random() * letters.length)]
  }

  return `claude-${id}`
}

export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)

  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m ${seconds % 60}s` : `${seconds}s`
}

export function short(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function doneAlert(folder: string, seconds: number, failed: boolean): Alert {
  return failed
    ? { title: 'Claude Code: turn failed', body: `❌ Failed after ${duration(seconds)} in ${folder}`, tag: 'x', priority: 'high' }
    : { title: 'Claude Code: done', body: `✅ Done in ${folder} (${duration(seconds)})`, tag: 'white_check_mark', priority: 'default' }
}

// The command goes only to iMessage (`detail`): an ntfy topic is readable by anyone who knows its name.
export function approvalAlert(folder: string, tool: string, what: string | undefined): Alert {
  return {
    title: 'Claude Code: needs you',
    body: `⚠️ Waiting for your approval (${tool}) in ${folder}`,
    tag: 'warning',
    priority: 'high',
    detail: what ? short(what) : undefined,
  }
}

export function limitAlert(kind: string, percent: number): Alert {
  const label = kind === 'five_hour' ? '5-hour' : kind === 'seven_day' ? '7-day' : kind

  return { title: 'Claude Code: limit', body: `📉 ${label} usage limit at ${Math.round(percent)}%`, tag: 'chart_with_downwards_trend', priority: 'default' }
}

export const IMESSAGE_SCRIPT = [
  'on run argv',
  'tell application "Messages"',
  'set svc to 1st account whose service type = iMessage',
  'send (item 1 of argv) to participant (item 2 of argv) of svc',
  'end tell',
  'end run',
]

export function status(s: Settings, idle: number | undefined): string {
  const lines = [
    `📱 Phone alerts: ${s.isOn ? 'on' : 'off'}`,
    `   ntfy:     ${s.ntfy ? `${s.ntfy.server}/${s.ntfy.topic}` : 'not set'}`,
    `   iMessage: ${s.imessage ? s.imessage.to : 'not set'}`,
    `   Away after: ${s.awayMinutes === 0 ? 'always alert' : `${s.awayMinutes} min without input`}` +
      (idle !== undefined ? ` (idle now: ${duration(idle)})` : ''),
    `   Quiet hours: ${s.quiet ? `${s.quiet.from}:00–${s.quiet.to}:00` : 'none'}`,
  ]
  if (!s.ntfy && !s.imessage) {
    lines.push('', 'Set up a channel first:', '  /phone-alert ntfy               create a private topic for the ntfy app', '  /phone-alert imessage <number>  text that number or Apple ID')
  }
  lines.push(
    '',
    'Commands: on · off · test · ntfy [topic|off] · imessage <number|email|off> · away <minutes> · quiet <23-7|off>',
  )

  return lines.join('\n')
}

// ── Engine work ─────────────────────────────────────────────────────────────

let folder = 'your project'
let lastPromptAt = 0
const warnedLimits = new Set<string>()
const pending = new Set<string>()

async function settingsOf($: EngineInterface): Promise<Settings> {
  return parseSettings(await $.store.get('settings'))
}

async function save($: EngineInterface, s: Settings) {
  await $.store.set('settings', s)
  await update($, isOn, () => s.isOn)
  await update($, channels, () => channelsOf(s))
}

async function idleNow($: EngineInterface): Promise<number | undefined> {
  try {
    const { exitCode, stdout } = await $.process.run(['ioreg', '-c', 'IOHIDSystem', '-d', '4'], { timeoutMs: 3000 })
    const idle = exitCode === 0 ? idleSeconds(stdout) : undefined
    if (idle !== undefined) {
      return idle
    }
  } catch {
    // No ioreg (not macOS): fall back to the time since the last prompt typed here.
  }
  if (lastPromptAt === 0) {
    return undefined
  }

  return Math.floor(((await $.clock.now()) - lastPromptAt) / 1000)
}

async function isAway($: EngineInterface, s: Settings): Promise<boolean> {
  if (s.awayMinutes === 0) {
    return true
  }
  const idle = await idleNow($)

  return idle !== undefined && idle >= s.awayMinutes * 60
}

async function sendNtfy($: EngineInterface, ntfy: { server: string; topic: string }, alert: Alert): Promise<boolean> {
  const { exitCode } = await $.process.run(
    [
      'curl', '-sf', '-m', '10',
      '-H', `Title: ${alert.title}`,
      '-H', `Tags: ${alert.tag}`,
      '-H', `Priority: ${alert.priority}`,
      '--data-binary', '@-',
      `${ntfy.server.replace(/\/+$/, '')}/${ntfy.topic}`,
    ],
    { stdin: alert.body, timeoutMs: 15000 },
  )

  return exitCode === 0
}

async function sendIMessage($: EngineInterface, to: string, alert: Alert): Promise<boolean> {
  const text = alert.detail ? `${alert.body}\n${alert.detail}` : alert.body
  const args = IMESSAGE_SCRIPT.flatMap(line => ['-e', line])
  const { exitCode } = await $.process.run(['osascript', ...args, text, to], { timeoutMs: 20000 })

  return exitCode === 0
}

// Sends on every channel set up; returns the ones that worked and the ones that didn't.
async function send($: EngineInterface, s: Settings, alert: Alert): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = []
  const failed: string[] = []
  const tries: Promise<void>[] = []
  if (s.ntfy) {
    const ntfy = s.ntfy
    tries.push(sendNtfy($, ntfy, alert).then(sent => void (sent ? ok : failed).push('ntfy'), () => void failed.push('ntfy')))
  }
  if (s.imessage) {
    const to = s.imessage.to
    tries.push(sendIMessage($, to, alert).then(sent => void (sent ? ok : failed).push('iMessage'), () => void failed.push('iMessage')))
  }
  await Promise.all(tries)
  if (ok.length > 0) {
    const at = await $.clock.now()
    await update($, lastSent, () => ({ at, text: alert.body, via: ok }))
  }

  return { ok, failed }
}

// Sends only when it's on, a channel is set, it isn't quiet hours, and you're away.
async function alertIfAway($: EngineInterface, alert: Alert): Promise<boolean> {
  const s = await settingsOf($)
  if (!s.isOn || channelsOf(s).length === 0) {
    return false
  }
  if (inQuiet(new Date(await $.clock.now()).getHours(), s.quiet)) {
    return false
  }
  if (!(await isAway($, s))) {
    return false
  }
  const { ok, failed } = await send($, s, alert)
  if (failed.length > 0) {
    $.ui.toast(`📱 Couldn't send the phone alert by ${failed.join(' and ')}: try /phone-alert test`)
  }

  return ok.length > 0
}

// An approval can wait a long time: re-check every 30s until you're away, it's answered, or 30 min pass.
async function watchApproval($: EngineInterface, id: string, alert: Alert) {
  pending.add(id)
  const started = await $.clock.now()
  while (pending.has(id) && (await $.clock.now()) - started < APPROVAL_GIVE_UP_MS) {
    await $.clock.sleep(APPROVAL_POLL_MS)
    if (pending.has(id) && (await alertIfAway($, alert))) {
      break
    }
  }
  pending.delete(id)
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const s = await settingsOf($)
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const value = rest.join(' ').trim()

  switch (verb.toLowerCase()) {
    case '':
    case 'status':
      return status(s, await idleNow($))

    case 'on':
    case 'off':
      await save($, { ...s, isOn: verb === 'on' })
      return verb === 'on'
        ? `📱 Phone alerts on${channelsOf(s).length === 0 ? '. Set up a channel: /phone-alert ntfy or /phone-alert imessage <number>' : ` (${channelsOf(s).join(' + ')}).`}`
        : '📱 Phone alerts off.'

    case 'ntfy': {
      if (value === 'off') {
        await save($, { ...s, ntfy: undefined })
        return '📱 ntfy alerts off.'
      }
      const parts = value.split(/\s+/).filter(Boolean)
      const server = parts.find(p => /^https?:\/\//.test(p)) ?? s.ntfy?.server ?? 'https://ntfy.sh'
      const named = parts.find(p => !/^https?:\/\//.test(p))
      if (named !== undefined && !isTopic(named)) {
        return 'A topic is 6–64 letters, digits, - or _. Leave it out and one is made for you.'
      }
      const topic = named ?? s.ntfy?.topic ?? newTopic()
      await save($, { ...s, isOn: true, ntfy: { server, topic } })
      return [
        `📱 ntfy alerts on. Your topic: ${topic}`,
        '',
        'On your phone:',
        '  1. Install the free "ntfy" app (App Store or Google Play)',
        `  2. Tap +, enter the topic  ${topic}${server === 'https://ntfy.sh' ? '' : `  (server ${server})`}`,
        '  3. Run /phone-alert test',
        '',
        'Keep the topic name private: anyone who knows it can read the alerts. Alerts carry only the folder name and status.',
      ].join('\n')
    }

    case 'imessage': {
      if (value === 'off') {
        await save($, { ...s, imessage: undefined })
        return '📱 iMessage alerts off.'
      }
      if (!isHandle(value)) {
        return 'Give the phone number (with country code, like +1 555 123 4567) or Apple ID email to text.'
      }
      const to = value.replace(/[\s()-]/g, '')
      await save($, { ...s, isOn: true, imessage: { to: value.includes('@') ? value : to } })
      return [
        `📱 iMessage alerts on, to ${value}.`,
        '',
        'Run /phone-alert test now: the first time, macOS asks to let Claude Code control Messages; choose OK.',
        'Messages must be signed in to iMessage on this Mac.',
      ].join('\n')
    }

    case 'away': {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 0 || n > 120) {
        return 'Give the minutes without keyboard or mouse input (0–120); 0 alerts even while you are at the Mac.'
      }
      await save($, { ...s, awayMinutes: n })
      return n === 0 ? '📱 Alerts will be sent even while you are at the Mac.' : `📱 You count as away after ${n} min without input.`
    }

    case 'quiet': {
      if (value === 'off') {
        await save($, { ...s, quiet: undefined })
        return '📱 Quiet hours off.'
      }
      const quiet = parseQuiet(value)
      if (!quiet) {
        return 'Give quiet hours as start-end in 24h, like /phone-alert quiet 23-7.'
      }
      await save($, { ...s, quiet })
      return `📱 No alerts from ${quiet.from}:00 to ${quiet.to}:00.`
    }

    case 'test': {
      if (channelsOf(s).length === 0) {
        return 'No channel set up yet: /phone-alert ntfy or /phone-alert imessage <number>.'
      }
      const { ok, failed } = await send($, s, {
        title: 'Claude Code: test',
        body: `🔔 Test alert from Claude Code in ${folder}`,
        tag: 'bell',
        priority: 'default',
      })
      const lines = []
      if (ok.length > 0) {
        lines.push(`📱 Sent by ${ok.join(' and ')}. Check your phone.`)
      }
      if (failed.includes('ntfy')) {
        lines.push('❌ ntfy failed: check your internet connection and the server address.')
      }
      if (failed.includes('iMessage')) {
        lines.push(
          '❌ iMessage failed: open Messages and sign in to iMessage, and allow Claude Code to control Messages in System Settings › Privacy & Security › Automation.',
        )
      }
      return lines.join('\n')
    }

    default:
      return status(s, undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    folder = e.cwd.split('/').filter(Boolean).pop() ?? '~'
    await $.command.register({ name: 'phone-alert', description: 'Phone alerts through ntfy or iMessage when Claude finishes or needs you' })
    const s = await settingsOf($)
    await update($, isOn, () => s.isOn && channelsOf(s).length > 0)
    await update($, channels, () => channelsOf(s))

    return next(e)
  })

  on('command.run', { command: 'phone-alert' }, async ($, e) => ({ text: await runCommand($, e.args) })).catch(() => ({
    text: 'Phone alert command failed.',
  }))

  on('prompt.edit', async ($, e, next) => {
    lastPromptAt = await $.clock.now()

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    lastPromptAt = await $.clock.now()
    pending.clear()

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    pending.clear()
    const seconds = Math.round(e.durationMs / 1000)
    if (e.agentId === undefined && !e.isAborted && seconds >= MIN_TURN_SECONDS) {
      void alertIfAway($, doneAlert(folder, seconds, e.reason === 'error')).catch(() => undefined)
    }

    return ran
  })

  // A permission prompt opened: alert if it's still unanswered once you've gone away.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id !== undefined) {
      const input = e.input as { command?: unknown; file_path?: unknown; url?: unknown }
      const what = [input.command, input.file_path, input.url].find(v => typeof v === 'string') as string | undefined
      void watchApproval($, e.tool_use_id, approvalAlert(folder, e.tool, what)).catch(() => undefined)
    }

    return verdict
  }).catch(($, e, next) => next(e))

  // Answered (allowed and run, or denied): stop waiting on it.
  on('tool.call', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (e.tool_use_id !== undefined) {
        pending.delete(e.tool_use_id)
      }
    }
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    for (const limit of e.rateLimits) {
      if (limit.percentUsed >= LIMIT_AT && !warnedLimits.has(limit.kind)) {
        warnedLimits.add(limit.kind)
        void alertIfAway($, limitAlert(limit.kind, limit.percentUsed)).catch(() => undefined)
      } else if (limit.percentUsed < LIMIT_AT) {
        warnedLimits.delete(limit.kind)
      }
    }

    return next(e)
  })
}
