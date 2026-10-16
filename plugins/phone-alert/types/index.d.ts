export type Sent = { at: number; text: string; via: string[] }

declare module 'claude-code' {
  interface PluginState {
    'phone-alert': {
      isOn: boolean
      channels: string[]
      lastSent: Sent | null
    }
  }
}
