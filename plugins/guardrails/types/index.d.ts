export type Block = { at: number; what: string; reason: string }

declare module 'claude-code' {
  interface PluginState {
    guardrails: { isOn: boolean; blocks: Block[] }
  }
}
