export type Spend = { today: number; limit: number }
export type Activity = { at: number; icon: string; text: string; tone: 'on' | 'off' | 'info' | 'warn' }
export type Live = {
  pid: number
  name: string
  folder: string
  kind: string
  status: string
  startedAt: number
  isMe: boolean
  lastPrompt: string
}

declare module 'claude-code' {
  interface PluginState {
    'mods-center': {
      tick: number
      spend: Spend | null
      threshold: number
      ruleCount: number
      tab: 'mods' | 'sessions' | 'activity'
      theme: string
      feed: Activity[]
      sessions: Live[]
      model: string
      profile: string
    }
  }
}
