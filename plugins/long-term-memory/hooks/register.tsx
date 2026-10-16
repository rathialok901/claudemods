import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Memory } from '../types'

const isOn = atom({ plugin: 'long-term-memory', key: 'isOn' } as const, true)
const facts = atom({ plugin: 'long-term-memory', key: 'facts' } as const, 0)
const lastSaved = atom({ plugin: 'long-term-memory', key: 'lastSaved' } as const, 0)
const isSaving = atom({ plugin: 'long-term-memory', key: 'isSaving' } as const, false)

const LIMITS = { preferences: 30, decisions: 40, history: 15 }
// Capture after this many turns, then every EVERY turns after that.
const FIRST = 3
const EVERY = 6

// ---- the file -----------------------------------------------------------------

const HEADER = `# Long-term memory

_Kept by the long-term-memory mod and given to every new Claude Code session as background.
Edit freely: add, change or delete lines, but keep the three headings._
`

export function parseMemory(text: string): Memory {
  const memory: Memory = { preferences: [], decisions: [], history: [] }
  let section: keyof Memory | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const heading = /^##\s+(preferences|decisions|history)\b/i.exec(line)
    if (heading) {
      section = heading[1]!.toLowerCase() as keyof Memory
    } else if (line.startsWith('#')) {
      section = undefined
    } else if (section !== undefined && /^[-*]\s+\S/.test(line)) {
      memory[section].push(line.replace(/^[-*]\s+/, ''))
    }
  }

  return memory
}

export function renderMemory(memory: Memory): string {
  const list = (items: readonly string[]) => (items.length === 0 ? '_(nothing yet)_' : items.map(item => `- ${item}`).join('\n'))

  return `${HEADER}
## Preferences
${list(memory.preferences)}

## Decisions
${list(memory.decisions)}

## History
${list(memory.history)}
`
}

function normal(text: string): string {
  return text
    .toLowerCase()
    .replace(/<!--.*?-->/g, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\(\d{4}-\d{2}-\d{2}\)\s*$/, '')
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type Capture = { summary: string; decisions: string[]; preferences: string[] }

// Add what a capture found: new items only, newest kept when a list is full, and one
// history line per session (rewritten as the session goes on).
export function merge(
  memory: Memory,
  found: Capture,
  context: { project: string; date: string; session: string },
): { memory: Memory; added: { decisions: number; preferences: number } } {
  const known = new Set([...memory.preferences, ...memory.decisions].map(normal))
  const fresh = (items: readonly string[]) =>
    items
      .map(item => item.trim())
      .filter(item => item !== '' && item.length <= 300 && !known.has(normal(item)))
      .filter((item, i, all) => all.findIndex(other => normal(other) === normal(item)) === i)

  const preferences = fresh(found.preferences)
  const decisions = fresh(found.decisions).map(item => `[${context.project}] ${item} (${context.date})`)
  const marker = `<!--s:${context.session}-->`
  const history = memory.history.filter(line => !line.includes(marker))
  if (found.summary.trim() !== '') {
    history.push(`${context.date} · ${context.project} · ${found.summary.trim()} ${marker}`)
  }

  return {
    memory: {
      preferences: [...memory.preferences, ...preferences].slice(-LIMITS.preferences),
      decisions: [...memory.decisions, ...decisions].slice(-LIMITS.decisions),
      history: history.slice(-LIMITS.history),
    },
    added: { decisions: decisions.length, preferences: preferences.length },
  }
}

export function parseCapture(text: string): Capture | undefined {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (json === undefined) {
    return undefined
  }
  try {
    const value = JSON.parse(json) as Record<string, unknown>
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

    return {
      summary: typeof value.summary === 'string' ? value.summary : '',
      decisions: strings(value.decisions),
      preferences: strings(value.preferences),
    }
  } catch {
    return undefined
  }
}

// What a new session is given: every preference, the decisions for this project and
// untagged ones, and the last few session summaries.
export function sectionText(memory: Memory, project: string): string {
  const decisions = memory.decisions.filter(item => !/^\[/.test(item) || item.startsWith(`[${project}]`))
  const history = memory.history.slice(-5).map(line => line.replace(/\s*<!--.*?-->/g, ''))
  if (memory.preferences.length + decisions.length + history.length === 0) {
    return ''
  }
  const block = (title: string, items: readonly string[]) => (items.length > 0 ? `## ${title}\n${items.map(item => `- ${item}`).join('\n')}` : '')

  return [
    '# Long-term memory (from earlier sessions)',
    'Background the user chose to keep across sessions. Follow the preferences; treat decisions as settled unless the user reopens them; the current request wins if anything conflicts.',
    block("The user's preferences", memory.preferences),
    block(`Decisions (project: ${project})`, decisions),
    block('Recent sessions', history),
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 6000)
}

// ---- the session ----------------------------------------------------------------

let turns = 0
let project = 'home'
let snapshot = ''

async function pathOf($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home !== undefined ? `${home}/.claude` : undefined)

  return dir === undefined ? undefined : `${dir}/long-term-memory/MEMORY.md`
}

async function load($: EngineInterface): Promise<Memory> {
  const path = await pathOf($)
  if (path === undefined || !(await $.fs.exists(path))) {
    return { preferences: [], decisions: [], history: [] }
  }

  return parseMemory(await $.fs.read(path))
}

async function save($: EngineInterface, memory: Memory) {
  const path = await pathOf($)
  if (path !== undefined) {
    await $.fs.write(path, renderMemory(memory))
  }
  await update($, facts, () => memory.preferences.length + memory.decisions.length)
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const ASK = (memory: Memory) => `Pause the task: this is a background note-taking request, not from the user. Do not mention it later.
Read our conversation so far and reply with JSON only, no prose:
{"summary": "...", "decisions": ["..."], "preferences": ["..."]}
- summary: at most 25 words on what this session is working on and where it stands now.
- decisions: concrete choices made in this conversation that should still hold in future sessions (technology, design, naming, structure, process). Self-contained, at most 20 words each.
- preferences: lasting things the user wants about how you work (tone, length, detail, tools, coding style) that they said or clearly showed. At most 20 words each.
Only include items that are NEW, not already in this list:
${[...memory.preferences, ...memory.decisions].map(item => `- ${item}`).join('\n') || '- (empty)'}
Use empty arrays when there is nothing new. Never include secrets, passwords, keys, tokens or personal details.`

async function capture($: EngineInterface, reason: 'auto' | 'manual' | 'compact'): Promise<string> {
  if (await read($, isSaving)) {
    return 'Already saving.'
  }
  await update($, isSaving, () => true)
  try {
    const memory = await load($)
    const reply = await $.model.fork({ prompt: ASK(memory) })
    if (!reply.isAnswered) {
      return reply.reason === 'nothing-to-fork' ? 'Nothing to remember yet: no conversation so far.' : 'Could not reach the model to take notes.'
    }
    const found = parseCapture(reply.text)
    if (found === undefined) {
      return 'The notes came back in the wrong shape; nothing was changed.'
    }
    const now = await $.clock.now()
    const session = (await $.session.id()).slice(0, 8)
    const result = merge(memory, found, { project, date: dayKey(now), session })
    await save($, result.memory)
    await update($, lastSaved, () => now)
    const { decisions, preferences } = result.added
    const parts = [decisions > 0 && `+${decisions} decision${decisions === 1 ? '' : 's'}`, preferences > 0 && `+${preferences} preference${preferences === 1 ? '' : 's'}`].filter(Boolean)
    if (parts.length > 0 || reason !== 'auto') {
      $.ui.toast(`🧠 Memory saved${parts.length > 0 ? `: ${parts.join(', ')}` : ' (summary updated)'}`)
    }

    return `🧠 Saved. ${parts.length > 0 ? parts.join(', ') : 'No new decisions or preferences'}; session summary updated.`
  } finally {
    await update($, isSaving, () => false)
  }
}

async function enabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get('enabled')) !== false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brain',
      description: 'Long-term memory: /brain, /brain save, /brain on|off, /brain forget <words>',
      argumentHint: 'save|on|off|forget <words>',
    })
    project = e.cwd.split('/').filter(Boolean).pop() ?? 'home'
    if (e.cwd === (await $.env.get('HOME'))) {
      project = 'home'
    }
    const isEnabled = await enabled($)
    await update($, isOn, () => isEnabled)
    const memory = await load($).catch(() => ({ preferences: [], decisions: [], history: [] }))
    await update($, facts, () => memory.preferences.length + memory.decisions.length)
    // Fixed for the session, so the system prompt (and its cache) stays the same turn to turn.
    snapshot = sectionText(memory, project)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (snapshot === '' || !(await read($, isOn))) {
      return composed
    }

    return { ...composed, sections: [...composed.sections, { id: 'long-term-memory:background', text: snapshot, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && !e.isAborted) {
      turns += 1
      if ((await read($, isOn)) && (turns === FIRST || (turns > FIRST && (turns - FIRST) % EVERY === 0))) {
        void capture($, 'auto').catch(() => undefined)
      }
    }

    return ran
  })

  // Before the conversation is shortened, note what it held.
  on('session.compact', async ($, e, next) => {
    if (e.trigger !== 'precompute' && (await read($, isOn)) && turns > 0) {
      await capture($, 'compact').catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'brain' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const path = (await pathOf($)) ?? '~/.claude/long-term-memory/MEMORY.md'
    if (verb === 'save') {
      return { text: await capture($, 'manual') }
    }
    if (verb === 'off' || verb === 'on') {
      await $.store.set('enabled', verb === 'on')
      await update($, isOn, () => verb === 'on')
      return {
        text:
          verb === 'on'
            ? '🧠 Long-term memory on (stays on in new sessions).'
            : '🧠 Long-term memory off (stays off in new sessions). Your saved memory is kept.',
      }
    }
    const memory = await load($)
    if (verb === 'forget' && rest.length > 0) {
      const words = rest.join(' ').toLowerCase()
      const keep = (items: string[]) => items.filter(item => !item.toLowerCase().includes(words))
      const kept: Memory = { preferences: keep(memory.preferences), decisions: keep(memory.decisions), history: memory.history }
      const removed = memory.preferences.length + memory.decisions.length - kept.preferences.length - kept.decisions.length
      await save($, kept)
      return { text: removed > 0 ? `Forgot ${removed} item${removed === 1 ? '' : 's'} mentioning “${words}”.` : `Nothing mentions “${words}”.` }
    }
    const recent = memory.history.slice(-3).map(line => `  · ${line.replace(/\s*<!--.*?-->/g, '')}`)

    return {
      text: [
        `🧠 Long-term memory is ${(await read($, isOn)) ? 'ON' : 'OFF'} · ${memory.preferences.length} preferences · ${memory.decisions.length} decisions · ${memory.history.length} sessions`,
        memory.preferences.length > 0 ? `Preferences:\n${memory.preferences.slice(-5).map(p => `  · ${p}`).join('\n')}` : '',
        memory.decisions.length > 0 ? `Latest decisions:\n${memory.decisions.slice(-5).map(d => `  · ${d}`).join('\n')}` : '',
        recent.length > 0 ? `Recent sessions:\n${recent.join('\n')}` : '',
        `File (edit freely): ${path}`,
        'Notes are taken every few turns and before compaction; /brain save takes them now.',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  }).catch(() => ({ text: 'Long-term memory: could not run that.' }))
}
