import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const isOn = atom({ plugin: 'explain-risky', key: 'isOn' } as const, true)

const SYSTEM =
  'You explain shell commands to someone deciding whether to allow them. Reply with one plain-English sentence ' +
  'of at most 22 words: what the command will actually do. Put anything destructive, irreversible, networked ' +
  'or privileged first. No preamble, no markdown.'

// Plain read-only commands need no explanation.
const SIMPLE = /^(ls|pwd|cat|head|tail|wc|echo|which|whoami|date|git (status|log|diff|branch|show))(\s[^|;&<>]*)?$/

export function needsExplaining(command: string): boolean {
  const c = command.trim()

  return c !== '' && !SIMPLE.test(c)
}

export function oneSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat
}

const cache = new Map<string, string>()

async function explain($: EngineInterface, command: string): Promise<string | undefined> {
  const known = cache.get(command)
  if (known !== undefined) {
    return known
  }
  const stop = new AbortController()
  const timer = $.clock.after(6000, () => stop.abort())
  try {
    const reply = await $.model.complete(
      { model: 'haiku', system: SYSTEM, prompt: command.slice(0, 3000), maxTokens: 80 },
      { signal: stop.signal },
    )
    if (!reply.isAnswered) {
      return undefined
    }
    const line = oneSentence(reply.text)
    cache.set(command, line)

    return line
  } finally {
    timer.cancel()
  }
}

// Shown as a toast while the approval prompt is open (this Claude Code build draws no plugin line inside
// the shell-command prompt), and as a line under the prompt too where the build draws one.
async function showExplanation($: EngineInterface, tool_use_id: string, command: string) {
  const line = await explain($, command)
  if (line === undefined) {
    return
  }
  $.ui.toast(`💡 ${line}`, { timeoutMs: 15000 })
  try {
    $.ui.notice(tool_use_id, `💡 ${line}`)
  } catch {
    // No prompt open for this call any more: the toast is enough.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'explain-risky', description: 'Toggle plain-English explanations on command approvals' })

    return next(e)
  })

  on('command.run', { command: 'explain-risky' }, async $ => {
    const now = !(await read($, isOn))
    await update($, isOn, () => now)

    return { text: now ? 'Explanations on approval prompts: on.' : 'Explanations on approval prompts: off.' }
  }).catch(() => ({ text: 'Could not toggle explanations.' }))

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    const command = (e.input as { command?: unknown }).command
    if (
      verdict.decision === 'ask' &&
      e.tool_use_id !== undefined &&
      typeof command === 'string' &&
      needsExplaining(command) &&
      (await read($, isOn))
    ) {
      void showExplanation($, e.tool_use_id, command).catch(() => undefined)
    }

    return verdict
  }).catch(($, e, next) => next(e))
}
