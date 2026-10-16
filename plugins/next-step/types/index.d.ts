export type Toggle = { isOn: boolean }

declare module 'claude-code' {
  interface PluginState {
    'next-step': { isOn: boolean }
  }
}
