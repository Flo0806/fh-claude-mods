import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase, Run } from '../types'
import {
  CONTINUE,
  GRACE_CALLS,
  HANDOFF,
  STOPPED,
  WRAPUP,
  isRemember,
  label,
  nextPhase,
  parseStart,
  settle,
} from './guard'

const IDLE: Phase = { kind: 'idle' }

const run = atom({ plugin: 'clauguard', key: 'run' } as const, null as Run | null)
const phase = atom({ plugin: 'clauguard', key: 'phase' } as const, IDLE as Phase)
const turnId = atom({ plugin: 'clauguard', key: 'turnId' } as const, null as string | null)

const RETRY_MS = 250
const RETRIES = 40

const sleep = ($: EngineInterface, ms: number) =>
  new Promise<void>((resolve) => $.clock.after(ms, resolve))

// Compaction is refused while a turn still winds down after the abort, so it is retried briefly.
const compactWhenIdle = async ($: EngineInterface) => {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      await $.session.compact({ instructions: 'Keep the current task, its plan and the handoff.' })
      return true
    } catch {
      await sleep($, RETRY_MS)
    }
  }
  return false
}

const endTurn = async ($: EngineInterface) => {
  const id = await read($, turnId)
  if (id !== null) await $.turn.abort({ turnId: id }).catch(() => undefined)
}

const handoffDone = async ($: EngineInterface) => {
  await endTurn($)
  if (await compactWhenIdle($)) await $.prompt.submit({ text: CONTINUE })
  else $.ui.toast('clauguard: compact failed, please run /compact')
  await update($, phase, () => IDLE)
}

const stop = async ($: EngineInterface) => {
  await update($, phase, () => ({ kind: 'stopped' }) as Phase)
  $.ui.toast('clauguard: Limit erreicht', { timeoutMs: 10_000 })
  $.clock.after(0, () => void endTurn($))
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guard',
      description: 'Usage budget for this run: start [points], stop, status',
      argumentHint: 'start [points] | stop | status',
    })
    return next(e)
  })

  on('command.run', { command: 'guard' }, async ($, e) => {
    const args = e.args.trim()
    const budget = parseStart(args)
    if (budget !== undefined) {
      const { rateLimits } = await $.session.usage()
      const weekly = rateLimits.find((r) => r.kind === 'seven_day')?.percentUsed
      const started = settle({ budget }, weekly)
      await update($, run, () => started)
      await update($, phase, () => IDLE)
      $.ui.toast(
        started.cap === undefined
          ? `clauguard: +${budget} points, the stop is set with the first response`
          : `clauguard: ${Math.round(started.baseline ?? 0)}% now, stop at ${Math.round(started.cap)}%`,
      )
    } else if (args === 'stop') {
      await update($, run, () => null)
      await update($, phase, () => IDLE)
      $.ui.toast('clauguard: budget off')
    } else {
      const current = await read($, run)
      $.ui.toast(
        label(current, await read($, phase)) ?? 'clauguard: no budget set (/guard start 30)',
      )
    }
    $.ui.invalidate('ui.render')
    return {}
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, turnId, () => e.turnId)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const weekly = e.rateLimits.find((r) => r.kind === 'seven_day')?.percentUsed
    const { percent, tokens, window } = e.context
    const context =
      percent ?? (tokens !== undefined && window > 0 ? (tokens / window) * 100 : undefined)

    const current = await read($, run)
    const settled = current && settle(current, weekly)
    if (settled !== current) await update($, run, () => settled)

    const before = await read($, phase)
    const after = nextPhase(before, settled, weekly, context)
    if (after !== before) {
      await update($, phase, () => after)
      if (after.kind === 'wrapup') $.ui.toast('clauguard: Budget erreicht, Claude schließt ab')
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const current = await read($, phase)

    if (current.kind === 'stopped') return { deny: STOPPED }

    if (current.kind === 'wrapup') {
      if (current.callsLeft === 0) {
        await stop($)
        return { deny: STOPPED }
      }
      await update($, phase, () => ({ kind: 'wrapup', callsLeft: current.callsLeft - 1 }) as Phase)
      if (current.callsLeft === GRACE_CALLS) return { deny: WRAPUP }
      return next(e)
    }

    // Subagents can't compact the main conversation, so the handoff is the main agent's job.
    if (current.kind !== 'handoff' || e.agentId !== undefined) return next(e)

    if (!current.asked) {
      await update($, phase, () => ({ kind: 'handoff', asked: true }) as Phase)
      return { deny: HANDOFF }
    }

    const result = await next(e)
    if (e.tool === 'Skill' && isRemember(e.skill)) $.clock.after(0, () => void handoffDone($))
    return result
  })

  // Any compaction, also /compact or the automatic one, ends a pending handoff.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && (await read($, phase)).kind === 'handoff') {
      await update($, phase, () => IDLE)
    }
    return result
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = label(await read($, run), await read($, phase))
    if (text === undefined) return next(e)
    const tail = e.props.tail ? `${e.props.tail}  ${text}` : text
    return next({ ...e, props: { ...e.props, tail } })
  })
}
