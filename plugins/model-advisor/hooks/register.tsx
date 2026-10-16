import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Decision, Tier } from '../types'

// Which /model value each tier switches to.
export const MODELS: Record<Tier, string> = { simple: 'sonnet', complex: 'opus' }

const isOn = atom({ plugin: 'model-advisor', key: 'isOn' } as const, true)
const isPaused = atom({ plugin: 'model-advisor', key: 'isPaused' } as const, false)
const last = atom({ plugin: 'model-advisor', key: 'last' } as const, null)

const RUBRIC = `You route prompts sent to a coding assistant to a model tier. Reply with one word.
SIMPLE: greetings, quick questions, explanations of a concept or a short piece of code, small or obvious edits, renaming, formatting, running a known command, writing a short script, summarizing.
COMPLEX: designing or architecting something, multi-file changes or refactors, debugging a non-obvious problem, performance or security work, building a feature end to end, anything needing careful multi-step reasoning or planning.
When unsure, reply COMPLEX.`

// Prompts the person typed: at the terminal, or from a phone through Remote Control.
const TYPED = new Set<string>(['composer', 'bridge'])

const FOLLOW_UP = /^(y|yes|yep|ok|okay|sure|continue|go( ahead)?|do it|proceed|next|thanks?|thank you|lgtm|sounds good|great|nice|perfect|👍)[.! ]*$/i

// Prompts decided without asking a model: undefined means "ask"; 'keep' means stay on the current model.
export function quickTier(text: string): Tier | 'keep' | undefined {
  const t = text.trim()
  if (t.startsWith('/') || t === '') {
    return 'keep'
  }
  if (FOLLOW_UP.test(t)) {
    return 'keep'
  }
  const words = t.split(/\s+/).length
  if (words <= 4 && !/[`{}();=]/.test(t)) {
    return 'simple'
  }

  return undefined
}

export function parseTier(reply: string): Tier | undefined {
  const word = reply.trim().toUpperCase()
  if (word.startsWith('SIMPLE')) {
    return 'simple'
  }
  if (word.startsWith('COMPLEX')) {
    return 'complex'
  }

  return undefined
}

export function family(model: string): string {
  const m = model.toLowerCase()

  return ['opus', 'sonnet', 'haiku', 'fable'].find(name => m.includes(name)) ?? m
}

// How long typing must pause before the draft is judged.
const PAUSE_MS = 700

// The sent prompt is (nearly) the draft already judged: the same text, or it with a little more typed.
export function wasJudged(text: string, judged: string): boolean {
  const a = text.trim()
  const b = judged.trim()

  return b !== '' && (a === b || (a.startsWith(b) && b.length >= a.length * 0.85))
}

// Enough of a draft to judge: a few words, not a slash command.
export function isJudgeable(text: string): boolean {
  const t = text.trim()

  return !t.startsWith('/') && t.split(/\s+/).length >= 5
}

async function classify($: EngineInterface, text: string): Promise<Tier | undefined> {
  const stop = new AbortController()
  const timer = $.clock.after(4000, () => stop.abort())
  try {
    const reply = await $.model.complete(
      { model: 'haiku', system: RUBRIC, prompt: text.slice(0, 4000), maxTokens: 5 },
      { signal: stop.signal },
    )

    return reply.isAnswered ? parseTier(reply.text) : undefined
  } finally {
    timer.cancel()
  }
}

// The default saved in the person's own settings file: what /model last saved, never a --model flag.
async function savedDefault($: EngineInterface): Promise<string | undefined> {
  const user = await $.settings.read({ source: 'user' })
  const value = (user as { model?: unknown }).model

  return typeof value === 'string' ? value : undefined
}

// The person's own /model choice, kept in the store from the first switch until it is put back
// and seen to hold.
async function restore($: EngineInterface) {
  const original = await $.store.get('original')
  if (typeof original === 'string') {
    if (((await savedDefault($)) ?? 'default') !== original) {
      await $.config.set({ key: 'model', value: original })
    }
    await $.store.delete('original')
  }
}

// At exit the settings menu takes no changes, so the saved default goes straight back into the
// person's settings file: only its "model" key is touched.
export function withModel(settingsText: string, original: string): string {
  const settings = JSON.parse(settingsText) as Record<string, unknown>
  if (original === 'default') {
    delete settings.model
  } else {
    settings.model = original
  }

  return `${JSON.stringify(settings, null, 2)}\n`
}

async function restoreFile($: EngineInterface) {
  const original = await $.store.get('original')
  if (typeof original !== 'string') {
    return
  }
  const home = await $.env.get('HOME')
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home !== undefined ? `${home}/.claude` : undefined)
  if (dir === undefined) {
    return
  }
  const path = `${dir}/settings.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  await $.fs.write(path, withModel(text, original))
  // Kept until the next session start checks it held: a write Claude Code makes on its way out
  // can land after this one.
}

let draft = ''
let lastJudged = ''
let pending: Timer | undefined

async function tierOf($: EngineInterface, text: string): Promise<Tier | undefined> {
  const quick = quickTier(text)
  if (quick === 'keep') {
    return undefined
  }

  return quick ?? (await classify($, text).catch(() => undefined))
}

// Switches /model to the tier's model when it is not on it already; true when it switched.
async function switchTo($: EngineInterface, tier: Tier, reason: string): Promise<boolean> {
  const target = MODELS[tier]
  const decision: Decision = { tier, model: target, reason }
  await update($, last, () => decision)
  if (family(await $.session.model()) === family(target)) {
    return false
  }
  if ((await $.store.get('original')) === undefined) {
    // No saved default means Claude Code's own default: 'default' puts that back.
    await $.store.set('original', (await savedDefault($)) ?? 'default')
  }
  const { deny } = await $.config.set({ key: 'model', value: target })

  return deny === undefined
}

async function judgeDraft($: EngineInterface) {
  const text = draft
  if (!isJudgeable(text) || wasJudged(text, lastJudged) || !(await read($, isOn)) || (await read($, isPaused))) {
    return
  }
  lastJudged = text
  const tier = await tierOf($, text)
  if (tier !== undefined && text === draft) {
    await switchTo($, tier, 'judged while typing')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'model-advisor',
      description: 'Pick Sonnet or Opus per prompt: /model-advisor on, off or status',
      argumentHint: 'on|off|status',
    })
    // A session that ended without putting the model back (a crash, a kill) is put right now.
    await restore($).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await restoreFile($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'model-advisor' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      await update($, isOn, () => false)
      await restore($)
      return { text: 'Model advisor off for this session; your own model is back.' }
    }
    if (arg === 'on') {
      await update($, isOn, () => true)
      await update($, isPaused, () => false)
      return { text: `Model advisor on: simple prompts → ${MODELS.simple}, complex → ${MODELS.complex}.` }
    }
    const decision = await read($, last)
    const state = !(await read($, isOn)) ? 'off' : (await read($, isPaused)) ? 'paused (you picked a model with /model)' : 'on'
    const lastLine = decision ? `\nLast prompt: ${decision.tier} → ${decision.model} (${decision.reason})` : ''

    return {
      text: `Model advisor is ${state}. Now on ${await $.session.model()}. Simple → ${MODELS.simple}, complex → ${MODELS.complex}.${lastLine}`,
    }
  }).catch(() => ({ text: 'Model advisor: could not run that.' }))

  // The person chose a model themselves: respect it for the rest of the session.
  on('config.set', { key: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.origin.kind === 'composer' && (await read($, isOn))) {
      await $.store.delete('original')
      await update($, isPaused, () => true)
      $.ui.toast('🧭 Model advisor paused: you picked a model. /model-advisor on to resume.')
    }

    return ran
  }).catch(($, e, next) => next(e))

  // Judge the draft while it is typed: the model is fixed when Enter is pressed, so a switch
  // made now reaches this prompt. A paste is judged at once; typing after a short pause.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if ((e.origin as { kind?: string }).kind !== undefined && !TYPED.has((e.origin as { kind: string }).kind)) {
      return box
    }
    draft = box.text
    pending?.cancel()
    pending = $.clock.after(e.inputText.length >= 40 ? 0 : PAUSE_MS, () => {
      void judgeDraft($).catch(() => undefined)
    })

    return box
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    pending?.cancel()
    if (!TYPED.has(e.origin.kind) || !(await read($, isOn)) || (await read($, isPaused))) {
      return next(e)
    }
    // Already judged while typing (or a follow-up that keeps the model): nothing more to do.
    if (wasJudged(e.text, lastJudged) || quickTier(e.text) === 'keep') {
      return next(e)
    }
    // Sent before a pause: judge it now; a switch applies from the next message.
    const tier = await tierOf($, e.text)
    if (tier !== undefined && (await switchTo($, tier, 'judged after sending'))) {
      $.ui.toast(`🧭 ${tier === 'complex' ? 'Complex task' : 'Simple task'} → ${MODELS[tier]} from your next message`)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isOn)) || (await read($, isPaused))) {
      return next(e)
    }
    const decision = await read($, last)
    const label = decision ? `🧭 ${decision.model}` : '🧭 auto'

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })
}
