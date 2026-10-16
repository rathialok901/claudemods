export type ViewFlags = { isCompact: boolean; isZen: boolean }

declare module 'claude-code' {
  interface PluginState {
    'tidy-view': { isCompact: boolean; isZen: boolean; activity: string }
  }
}
