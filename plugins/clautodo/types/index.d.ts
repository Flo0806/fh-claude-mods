export type Status = 'open' | 'running' | 'done'

export type Item = { title: string; status: Status }

export type Summary = { done: number; total: number; running?: string }

declare module 'claude-code' {
  interface PluginState {
    clautodo: { summary: Summary | null }
  }
}
