import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Context, FileRow, Git, Task } from '../types'

const PANE = 'session-hud'
const TITLE = 'Session'

const files = atom({ plugin: 'session-hud', key: 'files' } as const, [])
const tasks = atom({ plugin: 'session-hud', key: 'tasks' } as const, [])
const tools = atom({ plugin: 'session-hud', key: 'tools' } as const, 0)
const turns = atom({ plugin: 'session-hud', key: 'turns' } as const, 0)
const startedAt = atom({ plugin: 'session-hud', key: 'startedAt' } as const, 0)
const cwd = atom({ plugin: 'session-hud', key: 'cwd' } as const, '')
const git = atom({ plugin: 'session-hud', key: 'git' } as const, null)
const now = atom({ plugin: 'session-hud', key: 'now' } as const, 0)
const model = atom({ plugin: 'session-hud', key: 'model' } as const, '')
const context = atom({ plugin: 'session-hud', key: 'context' } as const, null)
const growth = atom({ plugin: 'session-hud', key: 'growth' } as const, [])
const threshold = atom({ plugin: 'session-hud', key: 'threshold' } as const, 80)

// The auto-compact mod's default, used until its own setting is found.
const DEFAULT_THRESHOLD = 80

export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

export function relative(path: string, root: string): string {
  return root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

export function parseShortstat(text: string): Omit<Git, 'branch'> {
  const num = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0)

  return {
    files: num(/(\d+) files? changed/),
    insertions: num(/(\d+) insertions?\(\+\)/),
    deletions: num(/(\d+) deletions?\(-\)/),
  }
}

export function progressBar(done: number, total: number, cells = 10): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * cells)

  return '▓'.repeat(filled) + '░'.repeat(cells - filled)
}

// 'claude-opus-5-5' → 'Opus 5.5', with the window when it is the long one.
export function prettyModel(id: string, window?: number): string {
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id)
  const name = m ? `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] && m[3].length <= 2 ? `.${m[3]}` : ''}` : id
  return window !== undefined && window >= 1_000_000 ? `${name} (1M)` : name
}

export function kTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `${Math.round(n / 1000)}k`
}

// When the auto-compact threshold will be reached: tokens left, and turns at the recent pace.
export function compactionEta(
  ctx: Context,
  at: number,
  recent: readonly number[],
): { left: number; turns?: number } | undefined {
  if (ctx.tokens === undefined) {
    return undefined
  }
  const left = Math.max(0, Math.round((ctx.window * at) / 100) - ctx.tokens)
  const pace = recent.length === 0 ? 0 : recent.reduce((sum, n) => sum + n, 0) / recent.length

  return pace > 0 ? { left, turns: Math.ceil(left / pace) } : { left }
}

async function readThreshold($: EngineInterface): Promise<number> {
  const home = await $.env.get('HOME')
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home !== undefined ? `${home}/.claude` : undefined)
  if (dir === undefined || !(await $.fs.exists(`${dir}/plugins/store`))) {
    return DEFAULT_THRESHOLD
  }
  const entry = (await $.fs.list(`${dir}/plugins/store`)).find(one => one.name.startsWith('auto-compact_'))
  if (entry === undefined) {
    return DEFAULT_THRESHOLD
  }
  const saved = (JSON.parse(await $.fs.read(`${dir}/plugins/store/${entry.name}`)) as { threshold?: unknown }).threshold

  return typeof saved === 'number' ? saved : DEFAULT_THRESHOLD
}

async function refreshModel($: EngineInterface) {
  const id = await $.session.model()
  await update($, model, () => id)
}

async function measure($: EngineInterface, ctx: Context) {
  const before = await read($, context)
  if (before?.tokens !== undefined && ctx.tokens !== undefined && ctx.tokens > before.tokens) {
    const delta = ctx.tokens - before.tokens
    await update($, growth, list => [...list, delta].slice(-5))
  } else if (before?.tokens !== undefined && ctx.tokens !== undefined && ctx.tokens < before.tokens * 0.7) {
    // A compaction or /clear: the old pace no longer says much.
    await update($, growth, () => [])
  }
  await update($, context, () => ctx)
}

async function touch($: EngineInterface, path: string, kind: 'edits' | 'reads') {
  if (path === '') {
    return
  }
  await update($, files, list => {
    const found = list.find(row => row.path === path)
    const row: FileRow = found
      ? { ...found, [kind]: found[kind] + 1 }
      : { path, edits: kind === 'edits' ? 1 : 0, reads: kind === 'reads' ? 1 : 0 }

    return [row, ...list.filter(one => one.path !== path)].slice(0, 200)
  })
}

async function refreshGit($: EngineInterface) {
  const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 })
  if (head.exitCode !== 0) {
    await update($, git, () => null)
    return
  }
  const stat = await $.process.run(['git', 'diff', '--shortstat', 'HEAD'], { timeoutMs: 5000 })
  const value: Git = { branch: head.stdout.trim(), ...parseShortstat(stat.stdout) }
  await update($, git, () => value)
}

async function tick($: EngineInterface) {
  const t = await $.clock.now()
  await update($, now, () => t)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hud', description: 'Show the session HUD: time, git, tasks and files touched' })
    const t = await $.clock.now()
    const dir = e.cwd
    await update($, startedAt, old => (old === 0 ? t : old))
    await update($, cwd, () => dir)
    await tick($)
    $.clock.every(30000, () => void tick($))
    void refreshGit($).catch(() => undefined)
    await refreshModel($)
    const at = await readThreshold($).catch(() => DEFAULT_THRESHOLD)
    await update($, threshold, () => at)
    const usage = await $.session.usage()
    await update($, context, () => usage.context)
    // Opened only when asked (/hud, or h in the mods center): the mods center is the panel in front.

    return next(e)
  })

  on('command.run', { command: 'hud' }, async $ => {
    await tick($)
    void refreshGit($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Session HUD opened.' }
  }).catch(() => ({ text: 'Could not open the session HUD.' }))

  on('tool.call', async ($, e, next) => {
    await update($, tools, n => n + 1)
    const ran = await next(e)
    const isOk = ran.deny === undefined && ran.isError !== true

    if (isOk && e.tool === 'Read') {
      await touch($, e.file_path, 'reads')
    } else if (isOk && (e.tool === 'Edit' || e.tool === 'Write')) {
      await touch($, e.file_path, 'edits')
    } else if (isOk && e.tool === 'TodoWrite') {
      const list: Task[] = e.todos.map((todo, i) => ({ id: `todo-${i}`, subject: todo.content, status: todo.status }))
      await update($, tasks, () => list)
    } else if (isOk && e.tool === 'TaskCreate') {
      const task = (ran.result as { task?: { id: string; subject: string } } | null | undefined)?.task
      if (task !== undefined) {
        const created: Task = { id: task.id, subject: task.subject, status: 'pending' }
        await update($, tasks, list => [...list, created])
      }
    } else if (isOk && e.tool === 'TaskUpdate') {
      const { taskId, status, subject } = e
      await update($, tasks, list =>
        status === 'deleted'
          ? list.filter(task => task.id !== taskId)
          : list.map(task =>
              task.id === taskId ? { ...task, status: status ?? task.status, subject: subject ?? task.subject } : task,
            ),
      )
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await measure($, e.context)

    return next(e)
  })

  on('config.set', { key: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    await refreshModel($)

    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    await refreshModel($)

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, turns, n => n + 1)
      await tick($)
      await refreshModel($)
      const at = await readThreshold($).catch(() => DEFAULT_THRESHOLD)
      await update($, threshold, () => at)
      void refreshGit($).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const usage = await $.session.usage()
    const root = await read($, cwd)
    const g = await read($, git)
    const taskList = await read($, tasks)
    const fileList = await read($, files)
    const done = taskList.filter(task => task.status === 'completed').length
    const edited = fileList.filter(row => row.edits > 0)
    const room = Math.max(3, e.props.scroll.bodyRows - 12 - Math.min(taskList.length, 8))
    const ctx = await read($, context)
    const at = await read($, threshold)
    const eta = ctx !== null ? compactionEta(ctx, at, await read($, growth)) : undefined
    const percent = ctx?.percent
    const id = (await read($, model)) || (await $.session.model())

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          ⏱ <Text bold>{duration((await read($, now)) - (await read($, startedAt)))}</Text>
          <Text dimColor>
            {' '}
            · {await read($, turns)} turns · {await read($, tools)} tool calls
            {usage.cost ? ` · $${usage.cost.usd.toFixed(2)}` : ''}
          </Text>
        </Text>
        <Text> </Text>
        <Text wrap="truncate-end">
          🧠 <Text bold>{prettyModel(id, ctx?.window)}</Text>
          <Text dimColor> {id}</Text>
        </Text>
        {ctx === null || percent === undefined ? (
          <Text dimColor>📦 context: shows after the first reply{ctx ? ` · ${kTokens(ctx.window)} window` : ''}</Text>
        ) : (
          <Text wrap="truncate-end">
            📦 <Text color={percent >= at ? 'red' : percent >= at - 15 ? 'yellow' : 'green'}>{progressBar(percent, 100)}</Text>{' '}
            <Text bold>{Math.round(percent)}%</Text>
            <Text dimColor>
              {' '}
              · {ctx.tokens !== undefined ? `${kTokens(ctx.tokens)} / ` : ''}
              {kTokens(ctx.window)} tokens
            </Text>
          </Text>
        )}
        {eta !== undefined && (
          <Text wrap="truncate-end">
            🗜 <Text dimColor>compacts at {at}% · </Text>
            {eta.left === 0 ? (
              <Text color="red">after this turn</Text>
            ) : (
              <Text>
                {kTokens(eta.left)} tokens left
                {eta.turns !== undefined ? <Text dimColor> · ≈ {eta.turns} turn{eta.turns === 1 ? '' : 's'}</Text> : null}
              </Text>
            )}
          </Text>
        )}
        {g === null ? (
          <Text dimColor>⎇ not a git repo</Text>
        ) : (
          <Text wrap="truncate-end">
            ⎇ <Text color="cyan">{g.branch}</Text>{' '}
            {g.files === 0 ? (
              <Text dimColor>clean</Text>
            ) : (
              <Text>
                <Text color="green">+{g.insertions}</Text> <Text color="red">−{g.deletions}</Text>
                <Text dimColor> in {g.files} files</Text>
              </Text>
            )}
          </Text>
        )}
        <Text> </Text>
        {taskList.length === 0 ? (
          <Text dimColor>No tasks yet</Text>
        ) : (
          <Box flexDirection="column">
            <Text bold>
              Tasks {done}/{taskList.length} <Text color="green">{progressBar(done, taskList.length)}</Text>
            </Text>
            {taskList.slice(0, 8).map(task => (
              <Text
                key={task.id}
                wrap="truncate-end"
                color={task.status === 'in_progress' ? 'yellow' : undefined}
                dimColor={task.status === 'completed'}
              >
                {task.status === 'completed' ? '  ✓ ' : task.status === 'in_progress' ? '  ▶ ' : '  ○ '}
                {task.subject}
              </Text>
            ))}
            {taskList.length > 8 && <Text dimColor>  … {taskList.length - 8} more</Text>}
          </Box>
        )}
        <Text> </Text>
        <Text bold>
          Files <Text dimColor>({edited.length} edited, {fileList.length - edited.length} only read)</Text>
        </Text>
        {fileList.length === 0 && <Text dimColor>  none yet</Text>}
        {fileList.slice(0, room).map(row => (
          <Text key={row.path} wrap="truncate-start" dimColor={row.edits === 0}>
            {row.edits > 0 ? '  ✏️ ' : '  📖 '}
            {relative(row.path, root)}
            {row.edits > 1 ? ` ×${row.edits}` : ''}
          </Text>
        ))}
        {fileList.length > room && <Text dimColor>  … {fileList.length - room} more</Text>}
      </Box>
    )
  })
}
