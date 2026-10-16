export type Toggle = { isOn: boolean }

declare module 'claude-code' {
  interface PluginState {
    'prompt-enhancer': { isOn: boolean }
  }
}
