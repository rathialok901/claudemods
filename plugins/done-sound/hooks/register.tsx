import type { Register } from 'claude-code'

// Turns shorter than this finish quietly: you were probably still watching.
const MIN_SECONDS = 20

export function soundFor(reason: string, isAborted: boolean, seconds: number): string | undefined {
  if (isAborted || seconds < MIN_SECONDS) {
    return undefined
  }

  return reason === 'error' ? 'sounds/error.wav' : 'sounds/done.wav'
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)

    // Only the main conversation: subagents finishing mid-turn stay quiet.
    if (e.agentId === undefined) {
      const seconds = Math.round(e.durationMs / 1000)
      const asset = soundFor(e.reason, e.isAborted, seconds)
      if (asset !== undefined) {
        void $.audio.play({ asset }).catch(() => undefined)
        $.ui.toast(e.reason === 'error' ? `❌ Turn failed after ${seconds}s` : `✅ Done in ${seconds}s`)
      }
    }

    return ran
  })
}
