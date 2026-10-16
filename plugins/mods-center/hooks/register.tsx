import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Live, Spend } from '../types'
import { alivePids, folderName, kindLabel, lastPromptOf, parseSessionFile, transcriptPath, uptime } from './sessions'
import type { SessionRow } from './sessions'
import { nextTheme, themeOf } from './themes'
import type { Theme } from './themes'

const PANE = 'mods-center'
const TITLE = 'Mods'

// ---- this mod's values --------------------------------------------------------------

const tick = atom({ plugin: 'mods-center', key: 'tick' } as const, 0)
const spend = atom({ plugin: 'mods-center', key: 'spend' } as const, null)
const threshold = atom({ plugin: 'mods-center', key: 'threshold' } as const, 80)
const ruleCount = atom({ plugin: 'mods-center', key: 'ruleCount' } as const, 0)
const tab = atom({ plugin: 'mods-center', key: 'tab' } as const, 'mods')
const theme = atom({ plugin: 'mods-center', key: 'theme' } as const, 'classic')
const feed = atom({ plugin: 'mods-center', key: 'feed' } as const, [])
const sessions = atom({ plugin: 'mods-center', key: 'sessions' } as const, [])
const model = atom({ plugin: 'mods-center', key: 'model' } as const, '')
const profile = atom({ plugin: 'mods-center', key: 'profile' } as const, '')

// ---- the other mods' values, read only, each with its owner's default -----------------

const isCompact = atom({ plugin: 'tidy-view', key: 'isCompact' } as const, true)
const isZen = atom({ plugin: 'tidy-view', key: 'isZen' } as const, false)
const mascotHidden = atom({ plugin: 'mascot', key: 'isHidden' } as const, false)
const advisorOn = atom({ plugin: 'model-advisor', key: 'isOn' } as const, true)
const advisorPaused = atom({ plugin: 'model-advisor', key: 'isPaused' } as const, false)
const advisorLast = atom({ plugin: 'model-advisor', key: 'last' } as const, null)
const enhancerOn = atom({ plugin: 'prompt-enhancer', key: 'isOn' } as const, true)
const nextStepOn = atom({ plugin: 'next-step', key: 'isOn' } as const, true)
const compactOn = atom({ plugin: 'auto-compact', key: 'isOn' } as const, true)
const guardOn = atom({ plugin: 'guardrails', key: 'isOn' } as const, true)
const guardBlocks = atom({ plugin: 'guardrails', key: 'blocks' } as const, [])
const budgetOn = atom({ plugin: 'budget-guard', key: 'isOn' } as const, true)
const explainOn = atom({ plugin: 'explain-risky', key: 'isOn' } as const, true)
const phoneOn = atom({ plugin: 'phone-alert', key: 'isOn' } as const, false)
const phoneChannels = atom({ plugin: 'phone-alert', key: 'channels' } as const, [])
const phoneSent = atom({ plugin: 'phone-alert', key: 'lastSent' } as const, null)
const checkpoints = atom({ plugin: 'undo-last', key: 'checkpoints' } as const, [])
const agents = atom({ plugin: 'agent-dashboard', key: 'agents' } as const, [])
// Ticks every second while an agent runs, so elapsed times move.
const agentClock = atom({ plugin: 'agent-dashboard', key: 'now' } as const, 0)
const memoryOn = atom({ plugin: 'long-term-memory', key: 'isOn' } as const, true)
const memoryFacts = atom({ plugin: 'long-term-memory', key: 'facts' } as const, 0)
const memorySaving = atom({ plugin: 'long-term-memory', key: 'isSaving' } as const, false)
const memorySaved = atom({ plugin: 'long-term-memory', key: 'lastSaved' } as const, 0)

// ---- pure helpers -------------------------------------------------------------------

export type Tone = 'on' | 'off' | 'info' | 'warn'
export type Row = {
  key: string
  icon: string
  name: string
  tone: Tone
  status: string
  action?: { label: string; command: string; args?: string; hotkey: string }
}
export type Group = { title: string; color: string; rows: Row[] }

const TONE_DOT: Record<Tone, string> = { on: '●', off: '○', info: '◆', warn: '▲' }

export function toneColor(t: Theme, tone: Tone): string {
  return tone === 'on' ? t.on : tone === 'off' ? t.off : tone === 'warn' ? t.warn : t.info
}

export function bar(share: number, cells = 10): string {
  const filled = Math.max(0, Math.min(cells, Math.round(share * cells)))

  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export function onOff(isOn: boolean): { tone: Tone; status: string } {
  return isOn ? { tone: 'on', status: 'ON' } : { tone: 'off', status: 'OFF' }
}

export function counts(groups: readonly Group[]): { total: number; on: number; off: number } {
  const rows = groups.flatMap(group => group.rows)

  return {
    total: rows.length,
    on: rows.filter(row => row.tone === 'on' || row.tone === 'info').length,
    off: rows.filter(row => row.tone === 'off').length,
  }
}

export function prettyModel(id: string): string {
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!m) {
    return id
  }
  const minor = m[3] !== undefined && m[3].length <= 2 ? `.${m[3]}` : ''

  return `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)} ${m[2]}${minor}`
}

export function seconds(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))

  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`
}

export function kTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `${Math.round(n / 1000)}k`
}

export function clock(ms: number): string {
  const d = new Date(ms)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---- switches and profiles ----------------------------------------------------------

export type SwitchId = 'compact' | 'zen' | 'mascot' | 'advisor' | 'enhancer' | 'next' | 'autocompact' | 'explain'
type Switch = { label: string; command: string; style: 'toggle' | 'onoff' }

// Guardrails and the budget are left out on purpose: safety starts ON in every session.
export const SWITCHES: Record<SwitchId, Switch> = {
  compact: { label: 'Compact tools', command: 'compact-tools', style: 'toggle' },
  zen: { label: 'Zen mode', command: 'zen', style: 'toggle' },
  mascot: { label: 'Mascot', command: 'mascot', style: 'toggle' },
  advisor: { label: 'Model advisor', command: 'model-advisor', style: 'onoff' },
  enhancer: { label: 'Prompt enhancer', command: 'enhancer', style: 'toggle' },
  next: { label: 'Next step', command: 'next-step', style: 'toggle' },
  autocompact: { label: 'Auto-compact', command: 'compact-at', style: 'onoff' },
  explain: { label: 'Explain risky', command: 'explain-risky', style: 'toggle' },
}

export const DEFAULTS: Record<SwitchId, boolean> = {
  compact: true,
  zen: false,
  mascot: true,
  advisor: true,
  enhancer: true,
  next: true,
  autocompact: true,
  explain: true,
}

type Profile = { label: string; hotkey: string; blurb: string; switches: Partial<Record<SwitchId, boolean>>; extra: { command: string; args: string }[] }

export const PROFILES: Record<string, Profile> = {
  focus: { label: '🎯 Focus', hotkey: 'f', blurb: 'zen on, mascot and suggestions off', switches: { zen: true, mascot: false, next: false, compact: true }, extra: [] },
  saver: {
    label: '💸 Saver',
    hotkey: 'v',
    blurb: 'advisor on, compact at 25%',
    switches: { advisor: true, autocompact: true, compact: true },
    extra: [{ command: 'compact-at', args: '25' }],
  },
  learning: {
    label: '🎓 Learning',
    hotkey: 'w',
    blurb: 'full tool output, explanations, enhancer on',
    switches: { zen: false, compact: false, explain: true, enhancer: true, mascot: true },
    extra: [],
  },
  default: { label: '🌈 Default', hotkey: 'd', blurb: 'everything back to normal', switches: DEFAULTS, extra: [{ command: 'compact-at', args: '80' }] },
}

// The switches a saved set changes from what is on now.
export function changesFor(current: Record<SwitchId, boolean>, wanted: Partial<Record<SwitchId, boolean>>): SwitchId[] {
  return (Object.keys(wanted) as SwitchId[]).filter(id => id in SWITCHES && wanted[id] !== undefined && wanted[id] !== current[id])
}

async function switchStates($: EngineInterface): Promise<Record<SwitchId, boolean>> {
  return {
    compact: await read($, isCompact),
    zen: await read($, isZen),
    mascot: !(await read($, mascotHidden)),
    advisor: await read($, advisorOn),
    enhancer: await read($, enhancerOn),
    next: await read($, nextStepOn),
    autocompact: await read($, compactOn),
    explain: await read($, explainOn),
  }
}

async function runCommand($: EngineInterface, command: string, args = '') {
  await $.command.run({ command, args }).catch(() => undefined)
}

async function applySwitches($: EngineInterface, wanted: Partial<Record<SwitchId, boolean>>): Promise<string[]> {
  const changed = changesFor(await switchStates($), wanted)
  for (const id of changed) {
    const sw = SWITCHES[id]
    await runCommand($, sw.command, sw.style === 'onoff' ? (wanted[id] ? 'on' : 'off') : '')
  }

  return changed.map(id => `${SWITCHES[id].label} ${wanted[id] ? 'on' : 'off'}`)
}

async function rememberSwitches($: EngineInterface) {
  await $.store.set('switches', await switchStates($))
}

async function restoreSwitches($: EngineInterface) {
  const saved = (await $.store.get('switches')) as Partial<Record<SwitchId, boolean>> | null | undefined
  const savedProfile = await $.store.get('profile')
  if (typeof savedProfile === 'string') {
    await update($, profile, () => savedProfile)
  }
  if (saved === null || saved === undefined || typeof saved !== 'object') {
    return
  }
  const done = await applySwitches($, saved)
  if (done.length > 0) {
    $.ui.toast(`🎛️ Restored your switches: ${done.join(', ')}`)
    await log($, '🎛️', `Restored: ${done.join(', ')}`, 'info')
  }
}

async function applyProfile($: EngineInterface, id: string) {
  const chosen = PROFILES[id]
  if (chosen === undefined) {
    return
  }
  const done = await applySwitches($, chosen.switches)
  for (const step of chosen.extra) {
    await runCommand($, step.command, step.args)
  }
  await update($, profile, () => id)
  await $.store.set('profile', id)
  await rememberSwitches($)
  await refreshStores($)
  $.ui.toast(`${chosen.label} profile on${done.length > 0 ? `: ${done.join(', ')}` : ''}`)
  await log($, chosen.label.split(' ')[0] ?? '🎛️', `${chosen.label.slice(chosen.label.indexOf(' ') + 1)} profile: ${chosen.blurb}`, 'info')
}

// ---- activity feed ------------------------------------------------------------------

async function log($: EngineInterface, icon: string, text: string, tone: Activity['tone']) {
  const at = await $.clock.now()
  const entry: Activity = { at, icon, text, tone }
  await update($, feed, list => [entry, ...list].slice(0, 60))
}

type Seen = {
  ready: boolean
  blocks: number
  model: string
  saved: number
  checkpoints: number
  agents: Record<string, string>
  switches: Record<string, boolean>
  budgetShare: number
  phoneAt: number
}

const seen: Seen = { ready: false, blocks: 0, model: '', saved: 0, checkpoints: 0, agents: {}, switches: {}, budgetShare: 0, phoneAt: 0 }

// Compares what the mods hold now with what they held last time, and writes what changed to the feed.
async function scan($: EngineInterface) {
  const blocks = await read($, guardBlocks)
  const id = await $.session.model()
  const saved = await read($, memorySaved)
  const points = (await read($, checkpoints)).length
  const agentList = await read($, agents)
  const switches = await switchStates($)
  const sent = await read($, phoneSent)
  await update($, model, () => id)

  if (seen.ready) {
    for (const block of blocks.slice(0, Math.max(0, blocks.length - seen.blocks)).reverse()) {
      await log($, '🛡️', `Blocked: ${block.reason}`, 'off')
    }
    if (seen.model !== '' && prettyModel(seen.model) !== prettyModel(id)) {
      const last = await read($, advisorLast)
      await log($, '🧭', `Model → ${prettyModel(id)}${last ? ` (${last.tier} task)` : ''}`, 'info')
    }
    if (saved > seen.saved) {
      await log($, '🧠', `Memory saved · ${await read($, memoryFacts)} facts`, 'on')
    }
    if (points > seen.checkpoints) {
      await log($, '↩️', 'Checkpoint saved before edits', 'info')
    } else if (points < seen.checkpoints) {
      await log($, '↩️', 'Undo applied', 'warn')
    }
    for (const agent of agentList) {
      const before = seen.agents[agent.key]
      if (before === undefined) {
        await log($, '🤖', `Agent started: ${agent.type} · ${agent.description}`, 'warn')
      } else if (before === 'running' && agent.state !== 'running') {
        await log($, agent.state === 'done' ? '✅' : '❌', `Agent ${agent.state}: ${agent.description}`, agent.state === 'done' ? 'on' : 'off')
      }
    }
    if (sent !== null && sent.at > seen.phoneAt) {
      await log($, '📱', `Sent to phone (${sent.via.join('+')}): ${sent.text}`, 'info')
    }
    for (const sid of Object.keys(switches) as SwitchId[]) {
      if (seen.switches[sid] !== undefined && seen.switches[sid] !== switches[sid]) {
        await log($, '🎛️', `${SWITCHES[sid].label} ${switches[sid] ? 'on' : 'off'}`, switches[sid] ? 'on' : 'off')
      }
    }
  }
  seen.ready = true
  seen.blocks = blocks.length
  seen.model = id
  seen.saved = saved
  seen.checkpoints = points
  seen.agents = Object.fromEntries(agentList.map(agent => [agent.key, agent.state]))
  seen.switches = switches
  seen.phoneAt = sent?.at ?? seen.phoneAt
}

// ---- other mods' stores, and the sessions on this machine ----------------------------

async function configDir($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')

  return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home !== undefined ? `${home}/.claude` : undefined)
}

async function storeFile($: EngineInterface, prefix: string): Promise<Record<string, unknown> | undefined> {
  const dir = await configDir($)
  if (dir === undefined || !(await $.fs.exists(`${dir}/plugins/store`))) {
    return undefined
  }
  const entry = (await $.fs.list(`${dir}/plugins/store`)).find(one => one.name.startsWith(`${prefix}_`))
  if (entry === undefined) {
    return undefined
  }

  return JSON.parse(await $.fs.read(`${dir}/plugins/store/${entry.name}`)) as Record<string, unknown>
}

async function refreshStores($: EngineInterface) {
  const budget = await storeFile($, 'budget-guard').catch(() => undefined)
  const days = (budget?.days ?? {}) as Record<string, number>
  const limit = typeof budget?.limit === 'number' ? budget.limit : 25
  const value: Spend = { today: days[dayKey(await $.clock.now())] ?? 0, limit }
  await update($, spend, () => value)
  const share = value.today / value.limit
  for (const mark of [0.5, 0.8, 1]) {
    if (seen.ready && seen.budgetShare < mark && share >= mark) {
      await log($, '💰', `Budget at ${Math.round(mark * 100)}%: $${value.today.toFixed(2)} of $${value.limit}`, mark >= 1 ? 'off' : 'warn')
    }
  }
  seen.budgetShare = share

  const compact = await storeFile($, 'auto-compact').catch(() => undefined)
  const at = typeof compact?.threshold === 'number' ? compact.threshold : 80
  await update($, threshold, () => at)

  const style = await storeFile($, 'style-rules').catch(() => undefined)
  const rules = Array.isArray(style?.rules) ? style.rules.length : 0
  await update($, ruleCount, () => rules)

  const t = await $.clock.now()
  await update($, tick, () => t)
}

async function refreshSessions($: EngineInterface) {
  const dir = await configDir($)
  if (dir === undefined || !(await $.fs.exists(`${dir}/sessions`))) {
    return
  }
  const me = await $.session.id()
  const home = await $.env.get('HOME')
  const rows: SessionRow[] = []
  for (const entry of await $.fs.list(`${dir}/sessions`)) {
    if (entry.kind === 'file' && entry.name.endsWith('.json')) {
      const row = parseSessionFile(await $.fs.read(`${dir}/sessions/${entry.name}`).catch(() => ''), me)
      if (row !== undefined) {
        rows.push(row)
      }
    }
  }
  if (rows.length === 0) {
    await update($, sessions, () => [])
    return
  }
  const ps = await $.process.run(['ps', '-o', 'pid=', '-p', rows.map(row => row.pid).join(',')], { timeoutMs: 5000 })
  const alive = alivePids(ps.stdout)
  const live: Live[] = []
  for (const row of rows.filter(one => alive.has(one.pid))) {
    let lastPrompt = ''
    const path = transcriptPath(dir, row.cwd, row.sessionId)
    if (await $.fs.exists(path)) {
      const tail = await $.process.run(['tail', '-n', '120', path], { timeoutMs: 5000 })
      lastPrompt = lastPromptOf(tail.stdout)
    }
    live.push({
      pid: row.pid,
      name: row.name,
      folder: folderName(row.cwd, home),
      kind: kindLabel(row.kind),
      status: row.status,
      startedAt: row.startedAt,
      isMe: row.isMe,
      lastPrompt,
    })
  }
  live.sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(b.status === 'busy') - Number(a.status === 'busy') || b.startedAt - a.startedAt)
  await update($, sessions, () => live)
}

// ---- the Mods tab's rows --------------------------------------------------------------

async function groupsOf($: EngineInterface, t: Theme): Promise<Group[]> {
  const zen = await read($, isZen)
  const advisor = (await read($, advisorOn)) && !(await read($, advisorPaused))
  const last = await read($, advisorLast)
  const blocks = (await read($, guardBlocks)).length
  const money = await read($, spend)
  const turns = (await read($, checkpoints)).length
  const running = (await read($, agents)).filter(one => one.state === 'running').length
  const rules = await read($, ruleCount)
  const usage = await $.session.usage()
  const fiveHour = usage.rateLimits.find(limit => limit.kind === 'five_hour')

  return [
    {
      title: 'LOOK & FEEL',
      color: t.groups.look,
      rows: [
        { key: 'compact', icon: '🗜️', name: 'Compact tools', ...onOff(await read($, isCompact)), action: { label: 'switch', command: 'compact-tools', hotkey: 'c' } },
        { key: 'zen', icon: '🧘', name: 'Zen mode', ...onOff(zen), action: { label: 'switch', command: 'zen', hotkey: 'z' } },
        { key: 'mascot', icon: '🐱', name: 'Mascot', ...onOff(!(await read($, mascotHidden))), action: { label: 'switch', command: 'mascot', hotkey: 'm' } },
        { key: 'hud', icon: '📋', name: 'Session HUD', tone: 'info', status: 'panel', action: { label: 'open', command: 'hud', hotkey: 'h' } },
      ],
    },
    {
      title: 'SMARTER',
      color: t.groups.smart,
      rows: [
        {
          key: 'advisor',
          icon: '🧭',
          name: 'Model advisor',
          ...(advisor ? { tone: 'on' as const, status: last ? `ON → ${last.model}` : 'ON' } : onOff(false)),
          action: { label: 'switch', command: 'model-advisor', args: advisor ? 'off' : 'on', hotkey: 'a' },
        },
        {
          key: 'memory',
          icon: '🧠',
          name: 'Long-term memory',
          ...(!(await read($, memoryOn))
            ? onOff(false)
            : (await read($, memorySaving))
              ? { tone: 'warn' as const, status: 'saving…' }
              : { tone: 'on' as const, status: `ON · ${await read($, memoryFacts)} facts` }),
          action: { label: 'switch', command: 'brain', args: (await read($, memoryOn)) ? 'off' : 'on', hotkey: 'l' },
        },
        { key: 'style', icon: '🎨', name: 'Style rules', tone: rules > 0 ? 'on' : 'info', status: rules > 0 ? `${rules} rule${rules === 1 ? '' : 's'}` : 'none yet', action: { label: 'list', command: 'style', hotkey: 's' } },
        { key: 'enhancer', icon: '✨', name: 'Prompt enhancer', ...onOff(await read($, enhancerOn)), action: { label: 'switch', command: 'enhancer', hotkey: 'e' } },
        { key: 'next', icon: '👉', name: 'Next step', ...onOff(await read($, nextStepOn)), action: { label: 'switch', command: 'next-step', hotkey: 'n' } },
        {
          key: 'autocompact',
          icon: '📦',
          name: 'Auto-compact',
          ...((await read($, compactOn)) ? { tone: 'on' as const, status: `at ${await read($, threshold)}%` } : onOff(false)),
          action: { label: 'switch', command: 'compact-at', args: (await read($, compactOn)) ? 'off' : 'on', hotkey: 'p' },
        },
      ],
    },
    {
      title: 'SAFETY',
      color: t.groups.safety,
      rows: [
        {
          key: 'guardrails',
          icon: '🛡️',
          name: 'Guardrails',
          ...((await read($, guardOn)) ? { tone: 'on' as const, status: blocks > 0 ? `ON · ${blocks} blocked` : 'ON' } : { tone: 'off' as const, status: 'OFF ⚠' }),
          action: { label: 'switch', command: 'guardrails', args: (await read($, guardOn)) ? 'off' : 'on', hotkey: 'g' },
        },
        {
          key: 'budget',
          icon: '💰',
          name: 'Budget',
          ...(!(await read($, budgetOn))
            ? onOff(false)
            : money === null
              ? { tone: 'on' as const, status: 'ON' }
              : { tone: money.today >= money.limit ? ('warn' as const) : ('on' as const), status: `$${money.today.toFixed(2)} / $${money.limit}` }),
          action: { label: 'report', command: 'budget', hotkey: 'b' },
        },
        { key: 'explain', icon: '💡', name: 'Explain risky', ...onOff(await read($, explainOn)), action: { label: 'switch', command: 'explain-risky', hotkey: 'x' } },
        { key: 'undo', icon: '↩️', name: 'Undo last', tone: turns > 0 ? 'on' : 'info', status: turns > 0 ? `${turns} saved` : 'nothing yet', action: { label: 'undo', command: 'undo-last', hotkey: 'u' } },
      ],
    },
    {
      title: 'STATUS',
      color: t.groups.status,
      rows: [
        { key: 'meter', icon: '📊', name: 'Usage meter', tone: 'info', status: fiveHour ? `5h ${Math.round(fiveHour.percentUsed)}%` : 'watching' },
        { key: 'agents', icon: '🤖', name: 'Agent panel', tone: running > 0 ? 'warn' : 'info', status: running > 0 ? `${running} running` : 'idle', action: { label: 'open', command: 'agent-panel', hotkey: 'r' } },
        { key: 'sound', icon: '🔔', name: 'Done sound', tone: 'info', status: 'always on' },
        await phoneRow($),
      ],
    },
  ]
}

// Phone alerts: set up first (the press shows how), then an on/off switch naming the channels.
async function phoneRow($: EngineInterface): Promise<Row> {
  const via = await read($, phoneChannels)
  if (via.length === 0) {
    return { key: 'phone', icon: '📱', name: 'Phone alert', tone: 'info', status: 'not set up', action: { label: 'set up', command: 'phone-alert', hotkey: 'i' } }
  }
  const on = await read($, phoneOn)

  return {
    key: 'phone',
    icon: '📱',
    name: 'Phone alert',
    tone: on ? 'on' : 'off',
    status: on ? `ON · ${via.join('+')}` : 'OFF',
    action: { label: 'switch', command: 'phone-alert', args: on ? 'off' : 'on', hotkey: 'i' },
  }
}

// A panel button's press: run the command, then remember the switches and look for changes.
function press($: EngineInterface, command: string, args = '') {
  void runCommand($, command, args)
    .then(() => rememberSwitches($))
    .then(() => refreshStores($))
    .then(() => scan($))
    .catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Open the mods control center' })
    const savedTheme = await $.store.get('theme')
    if (typeof savedTheme === 'string') {
      await update($, theme, () => savedTheme)
    }
    // Opened at once and alone, so it is always the panel in front.
    void $.ui.open({ id: PANE, title: TITLE })
    void refreshStores($).catch(() => undefined)
    void refreshSessions($).catch(() => undefined)
    void scan($).catch(() => undefined)
    $.clock.every(4000, () => void scan($).catch(() => undefined))
    $.clock.every(15000, () => void refreshSessions($).catch(() => undefined))
    $.clock.every(30000, () => void refreshStores($).catch(() => undefined))
    // Once the other mods are up, put back the switches from last time.
    $.clock.after(2500, () => void restoreSwitches($).catch(() => undefined))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await rememberSwitches($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    void refreshStores($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Mods control center opened. Click a button, or press ctrl+x tab and use the keys shown.' }
  }).catch(() => ({ text: 'Could not open the mods control center.' }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      void refreshStores($).catch(() => undefined)
      void rememberSwitches($).catch(() => undefined)
      void scan($).catch(() => undefined)
    }

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    if (e.trigger !== 'precompute' && ran.messages !== undefined) {
      await log($, '📦', 'Conversation compacted', 'info')
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, tick)
    const t = themeOf(await read($, theme))
    const current = await read($, tab)
    const live = await read($, sessions)
    const events = await read($, feed)
    const width = Math.max(30, e.props.bodyColumns)
    const title = '✦ MODS CONTROL CENTER ✦'

    const header = (
      <Box flexDirection="column">
        <Text bold>
          {[...title].map((ch, i) => (
            <Text color={t.title[i % t.title.length]}>{ch}</Text>
          ))}
        </Text>
        <Box flexDirection="row" marginTop={1}>
          <Button key="tab-mods" label={`${current === 'mods' ? '▸ ' : ''}🎛️ Mods`} hotkey="1" onPress={() => void update($, tab, () => 'mods')} />
          <Text> </Text>
          <Button
            key="tab-sessions"
            label={`${current === 'sessions' ? '▸ ' : ''}🖥️ Sessions ${live.length}`}
            hotkey="2"
            onPress={() => {
              void update($, tab, () => 'sessions')
              void refreshSessions($).catch(() => undefined)
            }}
          />
          <Text> </Text>
          <Button key="tab-activity" label={`${current === 'activity' ? '▸ ' : ''}⚡ Activity ${events.length}`} hotkey="3" onPress={() => void update($, tab, () => 'activity')} />
        </Box>
      </Box>
    )

    if (current === 'sessions') {
      const now = await $.clock.now()
      const busy = live.filter(one => one.status === 'busy').length

      return (
        <Box flexDirection="column" width={width}>
          {header}
          <Box marginTop={1}>
            <Text>
              <Text color={t.accent} bold>
                {live.length} Claude session{live.length === 1 ? '' : 's'}
              </Text>
              <Text dimColor> on this Mac · </Text>
              <Text color={busy > 0 ? t.warn : t.on} bold>
                {busy} busy
              </Text>
              <Text dimColor> · {live.length - busy} idle</Text>
            </Text>
          </Box>
          {live.length === 0 && <Text dimColor>No other sessions found.</Text>}
          {live.map(one => (
            <Box
              key={`s-${one.pid}`}
              flexDirection="column"
              marginTop={1}
              borderStyle="round"
              borderColor={one.isMe ? t.accent : one.status === 'busy' ? t.warn : t.border}
              paddingX={1}
            >
              <Box flexDirection="row" justifyContent="space-between">
                <Text wrap="truncate-end">
                  <Text color={one.status === 'busy' ? t.warn : t.on}>{one.status === 'busy' ? '◉' : '●'}</Text>{' '}
                  <Text bold>{one.name}</Text>
                  {one.isMe && <Text color={t.accent}> (this one)</Text>}
                </Text>
                <Text color={one.status === 'busy' ? t.warn : t.on} bold>
                  {one.status}
                </Text>
              </Box>
              <Text dimColor wrap="truncate-end">
                📁 {one.folder} · {one.kind} · up {uptime(now - one.startedAt)} · pid {one.pid}
              </Text>
              {one.lastPrompt !== '' && (
                <Text wrap="truncate-end" italic>
                  💬 “{one.lastPrompt}”
                </Text>
              )}
            </Box>
          ))}
          <Box marginTop={1} flexDirection="row">
            <Button key="refresh-sessions" label="o · refresh" hotkey="o" onPress={() => void refreshSessions($).catch(() => undefined)} />
            <Text dimColor> updates every 15s</Text>
          </Box>
        </Box>
      )
    }

    if (current === 'activity') {
      return (
        <Box flexDirection="column" width={width}>
          {header}
          <Box marginTop={1}>
            <Text color={t.accent} bold>
              What your mods have been doing
            </Text>
          </Box>
          {events.length === 0 && <Text dimColor>Nothing yet. Model switches, blocks, memory saves, agents and switch changes show up here.</Text>}
          {events.slice(0, Math.max(5, e.props.scroll.bodyRows - 8)).map((one, i) => (
            <Text key={`a-${i}-${one.at}`} wrap="truncate-end">
              <Text dimColor>{clock(one.at)} </Text>
              {one.icon} <Text color={toneColor(t, one.tone)}>{one.text}</Text>
            </Text>
          ))}
          {events.length > 0 && (
            <Box marginTop={1}>
              <Button key="clear-feed" label="q · clear" hotkey="q" onPress={() => void update($, feed, () => [])} />
            </Box>
          )}
        </Box>
      )
    }

    const groups = await groupsOf($, t)
    const total = counts(groups)
    const usage = await $.session.usage()
    const ctx = usage.context
    const at = await read($, threshold)
    const money = await read($, spend)
    const id = (await read($, model)) || (await $.session.model())
    const chosen = PROFILES[await read($, profile)]
    const left = ctx.tokens !== undefined ? Math.max(0, Math.round((ctx.window * at) / 100) - ctx.tokens) : undefined
    const agentList = await read($, agents)
    const working = agentList.filter(one => one.state === 'running')
    const finished = agentList.length - working.length
    const agentNow = Math.max(await read($, agentClock), ...agentList.map(one => one.startedAt))

    return (
      <Box flexDirection="column" width={width}>
        {header}
        <Box marginTop={1}>
          <Text wrap="truncate-end">
            <Text color={t.on} bold>
              {total.on} on
            </Text>
            <Text dimColor> · </Text>
            <Text color={total.off > 0 ? t.off : 'gray'} bold={total.off > 0}>
              {total.off} off
            </Text>
            <Text dimColor> · {total.total} mods</Text>
            {chosen !== undefined && <Text dimColor> · profile </Text>}
            {chosen !== undefined && <Text color={t.accent}>{chosen.label}</Text>}
          </Text>
        </Box>
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={t.border} paddingX={1}>
          <Text wrap="truncate-end">
            <Text dimColor>model   </Text>
            <Text color={t.accent} bold>
              🧠 {prettyModel(id)}
            </Text>
            <Text dimColor> · {kTokens(ctx.window)} window</Text>
          </Text>
          <Text wrap="truncate-end">
            <Text dimColor>context </Text>
            <Text color={ctx.percent === undefined ? 'gray' : ctx.percent >= at ? t.off : ctx.percent >= at - 15 ? t.warn : t.bars.context}>
              {bar((ctx.percent ?? 0) / 100)}
            </Text>
            <Text bold> {ctx.percent === undefined ? '–' : `${Math.round(ctx.percent)}%`}</Text>
            {left !== undefined && <Text dimColor> · compacts at {at}% · {kTokens(left)} left</Text>}
          </Text>
          {money !== null && (
            <Text wrap="truncate-end">
              <Text dimColor>budget  </Text>
              <Text color={money.today >= money.limit ? t.off : money.today >= money.limit * 0.8 ? t.warn : t.bars.budget}>{bar(money.today / money.limit)}</Text>
              <Text bold> ${money.today.toFixed(2)}</Text>
              <Text dimColor> of ${money.limit}</Text>
            </Text>
          )}
          {usage.rateLimits.map(limit => (
            <Text key={limit.kind} wrap="truncate-end">
              <Text dimColor>{(limit.kind === 'five_hour' ? '5h' : limit.kind === 'seven_day' ? '7d' : limit.kind).padEnd(8)}</Text>
              <Text color={limit.percentUsed >= 85 ? t.off : limit.percentUsed >= 60 ? t.warn : t.bars.limits}>{bar(limit.percentUsed / 100)}</Text>
              <Text bold> {Math.round(limit.percentUsed)}%</Text>
            </Text>
          ))}
        </Box>
        {working.length > 0 && (
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={t.warn} paddingX={1}>
            <Text>
              <Text color={t.warn} bold>
                🤖 {working.length} AGENT{working.length === 1 ? '' : 'S'} WORKING
              </Text>
              {finished > 0 && <Text dimColor> · {finished} finished</Text>}
            </Text>
            {working.map(one => (
              <Box key={`ag-${one.key}`} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between">
                  <Text wrap="truncate-end">
                    <Text color={t.warn}>⏳</Text> <Text color={t.accent}>{one.type}</Text> <Text bold>{one.description}</Text>
                  </Text>
                  <Text dimColor> {seconds(agentNow - one.startedAt)}</Text>
                </Box>
                <Text color={t.info} wrap="truncate-end">
                  {'   ↳ '}
                  {one.doing ?? '🤔 thinking…'}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={t.accent} bold>
            ▌ PROFILES
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          {Object.entries(PROFILES).map(([key, one]) => (
            <Box key={`p-${key}`} marginRight={1}>
              <Button key={`profile-${key}`} label={`${one.hotkey} · ${one.label}`} hotkey={one.hotkey} onPress={() => void applyProfile($, key).catch(() => undefined)} />
            </Box>
          ))}
        </Box>
        {groups.map(group => (
          <Box key={group.title} flexDirection="column" marginTop={1}>
            <Text>
              <Text color={group.color}>▌</Text>
              <Text color={group.color} bold>
                {' '}
                {group.title}
              </Text>
            </Text>
            {group.rows.map(row => (
              <Box key={row.key} flexDirection="row">
                <Box flexShrink={1} flexGrow={1}>
                  <Text wrap="truncate-end">
                    <Text color={toneColor(t, row.tone)}>{TONE_DOT[row.tone]}</Text> {row.icon} {row.name.padEnd(17)}
                    <Text color={toneColor(t, row.tone)} bold={row.tone !== 'info'}>
                      {row.status}
                    </Text>
                  </Text>
                </Box>
                {row.action !== undefined && (
                  <Box flexShrink={0} marginLeft={1}>
                    <Button
                      key={`do-${row.key}`}
                      label={`${row.action.hotkey} · ${row.action.label}`}
                      hotkey={row.action.hotkey}
                      onPress={() => {
                        const action = row.action
                        if (action !== undefined) {
                          press($, action.command, action.args ?? '')
                        }
                      }}
                    />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        ))}
        <Box marginTop={1} flexDirection="row">
          <Button
            key="theme"
            label={`t · theme: ${t.label}`}
            hotkey="t"
            onPress={() => {
              void read($, theme)
                .then(name => {
                  const nextName = nextTheme(name)
                  return update($, theme, () => nextName).then(() => $.store.set('theme', nextName))
                })
                .catch(() => undefined)
            }}
          />
        </Box>
        <Text dimColor wrap="truncate-end">
          click a button · or ctrl+x tab, then its key · Esc to leave
        </Text>
      </Box>
    )
  })
}
