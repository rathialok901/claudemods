export type Memory = { preferences: string[]; decisions: string[]; history: string[] }

declare module 'claude-code' {
  interface PluginState {
    'long-term-memory': { isOn: boolean; facts: number; lastSaved: number; isSaving: boolean }
  }
}
