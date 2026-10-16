import type { EngineInterface, Register } from 'claude-code'

export const SECTION_ID = 'style-rules:preferences'

export function sectionText(rules: readonly string[]): string {
  return [
    "# The user's personal preferences",
    'The user set these themselves. Follow them unless a request clearly asks otherwise:',
    ...rules.map(rule => `- ${rule}`),
  ].join('\n')
}

export function listing(rules: readonly string[]): string {
  return rules.length === 0
    ? 'No style rules yet. Add one with /style add <rule>, for example:\n  /style add Explain things simply, I am still learning\n  /style add Keep answers short unless I ask for detail'
    : `Your style rules (sent to Claude every session):\n${rules.map((rule, i) => `  ${i + 1}. ${rule}`).join('\n')}\n/style remove <number> · /style clear`
}

async function rulesOf($: EngineInterface): Promise<string[]> {
  const value = await $.store.get('rules')

  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'style',
      description: 'Your preferences for how Claude works: /style, /style add <rule>, /style remove <n>',
      argumentHint: 'add <rule> | remove <n> | clear',
    })

    return next(e)
  })

  on('command.run', { command: 'style' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const rules = await rulesOf($)
    let text: string

    if (verb === 'add' && rest.length > 0) {
      const rule = rest.join(' ')
      await $.store.set('rules', [...rules, rule])
      text = `Added. From your next message Claude will follow: “${rule}”`
    } else if (verb === 'remove') {
      const n = Number(rest[0])
      if (!Number.isInteger(n) || n < 1 || n > rules.length) {
        return { text: `No rule ${rest[0] ?? ''}. ${listing(rules)}` }
      }
      await $.store.set('rules', rules.filter((_, i) => i !== n - 1))
      text = `Removed rule ${n}.`
    } else if (verb === 'clear') {
      await $.store.set('rules', [])
      text = 'All style rules cleared.'
    } else {
      return { text: listing(rules) }
    }
    $.ui.invalidate('prompt.section')

    return { text }
  }).catch(() => ({ text: 'Could not update your style rules.' }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const rules = await rulesOf($)
    if (rules.length === 0) {
      return composed
    }

    return {
      ...composed,
      sections: [...composed.sections, { id: SECTION_ID, text: sectionText(rules), scope: 'session' as const }],
    }
  }).catch(($, e, next) => next(e))
}
