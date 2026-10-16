export type Toggle = { isOn: boolean }

declare module 'claude-code' {
  interface PluginState {
    'style-rules': { isOn: boolean }
  }
}
