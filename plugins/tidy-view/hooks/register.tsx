import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isCompact = atom({ plugin: 'tidy-view', key: 'isCompact' } as const, true)
const isZen = atom({ plugin: 'tidy-view', key: 'isZen' } as const, false)
const activity = atom({ plugin: 'tidy-view', key: 'activity' } as const, '')

type Input = Record<string, unknown>

function str(input: Input, key: string): string {
  const value = input[key]

  return typeof value === 'string' ? value : ''
}

function lines(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)

  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`
}

export function oneLine(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// One-line summary of a tool call: [icon, label, detail]; undefined leaves the engine's row.
export function summarize(tool: string, raw: unknown): [string, string, string] | undefined {
  const input = (raw ?? {}) as Input

  switch (tool) {
    case 'Edit': {
      const added = lines(str(input, 'new_string'))
      const removed = lines(str(input, 'old_string'))
      return ['✏️', shortPath(str(input, 'file_path')), `+${added} −${removed}`]
    }
    case 'Write':
      return ['📝', shortPath(str(input, 'file_path')), `${lines(str(input, 'content'))} lines`]
    case 'NotebookEdit':
      return ['📓', shortPath(str(input, 'notebook_path')), '']
    case 'Read':
      return ['📖', shortPath(str(input, 'file_path')), '']
    case 'Bash':
      return ['💻', oneLine(str(input, 'description') || str(input, 'command'), 50), '']
    case 'Grep':
    case 'Glob':
      return ['🔍', oneLine(str(input, 'pattern'), 40), str(input, 'path') ? shortPath(str(input, 'path')) : '']
    case 'WebFetch':
      return ['🌐', oneLine(str(input, 'url'), 50), '']
    case 'WebSearch':
      return ['🌐', oneLine(str(input, 'query'), 50), '']
    case 'Agent':
      return ['🤖', oneLine(str(input, 'description'), 50), str(input, 'subagent_type')]
    case 'Skill':
      return ['🧩', str(input, 'skill'), '']
    default:
      return undefined
  }
}

// What the spinner says in zen mode.
export function describe(tool: string, raw: unknown): string {
  const input = (raw ?? {}) as Input
  const file = shortPath(str(input, 'file_path'))

  switch (tool) {
    case 'Edit':
    case 'Write':
      return `Editing ${file}`
    case 'Read':
      return `Reading ${file}`
    case 'Bash':
      return oneLine(str(input, 'description') || `Running ${str(input, 'command')}`, 50)
    case 'Agent':
      return `Agent: ${oneLine(str(input, 'description'), 40)}`
    case 'WebFetch':
    case 'WebSearch':
      return 'Browsing the web'
    default:
      return `Using ${tool}`
  }
}

// Tools whose result block the compact row replaces (errors always show).
const HIDE_RESULT = new Set(['Edit', 'Write', 'NotebookEdit', 'Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch'])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'compact-tools', description: 'Toggle one-line tool calls' })
    await $.command.register({ name: 'zen', description: 'Toggle zen mode: just the conversation and one progress line' })

    return next(e)
  })

  on('command.run', { command: 'compact-tools' }, async $ => {
    const now = !(await read($, isCompact))
    await update($, isCompact, () => now)

    return { text: now ? 'Compact tool calls on. New tool calls draw as one line.' : 'Compact tool calls off.' }
  }).catch(() => ({ text: 'Could not toggle compact tool calls.' }))

  on('command.run', { command: 'zen' }, async $ => {
    const now = !(await read($, isZen))
    await update($, isZen, () => now)

    return { text: now ? 'Zen mode on. Type /zen again to leave.' : 'Zen mode off.' }
  }).catch(() => ({ text: 'Could not toggle zen mode.' }))

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      const text = describe(e.tool, e)
      await update($, activity, () => text)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, activity, () => '')
    }

    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { isRunning, isErrored, isInterrupted, tool, input } = e.props
    if (await read($, isZen)) {
      if (!isErrored) {
        const { Box } = $.ui.resolve(e)
        return <Box />
      }
      return next(e)
    }
    const summary = (await read($, isCompact)) ? summarize(tool, input) : undefined
    if (summary === undefined) {
      return next(e)
    }
    const [icon, label, detail] = summary
    const { Box, Text } = $.ui.resolve(e)
    const mark = isRunning ? '…' : isInterrupted ? '⏹' : isErrored ? '✗' : '✓'
    const color = isRunning ? 'yellow' : isErrored || isInterrupted ? 'red' : 'green'

    return (
      <Box>
        <Text wrap="truncate-end">
          <Text color={color}>{mark}</Text> {icon} <Text bold>{label}</Text>
          {detail !== '' && <Text dimColor> {detail}</Text>}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const isHidden =
      !e.props.isErrored &&
      ((await read($, isZen)) || ((await read($, isCompact)) && HIDE_RESULT.has(e.props.tool)))
    if (!isHidden) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const hasError = e.props.calls.some(call => call.isErrored)
    if (!(await read($, isZen)) || hasError) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await read($, isZen))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    if (!(await read($, isZen))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) =>
    (await read($, isZen)) && !e.props.isWorking ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const text = await read($, activity)

    return (await read($, isZen)) && text !== '' ? next({ ...e, props: { ...e.props, message: text } }) : next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) =>
    (await read($, isZen)) ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, 'zen'] } }) : next(e),
  )
}
