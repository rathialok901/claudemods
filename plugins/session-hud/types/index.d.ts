export type FileRow = { path: string; edits: number; reads: number }
export type Task = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }
export type Git = { branch: string; files: number; insertions: number; deletions: number }
export type Context = { tokens?: number; window: number; percent?: number }

declare module 'claude-code' {
  interface PluginState {
    'session-hud': {
      files: FileRow[]
      tasks: Task[]
      tools: number
      turns: number
      startedAt: number
      cwd: string
      git: Git | null
      now: number
      model: string
      context: Context | null
      growth: number[]
      threshold: number
    }
  }
}
