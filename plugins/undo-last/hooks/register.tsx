import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Checkpoint, Saved } from '../types'

const checkpoints = atom({ plugin: 'undo-last', key: 'checkpoints' } as const, [])

const MAX_BYTES = 2_000_000
const KEEP = 10

export function shortPath(path: string, root: string): string {
  return root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

export function summary(checkpoint: Checkpoint, root: string): string {
  const changed = checkpoint.files.filter(file => file.original !== null).length
  const created = checkpoint.files.length - changed
  const names = checkpoint.files.map(file => shortPath(file.path, root)).slice(0, 6).join(', ')
  const more = checkpoint.files.length > 6 ? ` +${checkpoint.files.length - 6} more` : ''

  return `${changed} changed, ${created} created: ${names}${more}`
}

let turn = 0
let prompt = ''
let root = ''

// Before the first edit of a file in a turn, keep what it held (null: it did not exist yet).
async function save($: EngineInterface, path: string) {
  const list = await read($, checkpoints)
  const current = list[0]
  if (current?.turn === turn && current.files.some(file => file.path === path)) {
    return
  }
  let original: string | null = null
  if (await $.fs.exists(path)) {
    const stat = await $.fs.stat(path)
    if (stat.size > MAX_BYTES) {
      return
    }
    original = await $.fs.read(path)
  }
  const saved: Saved = { path, original }
  const at = await $.clock.now()
  await update($, checkpoints, all => {
    const head = all[0]
    if (head?.turn === turn) {
      return [{ ...head, files: [...head.files, saved] }, ...all.slice(1)]
    }

    return [{ turn, at, prompt: prompt.slice(0, 80), files: [saved] }, ...all].slice(0, KEEP)
  })
}

async function undo($: EngineInterface): Promise<string> {
  const [last, ...rest] = await read($, checkpoints)
  if (last === undefined) {
    return 'Nothing to undo: no file edits by Claude saved this session.'
  }
  const restored: string[] = []
  const trashed: string[] = []
  const failed: string[] = []
  const home = await $.env.get('HOME')
  for (const file of last.files) {
    try {
      if (file.original !== null) {
        await $.fs.write(file.path, file.original)
        restored.push(shortPath(file.path, root))
      } else if (await $.fs.exists(file.path)) {
        // A file Claude created: moved to the Trash, never deleted outright.
        const { exitCode } = await $.process.run(['mv', file.path, `${home}/.Trash/`])
        if (exitCode === 0) {
          trashed.push(shortPath(file.path, root))
        } else {
          failed.push(shortPath(file.path, root))
        }
      }
    } catch {
      failed.push(shortPath(file.path, root))
    }
  }
  await update($, checkpoints, () => rest)

  return [
    `↩️ Undid the file edits from: “${last.prompt}”`,
    restored.length > 0 ? `Restored: ${restored.join(', ')}` : '',
    trashed.length > 0 ? `Moved to Trash (Claude had created them): ${trashed.join(', ')}` : '',
    failed.length > 0 ? `Could not undo: ${failed.join(', ')}` : '',
    rest.length > 0 ? `/undo-last again to go back one more turn (${rest.length} left).` : '',
    'Changes made by shell commands are not covered; Esc Esc (/rewind) can rewind the conversation too.',
  ]
    .filter(Boolean)
    .join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = e.cwd
    await $.command.register({ name: 'undo-last', description: "Put back the files Claude changed in its last turn" })
    await $.command.register({ name: 'checkpoints', description: 'List the turns /undo-last can undo' })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    turn += 1
    prompt = e.text

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (e.agentId === undefined) {
      await save($, e.file_path).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (e.agentId === undefined) {
      await save($, e.file_path).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'undo-last' }, async $ => ({ text: await undo($) })).catch(() => ({
    text: 'undo-last: something went wrong; nothing more was changed.',
  }))

  on('command.run', { command: 'checkpoints' }, async $ => {
    const list = await read($, checkpoints)
    if (list.length === 0) {
      return { text: 'No checkpoints yet: they are saved when Claude edits files.' }
    }

    return {
      text: `Turns /undo-last can undo (newest first):\n${list.map((one, i) => `  ${i + 1}. “${one.prompt}” · ${summary(one, root)}`).join('\n')}`,
    }
  }).catch(() => ({ text: 'Could not list checkpoints.' }))
}
