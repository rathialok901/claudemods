export type Toggle = { isOn: boolean }

declare module 'claude-code' {
  interface PluginState {
    'explain-risky': { isOn: boolean }
  }
}
