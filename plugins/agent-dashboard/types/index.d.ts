export type AgentState = 'running' | 'done' | 'failed' | 'stopped'

export type AgentRow = {
  key: string
  agentId?: string
  type: string
  description: string
  startedAt: number
  endedAt?: number
  state: AgentState
  tools: number
  doing?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-dashboard': { agents: AgentRow[]; now: number }
  }
}
