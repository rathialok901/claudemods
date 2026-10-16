export type Mood =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'editing'
  | 'running'
  | 'searching'
  | 'web'
  | 'agent'
  | 'error'
  | 'done'

export type Meter = { worst: number; text: string }

declare module 'claude-code' {
  interface PluginState {
    mascot: { mood: Mood; detail: string; frame: number; isHidden: boolean; meter: Meter | null }
  }
}
