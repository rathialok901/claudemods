export type Saved = { path: string; original: string | null }
export type Checkpoint = { turn: number; at: number; prompt: string; files: Saved[] }

declare module 'claude-code' {
  interface PluginState {
    'undo-last': { checkpoints: Checkpoint[] }
  }
}
