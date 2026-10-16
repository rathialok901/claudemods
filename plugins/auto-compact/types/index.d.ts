export type Toggle = { isOn: boolean }

declare module 'claude-code' {
  interface PluginState {
    'auto-compact': { isOn: boolean }
  }
}
