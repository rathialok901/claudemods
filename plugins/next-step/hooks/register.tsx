import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isOn = atom({ plugin: 'next-step', key: 'isOn' } as const, true)

const TEST = /\b(test|tests|pytest|jest|vitest|mocha|rspec|go test|cargo test|npm (run )?test|yarn test|pnpm test)\b/
const COMMIT = /\bgit (commit|push)\b/

export type Turn = { edits: number; testsRun: boolean; testsFailed: boolean; failedCommand: string; committed: boolean }

export function freshTurn(): Turn {
  return { edits: 0, testsRun: false, testsFailed: false, failedCommand: '', committed: false }
}

// The prompt to offer after a turn, or undefined to leave the engine's own guess.
export function suggestion(turn: Turn, answer: string): string | undefined {
  if (answer.trimEnd().endsWith('?')) {
    return undefined
  }
  if (turn.testsFailed) {
    return 'fix the failing tests'
  }
  if (turn.failedCommand !== '') {
    return 'fix the error above'
  }
  if (turn.edits > 0 && !turn.testsRun) {
    return 'run the tests to check these changes'
  }
  if (turn.edits > 0 && !turn.committed) {
    return 'commit these changes with a clear message'
  }

  return undefined
}

export const register: Register = on => {
  let turn = freshTurn()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'next-step', description: 'Toggle next-prompt suggestions after each turn' })

    return next(e)
  })

  on('command.run', { command: 'next-step' }, async $ => {
    const now = !(await read($, isOn))
    await update($, isOn, () => now)

    return { text: now ? 'Next-step suggestions on.' : 'Next-step suggestions off.' }
  }).catch(() => ({ text: 'Could not toggle next-step suggestions.' }))

  on('prompt.submit', async ($, e, next) => {
    turn = freshTurn()

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined) {
      return ran
    }
    const failed = ran.isError === true
    if ((e.tool === 'Edit' || e.tool === 'Write') && !failed) {
      turn.edits += 1
    } else if (e.tool === 'Bash') {
      if (TEST.test(e.command)) {
        turn.testsRun = true
        turn.testsFailed = failed
      } else if (failed) {
        turn.failedCommand = e.command
      } else if (COMMIT.test(e.command)) {
        turn.committed = true
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && !e.isAborted && (await read($, isOn))) {
      const text = suggestion(turn, e.answer)
      if (text !== undefined) {
        void $.prompt.suggest({ text }).catch(() => undefined)
      }
    }

    return ran
  })
}
