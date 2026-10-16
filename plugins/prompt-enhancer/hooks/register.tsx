import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isOn = atom({ plugin: 'prompt-enhancer', key: 'isOn' } as const, true)

type Failure = { command: string; tail: string }

const VAGUE = /\b(it|this|that|these|error|errors|broken|fails?|failing|failed|doesn'?t work|not working|wrong|fix|again|same|still)\b/i

// A short prompt that leans on what just happened: "fix it", "still failing", "why?".
export function isVague(text: string): boolean {
  const t = text.trim()
  if (t === '' || t.startsWith('/')) {
    return false
  }
  const words = t.split(/\s+/).length

  return words <= 3 || (words <= 8 && VAGUE.test(t))
}

export function tail(text: string, lines = 15): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n')
}

export function contextBlock(failure: Failure | null, edited: readonly string[], lastCommand: string): string {
  const parts = ["The user's prompt is short; this is what it most likely refers to (added automatically, not typed by the user):"]
  if (failure !== null) {
    parts.push(`- The last command that failed: \`${failure.command}\`\n  Its output ended with:\n${failure.tail.replace(/^/gm, '    ')}`)
  }
  if (edited.length > 0) {
    parts.push(`- Files edited most recently: ${edited.join(', ')}`)
  }
  if (lastCommand !== '' && lastCommand !== failure?.command) {
    parts.push(`- The last command run: \`${lastCommand}\``)
  }

  return parts.join('\n')
}

export const register: Register = on => {
  let failure: Failure | null = null
  let edited: string[] = []
  let lastCommand = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'enhancer', description: 'Toggle adding recent context to short, vague prompts' })

    return next(e)
  })

  on('command.run', { command: 'enhancer' }, async $ => {
    const now = !(await read($, isOn))
    await update($, isOn, () => now)

    return { text: now ? 'Prompt enhancer on.' : 'Prompt enhancer off.' }
  }).catch(() => ({ text: 'Could not toggle the prompt enhancer.' }))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined) {
      return ran
    }
    if (e.tool === 'Bash') {
      lastCommand = e.command
      const result = ran.result as { stdout?: string; stderr?: string } | undefined
      if (ran.isError === true) {
        const output = [result?.stderr, result?.stdout, ran.text].filter(Boolean).join('\n')
        failure = { command: e.command, tail: tail(output) }
      } else if (failure?.command === e.command) {
        failure = null
      }
    } else if ((e.tool === 'Edit' || e.tool === 'Write') && ran.isError !== true) {
      const path = e.file_path
      edited = [path, ...edited.filter(one => one !== path)].slice(0, 5)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || !(await read($, isOn)) || !isVague(e.text)) {
      return next(e)
    }
    if (failure === null && edited.length === 0 && lastCommand === '') {
      return next(e)
    }
    const added = [failure && 'last error', edited.length > 0 && `${edited.length} recent file${edited.length === 1 ? '' : 's'}`]
      .filter(Boolean)
      .join(' + ')
    $.ui.toast(`✨ Added context to your prompt${added ? `: ${added}` : ''}`)

    return next({ ...e, context: [...(e.context ?? []), contextBlock(failure, edited, lastCommand)] })
  }).catch(($, e, next) => next(e))
}
