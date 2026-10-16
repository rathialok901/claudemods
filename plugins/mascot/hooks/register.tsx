import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit, Timer } from 'claude-code'

import type { Meter, Mood } from '../types'

const mood = atom({ plugin: 'mascot', key: 'mood' } as const, 'idle')
const detail = atom({ plugin: 'mascot', key: 'detail' } as const, '')
const frame = atom({ plugin: 'mascot', key: 'frame' } as const, 0)
const isHidden = atom({ plugin: 'mascot', key: 'isHidden' } as const, false)
const meter = atom({ plugin: 'mascot', key: 'meter' } as const, null)

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

// The usage figures drawn at the right of the band: context, rate-limit windows, cost.
export function meterFor(
  context: SessionContextUsage,
  rateLimits: readonly SessionRateLimit[],
  cost: SessionCost | undefined,
): Meter | null {
  const parts: string[] = []
  if (context.percent !== undefined) {
    parts.push(`ctx ${Math.round(context.percent)}%`)
  }
  for (const limit of rateLimits) {
    parts.push(`${LIMIT_LABELS[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`)
  }
  if (cost !== undefined) {
    parts.push(`$${cost.usd.toFixed(2)}`)
  }
  if (parts.length === 0) {
    return null
  }
  const worst = Math.max(context.percent ?? 0, ...rateLimits.map(limit => limit.percentUsed))

  return { worst, text: parts.join(' · ') }
}

export function dot(percent: number): string {
  return percent >= 85 ? '🔴' : percent >= 60 ? '🟡' : '🟢'
}

// Two frames per mood; the band flips between them while Claude works.
export const FACES: Record<Mood, [string, string]> = {
  idle: ['(•‿•)', '(-‿-)'],
  thinking: ['(°ー°〃)', '(〃°ー°)'],
  reading: ['(⌐□_□)', '(□_□¬)'],
  editing: ['(ง •̀_•́)ง', 'ᕦ(•̀_•́)ᕤ'],
  running: ['(⌐■_■)', '(■_■¬)'],
  searching: ['(•_•)>⌐□', '(⌐□_□)'],
  web: ['(°o°)', '(°O°)'],
  agent: ['(•‿•)ノ', 'ヽ(•‿•)'],
  error: ['(╥﹏╥)', '(ಥ﹏ಥ)'],
  done: ['\\(^o^)/', '\\(^▽^)/'],
}

const COLORS: Record<Mood, string> = {
  idle: 'gray',
  thinking: 'magenta',
  reading: 'cyan',
  editing: 'yellow',
  running: 'blue',
  searching: 'cyan',
  web: 'blue',
  agent: 'magenta',
  error: 'red',
  done: 'green',
}

const IDLE_LINES = ['ready when you are', 'what are we building?', 'standing by', 'say the word']

function base(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

export function moodFor(tool: string, input: Record<string, unknown>): [Mood, string] {
  const s = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')

  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return ['editing', `editing ${base(s('file_path') || s('notebook_path'))}`]
    case 'Read':
      return ['reading', `reading ${base(s('file_path'))}`]
    case 'Bash': {
      const what = s('description') || s('command')
      return ['running', what.length > 48 ? `${what.slice(0, 47)}…` : what]
    }
    case 'Grep':
    case 'Glob':
    case 'ToolSearch':
      return ['searching', 'looking around']
    case 'WebFetch':
    case 'WebSearch':
      return ['web', 'browsing the web']
    case 'Agent':
      return ['agent', `sent a helper: ${s('description')}`]
    default:
      return ['thinking', `using ${tool}`]
  }
}

let ticker: Timer | undefined
let settle: Timer | undefined

async function setMood($: EngineInterface, next: Mood, text: string) {
  settle?.cancel()
  settle = undefined
  await update($, mood, () => next)
  await update($, detail, () => text)
}

function animate($: EngineInterface, isOn: boolean) {
  if (isOn && ticker === undefined) {
    ticker = $.clock.every(700, () => {
      void update($, frame, n => (n + 1) % 2)
    })
  } else if (!isOn && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mascot', description: 'Show or hide the mascot above the prompt' })
    const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)] ?? 'ready'
    await setMood($, 'idle', line)
    const ran = await next(e)
    const usage = await $.session.usage()
    const figures = meterFor(usage.context, usage.rateLimits, usage.cost)
    await update($, meter, () => figures)

    return ran
  })

  on('session.measure', async ($, e, next) => {
    const figures = meterFor(e.context, e.rateLimits, e.cost)
    await update($, meter, () => figures)

    return next(e)
  })

  on('command.run', { command: 'mascot' }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)

    return { text: hidden ? 'Mascot hidden. /mascot brings it back.' : 'Mascot is back.' }
  }).catch(() => ({ text: 'Could not toggle the mascot.' }))

  on('prompt.submit', async ($, e, next) => {
    await setMood($, 'thinking', 'thinking…')
    animate($, true)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    const [next_mood, text] = moodFor(e.tool, e as unknown as Record<string, unknown>)
    await setMood($, next_mood, text)
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === true) {
      await setMood($, 'error', `that ${e.tool === 'Bash' ? 'command' : e.tool} failed`)
    } else {
      await setMood($, 'thinking', 'thinking…')
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    animate($, false)
    await update($, frame, () => 0)
    const seconds = Math.round(e.durationMs / 1000)
    if (e.isAborted) {
      await setMood($, 'idle', 'stopped. what next?')
    } else if (e.reason === 'error') {
      await setMood($, 'error', 'something went wrong')
    } else {
      await setMood($, 'done', seconds >= 5 ? `done in ${seconds}s!` : 'done!')
      settle = $.clock.after(8000, () => {
        void setMood($, 'idle', 'ready when you are')
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) {
      return next(e)
    }
    const hidden = await read($, isHidden)
    const figures = await read($, meter)
    if (hidden && figures === null) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, mood)
    const face = FACES[current][await read($, frame)]

    return (
      <Box flexDirection="row" justifyContent="space-between" width={e.props.bodyColumns}>
        <Box flexShrink={1}>
          {!hidden && (
            <Text wrap="truncate-end">
              <Text color={COLORS[current]} bold>
                {face}
              </Text>{' '}
              <Text dimColor>{await read($, detail)}</Text>
            </Text>
          )}
        </Box>
        {figures !== null && (
          <Box flexShrink={0} marginLeft={2}>
            <Text>
              {dot(figures.worst)} <Text dimColor>{figures.text}</Text>
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
