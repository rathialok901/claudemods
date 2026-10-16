export type Pending = { text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'budget-guard': { isOn: boolean; pending: Pending | null; allowUntil: number }
  }
}
