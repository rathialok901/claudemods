import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Block } from '../types'

const isOn = atom({ plugin: 'guardrails', key: 'isOn' } as const, true)
const blocks = atom({ plugin: 'guardrails', key: 'blocks' } as const, [])

// ---- shell commands ---------------------------------------------------------

// Split a command line into its simple commands (on ; && || | and newlines).
export function segments(command: string): string[] {
  return command
    .split(/;|&&|\|\||\||\n/)
    .map(part => part.trim())
    .filter(Boolean)
}

function words(segment: string): string[] {
  return segment.split(/\s+/).map(word => word.replace(/^["']|["']$/g, ''))
}

// A target `rm -r` must never take: the root, a top-level folder, home, or "everything here".
export function isDangerousTarget(target: string): boolean {
  const t = target.replace(/\/+$/, '') || '/'

  return (
    t === '/' ||
    t === '/*' ||
    t === '*' ||
    t === '.' ||
    t === '..' ||
    t === '~' ||
    t === '~/*' ||
    /^\$\{?HOME\}?(\/\*)?$/.test(t) ||
    /^\/[^/]+(\/\*)?$/.test(t) ||
    /^\/(Users|home)\/[^/]+(\/\*)?$/.test(t)
  )
}

function rmReason(segment: string): string | undefined {
  const parts = words(segment).filter(word => word !== 'sudo')
  if (parts[0] !== 'rm') {
    return undefined
  }
  const flags = parts.slice(1).filter(word => word.startsWith('-'))
  const targets = parts.slice(1).filter(word => !word.startsWith('-'))
  const isRecursive = flags.some(flag => flag === '--recursive' || (/^-[a-zA-Z]+$/.test(flag) && /[rR]/.test(flag)))
  const bad = targets.find(isDangerousTarget)

  return isRecursive && bad !== undefined ? `recursive delete of ${bad}` : undefined
}

type Rule = { test: RegExp; reason: string }

const RULES: Rule[] = [
  { test: /(^|\s)sudo\s/, reason: 'runs as administrator (sudo)' },
  { test: /\bgit\s+push\b(?=.*\s(--force(?!-with-lease)|-f)\b)/, reason: 'force-push rewrites shared history' },
  { test: /\bgit\s+reset\s+--hard\b/, reason: 'git reset --hard throws away uncommitted work' },
  { test: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: 'git clean -f deletes untracked files for good' },
  { test: /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, reason: 'discards every uncommitted change' },
  { test: /\bgit\s+branch\s+-D\b/, reason: 'force-deletes a branch' },
  { test: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, reason: 'pipes a download straight into a shell' },
  { test: /\bmkfs\b|\bdd\s+[^|]*\bof=\/dev\//, reason: 'writes to a disk device' },
  { test: />\s*\/dev\/(disk|sd|nvme)/, reason: 'writes to a disk device' },
  { test: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'fork bomb' },
  { test: /\bchmod\s+-R\s+777\b/, reason: 'makes files writable by everyone' },
  { test: /\b(chmod|chown)\s+-R\b[^|;&]*\s(~|\/|\$HOME)(\s|$)/, reason: 'changes permissions across home or the whole disk' },
  { test: /\bkillall\b|\bpkill\s+-9\b/, reason: 'kills processes by name' },
  { test: /\bfind\s+(~|\/|\$HOME)(\s|\/?$)[^|;&]*-delete\b/, reason: 'bulk-deletes across home or the whole disk' },
  { test: /\bdiskutil\s+(erase|partition)/, reason: 'erases a disk' },
]

// Private keys and credentials; a public key (.pub) is fine to read.
const SECRET_IN_COMMAND =
  /(\.ssh\/(?!\S*\.pub\b)\S*(id_|_key)|\bid_(rsa|ed25519|ecdsa)(?![\w.])|\.aws\/credentials|\.gnupg\/|\.netrc\b|security\s+find-(generic|internet)-password)/

export function commandReason(command: string): string | undefined {
  for (const segment of segments(command)) {
    const rm = rmReason(segment)
    if (rm !== undefined) {
      return rm
    }
  }
  if (SECRET_IN_COMMAND.test(command)) {
    return 'touches private keys or credentials'
  }

  return RULES.find(rule => rule.test.test(command))?.reason
}

// ---- files ------------------------------------------------------------------

const ENV_FILE = /(^|\/)\.env(\.[\w-]+)?$/
const ENV_SAMPLE = /\.(example|sample|template|dist)$/
const SECRET_PATH = /(\/\.ssh\/|\/\.aws\/|\/\.gnupg\/|\/\.netrc$|\.(pem|key|p12|pfx)$|\/id_(rsa|ed25519|ecdsa)(\.pub)?$)/

export function fileReason(path: string, action: 'read' | 'edit'): string | undefined {
  if (path.endsWith('.pub') && action === 'read') {
    return undefined
  }
  if (SECRET_PATH.test(path)) {
    return `${action === 'read' ? 'reading' : 'changing'} a key or credentials file`
  }
  if (ENV_FILE.test(path) && !ENV_SAMPLE.test(path)) {
    return `${action === 'read' ? 'reading' : 'changing'} a .env secrets file`
  }

  return undefined
}

function message(reason: string, what: string): string {
  return (
    `🛡️ Guardrails blocked this (${reason}): ${what}\n` +
    'Do not try another way around it. Tell the user what you wanted to do and why; ' +
    'if they agree they can run it themselves by typing `! <command>`, or turn guardrails off with /guardrails off.'
  )
}

async function block($: EngineInterface, what: string, reason: string) {
  const at = await $.clock.now()
  const entry: Block = { at, what: what.slice(0, 120), reason }
  await update($, blocks, list => [entry, ...list].slice(0, 20))
  $.ui.toast(`🛡️ Blocked: ${reason}`)

  return { deny: message(reason, what) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guardrails',
      description: 'Safety guardrails: /guardrails (recent blocks), on, off',
      argumentHint: 'on|off',
    })

    return next(e)
  })

  on('command.run', { command: 'guardrails' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      await update($, isOn, () => false)
      return { text: '⚠️ Guardrails off for this session. /guardrails on to turn them back on.' }
    }
    if (arg === 'on') {
      await update($, isOn, () => true)
      return { text: '🛡️ Guardrails on.' }
    }
    const list = await read($, blocks)
    const state = (await read($, isOn)) ? '🛡️ Guardrails are on.' : '⚠️ Guardrails are OFF this session.'
    const recent =
      list.length === 0
        ? 'Nothing blocked this session.'
        : `Blocked this session:\n${list.map(one => `  • ${one.reason}: ${one.what}`).join('\n')}`

    return {
      text: `${state}\n${recent}\nBlocks: rm -r of home/root/top-level folders, sudo, force-push, reset --hard, clean -f, curl|sh, disk writes, and access to .env, ~/.ssh, ~/.aws and key files.`,
    }
  }).catch(() => ({ text: 'Guardrails: could not run that.' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const reason = (await read($, isOn)) ? commandReason(e.command) : undefined

    return reason !== undefined ? block($, e.command, reason) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'guardrails: its check failed, so the command was not run.' }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const reason = (await read($, isOn)) ? fileReason(e.file_path, 'edit') : undefined

    return reason !== undefined ? block($, e.file_path, reason) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'guardrails: its check failed, so the edit was not made.' }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const reason = (await read($, isOn)) ? fileReason(e.file_path, 'edit') : undefined

    return reason !== undefined ? block($, e.file_path, reason) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'guardrails: its check failed, so the edit was not made.' }))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const reason = (await read($, isOn)) ? fileReason(e.file_path, 'read') : undefined

    return reason !== undefined ? block($, e.file_path, reason) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'guardrails: its check failed, so the file was not read.' }))
}
