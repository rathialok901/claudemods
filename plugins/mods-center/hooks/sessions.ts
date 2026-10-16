// Reading the Claude Code sessions running on this machine from ~/.claude/sessions/<pid>.json.

export type SessionRow = {
  pid: number
  sessionId: string
  name: string
  cwd: string
  kind: string
  status: string
  startedAt: number
  isMe: boolean
  lastPrompt: string
}

export function parseSessionFile(text: string, mySessionId: string): SessionRow | undefined {
  try {
    const v = JSON.parse(text) as Record<string, unknown>
    if (typeof v.pid !== 'number' || typeof v.sessionId !== 'string' || v.spare === true) {
      return undefined
    }

    return {
      pid: v.pid,
      sessionId: v.sessionId,
      name: typeof v.name === 'string' ? v.name : String(v.pid),
      cwd: typeof v.cwd === 'string' ? v.cwd : '',
      kind: typeof v.kind === 'string' ? v.kind : 'interactive',
      status: typeof v.status === 'string' ? v.status : 'unknown',
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : 0,
      isMe: v.sessionId === mySessionId,
      lastPrompt: '',
    }
  } catch {
    return undefined
  }
}

// `ps -o pid= -p 1,2,3` output: the pids still alive.
export function alivePids(psOutput: string): Set<number> {
  return new Set(
    psOutput
      .split('\n')
      .map(line => Number(line.trim()))
      .filter(n => Number.isInteger(n) && n > 0),
  )
}

// Where a session's transcript lives: ~/.claude/projects/<cwd with every non-alphanumeric as ->/<id>.jsonl
export function transcriptPath(configDir: string, cwd: string, sessionId: string): string {
  return `${configDir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${sessionId}.jsonl`
}

// The last thing the person typed, from the tail of a transcript.
export function lastPromptOf(tail: string): string {
  const lines = tail.split('\n').reverse()
  for (const line of lines) {
    if (!line.includes('"type":"user"')) {
      continue
    }
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown } }
      const content = entry.message?.content
      const text = typeof content === 'string' ? content : ''
      if (text !== '' && !text.startsWith('<') && !text.startsWith('[Request interrupted')) {
        return text.replace(/\s+/g, ' ').trim()
      }
    } catch {
      // A line cut by the tail: skip it.
    }
  }

  return ''
}

export function folderName(cwd: string, home: string | undefined): string {
  if (home !== undefined && cwd === home) {
    return '~'
  }
  if (home !== undefined && cwd.startsWith(`${home}/`)) {
    return `~/${cwd.slice(home.length + 1)}`
  }

  return cwd
}

export function uptime(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  return days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

export function kindLabel(kind: string): string {
  return kind === 'interactive' ? 'terminal' : kind === 'bg' ? 'background' : kind
}
