// Weekly usage in percent points: the run started at `baseline` and stops at `cap`.
export type Run = { budget: number; baseline?: number; cap?: number }

export type Phase =
  | { kind: 'idle' }
  | { kind: 'handoff'; asked: boolean }
  | { kind: 'wrapup'; callsLeft: number }
  | { kind: 'stopped' }

declare module 'claude-code' {
  interface PluginState {
    clauguard: { run: Run | null; phase: Phase; turnId: string | null }
  }
}
