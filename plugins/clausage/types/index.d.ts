export type Bar = { percent: number; resetsAt?: string }

// Each bar is optional: rate limits are absent off a subscription or before the first response.
export type Usage = {
  fiveHour?: Bar
  sevenDay?: Bar
  context?: Bar
}

declare module 'claude-code' {
  interface PluginState {
    clausage: { usage: Usage | null }
  }
}
