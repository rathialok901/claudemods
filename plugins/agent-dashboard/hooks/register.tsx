import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRow, AgentState } from '../types'

const PANE = 'agent-dashboard'
const TITLE = 'Agents'
const agents = atom({ plugin: 'agent-dashboard', key: 'agents' } as const, [])
const now = atom({ plugin: 'agent-dashboard', key: 'now' } as const, 0)

const ICONS: Record<AgentState, string> = {
  running: '⏳',
  done: '✅',
  failed: '❌',
  stopped: '⏹️',
}

const COLORS: Record<AgentState, string> = {
  running: 'yellow',
  done: 'green',
  failed: 'red',
  stopped: 'gray',
}

function base(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function short(text: string, max = 44): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// A few words on what an agent's latest tool call is doing.
export function doingOf(tool: string, raw: unknown): string {
  const input = (raw ?? {}) as Record<string, unknown>
  const s = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')

  switch (tool) {
    case 'Read':
      return `📖 reading ${base(s('file_path'))}`
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `✏️ editing ${base(s('file_path') || s('notebook_path'))}`
    case 'Bash':
      return `💻 ${short(s('description') || s('command'))}`
    case 'Grep':
      return `🔍 searching for ${short(s('pattern'), 30)}`
    case 'Glob':
      return `🔍 finding ${short(s('pattern'), 30)}`
    case 'WebFetch':
      return `🌐 reading ${short(s('url').replace(/^https?:\/\//, ''), 36)}`
    case 'WebSearch':
      return `🌐 searching “${short(s('query'), 32)}”`
    case 'Agent':
      return `🤖 delegating: ${short(s('description'), 34)}`
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return '📝 updating its task list'
    default:
      return `🔧 ${tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' › ') : tool}`
  }
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)

  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

let spawned = 0
let ticker: Timer | undefined

async function finish($: EngineInterface, match: (row: AgentRow) => boolean, state: AgentState) {
  const endedAt = await $.clock.now()
  await update($, agents, list =>
    list.map(row => (row.state === 'running' && match(row) ? { ...row, state, endedAt } : row)),
  )
}

// Redraw once a second while anything runs, so elapsed times move.
async function tick($: EngineInterface) {
  const t = await $.clock.now()
  await update($, now, () => t)
  const isRunning = (await read($, agents)).some(row => row.state === 'running')
  if (isRunning && ticker === undefined) {
    ticker = $.clock.every(1000, () => {
      void $.clock.now().then(t => update($, now, () => t))
    })
  } else if (!isRunning && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-panel',
      description: 'Show running and finished subagents in a pane',
    })

    return next(e)
  })

  on('command.run', { command: 'agent-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Agents pane opened.' }
  }).catch(() => ({ text: 'Could not open the Agents pane.' }))

  on('agent.spawn', async ($, e, next) => {
    spawned += 1
    const key = `${e.tool_use_id}#${spawned}`
    const row: AgentRow = {
      key,
      type: e.subagentType,
      description: e.description,
      startedAt: await $.clock.now(),
      state: 'running',
      tools: 0,
    }
    await update($, agents, list => [...list, row].slice(-100))
    // Not opened here: the mods center shows running agents; /agent-panel opens this view.
    await tick($)

    const ran = await next(e)
    if (ran.deny !== undefined || ran.agentId === undefined) {
      await finish($, one => one.key === key, 'failed')
    } else {
      const agentId = ran.agentId
      await update($, agents, list => list.map(one => (one.key === key ? { ...one, agentId } : one)))
    }
    await tick($)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const doing = doingOf(e.tool, e)
      await update($, agents, list =>
        list.map(row => (row.agentId === id ? { ...row, tools: row.tools + 1, doing } : row)),
      )
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const state: AgentState = e.isAborted ? 'stopped' : e.reason === 'error' ? 'failed' : 'done'
      await finish($, row => row.agentId === id, state)
      await tick($)
    } else if (e.isAborted) {
      // Esc on the main turn: anything still marked running was stopped with it.
      await finish($, row => row.agentId === undefined, 'stopped')
      await tick($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, agents)
    const at = Math.max(await read($, now), ...list.map(row => row.endedAt ?? row.startedAt))
    const running = list.filter(row => row.state === 'running').length
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 5) / 3))

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>
            {running} running · {list.length - running} finished{'  '}
          </Text>
          {list.length > running && (
            <Button
              key="clear"
              label="Clear finished"
              onPress={() => update($, agents, all => all.filter(row => row.state === 'running'))}
            />
          )}
        </Box>
        {list.length === 0 && <Text dimColor>No subagents yet this session.</Text>}
        {list.slice(-room).map(row => (
          <Box flexDirection="column" key={row.key}>
            <Text color={COLORS[row.state]} wrap="truncate-end">
              {ICONS[row.state]} {row.type} <Text bold>{row.description}</Text>
            </Text>
            <Text dimColor>
              {'   '}
              {elapsed((row.endedAt ?? at) - row.startedAt)} · {row.tools} tool
              {row.tools === 1 ? '' : 's'}
            </Text>
            {row.state === 'running' && (
              <Text color="cyan" wrap="truncate-end">
                {'   ↳ '}
                {row.doing ?? '🤔 thinking…'}
              </Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
