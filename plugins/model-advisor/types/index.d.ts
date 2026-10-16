export type Tier = 'simple' | 'complex'
export type Decision = { tier: Tier; model: string; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'model-advisor': { isOn: boolean; isPaused: boolean; last: Decision | null }
  }
}
