import type { Phase, Run } from '../types'

export const DEFAULT_BUDGET = 30
export const HANDOFF_AT = 85
export const GRACE_CALLS = 10

export const HANDOFF = `clauguard: the context is at ${HANDOFF_AT}%. Finish the step you are on, update your memory, then run the remember skill (/remember). Once it is saved, clauguard compacts the conversation and you carry on.`
export const WRAPUP = `clauguard: the usage budget for this run is reached. Bring the current step to a clean end within ${GRACE_CALLS} tool calls, write a short handoff, start nothing new.`
export const STOPPED =
  'clauguard: Limit erreicht. The run is stopped, no more tool calls until Flo starts a new one.'
export const CONTINUE = 'Context was compacted after your handoff. Carry on where you left off.'

export const isRemember = (skill: string) => /(^|:)remember$/.test(skill)

// The budget counts from the first weekly figure the run sees, so a start before any response works.
export const settle = (run: Run, weekly: number | undefined): Run =>
  run.baseline !== undefined || weekly === undefined
    ? run
    : { ...run, baseline: weekly, cap: weekly + run.budget }

export const parseStart = (args: string): number | undefined => {
  const match = /^start(?:\s+(\d+(?:\.\d+)?))?$/.exec(args.trim())
  if (!match) return undefined
  return match[1] === undefined ? DEFAULT_BUDGET : Number(match[1])
}

// Budget beats handoff: a run over budget wraps up, it does not start a compaction.
export const nextPhase = (
  phase: Phase,
  run: Run | null,
  weekly: number | undefined,
  context: number | undefined,
): Phase => {
  if (phase.kind === 'wrapup' || phase.kind === 'stopped') return phase
  if (run?.cap !== undefined && weekly !== undefined && weekly >= run.cap) {
    return { kind: 'wrapup', callsLeft: GRACE_CALLS }
  }
  if (phase.kind === 'idle' && context !== undefined && context >= HANDOFF_AT) {
    return { kind: 'handoff', asked: false }
  }
  return phase
}

export const label = (run: Run | null, phase: Phase) => {
  if (phase.kind === 'stopped') return 'guard ⛔ Limit erreicht'
  if (phase.kind === 'wrapup') return 'guard ⏳ schließt ab'
  if (!run) return undefined
  return run.cap === undefined ? 'guard …' : `guard ≤${Math.round(run.cap)}%`
}
