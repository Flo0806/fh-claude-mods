import { expect, mock, test } from 'claude-code/testing'

import {
  CONTINUE,
  DEFAULT_BUDGET,
  GRACE_CALLS,
  HANDOFF_AT,
  isRemember,
  label,
  nextPhase,
  parseStart,
  settle,
} from '../hooks/guard'

const IDLE = { kind: 'idle' } as const

test('start takes an optional budget in points', async () => {
  expect(parseStart('start')).toBe(DEFAULT_BUDGET)
  expect(parseStart('start 12.5')).toBe(12.5)
  expect(parseStart(' start 30 ')).toBe(30)
  expect(parseStart('stop')).toBeUndefined()
  expect(parseStart('start abc')).toBeUndefined()
})

test('the cap counts from the first weekly figure', async () => {
  expect(settle({ budget: 30 }, undefined)).toEqual({ budget: 30 })
  expect(settle({ budget: 30 }, 10)).toEqual({ budget: 30, baseline: 10, cap: 40 })
  const settled = { budget: 30, baseline: 10, cap: 40 }
  expect(settle(settled, 25)).toBe(settled)
})

test('reaching the cap starts the wrap-up', async () => {
  const run = { budget: 30, baseline: 10, cap: 40 }
  expect(nextPhase(IDLE, run, 39.9, 10)).toBe(IDLE)
  expect(nextPhase(IDLE, run, 40, 10)).toEqual({ kind: 'wrapup', callsLeft: GRACE_CALLS })
})

test('a full context asks for the handoff once', async () => {
  expect(nextPhase(IDLE, null, undefined, HANDOFF_AT - 1)).toBe(IDLE)
  expect(nextPhase(IDLE, null, undefined, HANDOFF_AT)).toEqual({ kind: 'handoff', asked: false })
  const asked = { kind: 'handoff', asked: true } as const
  expect(nextPhase(asked, null, undefined, 95)).toBe(asked)
})

test('the budget wins over the handoff and a stop stays a stop', async () => {
  const run = { budget: 5, baseline: 10, cap: 15 }
  expect(nextPhase({ kind: 'handoff', asked: true }, run, 20, 90).kind).toBe('wrapup')
  expect(nextPhase({ kind: 'stopped' }, null, 0, 0)).toEqual({ kind: 'stopped' })
})

test('new measurements keep the grace count and the stop', async () => {
  const run = { budget: 5, baseline: 10, cap: 15 }
  expect(nextPhase({ kind: 'wrapup', callsLeft: 3 }, run, 20, 10)).toEqual({
    kind: 'wrapup',
    callsLeft: 3,
  })
  expect(nextPhase({ kind: 'stopped' }, run, 20, 10)).toEqual({ kind: 'stopped' })
})

test('recognizes the remember skill', async () => {
  expect(isRemember('remember:remember')).toBe(true)
  expect(isRemember('remember')).toBe(true)
  expect(isRemember('remember-me')).toBe(false)
})

test('labels the prompt hint', async () => {
  expect(label(null, IDLE)).toBeUndefined()
  expect(label({ budget: 30 }, IDLE)).toBe('guard …')
  expect(label({ budget: 30, baseline: 10, cap: 40 }, IDLE)).toBe('guard ≤40%')
  expect(label(null, { kind: 'stopped' })).toBe('guard ⛔ Limit erreicht')
})

const ENGINE_OK = { result: 'ok' } as never

const engine = (on: import('claude-code').On, weekly = 10) => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000 },
      rateLimits: [{ kind: 'seven_day', percentUsed: weekly }],
    },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('tool.call', () => ENGINE_OK)
}

const measure = (weekly: number, percent: number) => ({
  context: { window: 200_000, percent },
  rateLimits: [{ kind: 'seven_day', percentUsed: weekly }],
  changed: ['context' as const],
})

const read = { tool: 'Read', file_path: '/x' } as never

test('a run over budget wraps up, then stops every tool', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'guard', args: 'start 30' } as never)
  await $.session.measure(measure(40, 10))

  expect(await $.tool.call(read)).toMatchObject({ deny: expect.stringContaining('budget') })
  for (let i = 1; i < GRACE_CALLS; i++)
    expect(await $.tool.call(read)).toMatchObject({ result: 'ok' })
  expect(await $.tool.call(read)).toMatchObject({ deny: expect.stringContaining('Limit erreicht') })
  expect(await $.tool.call(read)).toMatchObject({ deny: expect.stringContaining('Limit erreicht') })
})

test('a full context asks the main agent once for the handoff', async ($, on) => {
  engine(on)
  await $.session.measure(measure(10, HANDOFF_AT))

  expect(await $.tool.call({ ...(read as object), agentId: 'sub' } as never)).toMatchObject({
    result: 'ok',
  })
  expect(await $.tool.call(read)).toMatchObject({ deny: expect.stringContaining('/remember') })
  expect(await $.tool.call(read)).toMatchObject({ result: 'ok' })
})

test('after /remember it ends the turn, compacts and carries on', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: 0 })
  const calls: string[] = []
  on('turn.start', (_$, e) => {
    calls.push(`start ${e.turnId}`)
    return { turnId: e.turnId } as never
  })
  on('turn.abort', (_$, e) => {
    calls.push(`abort ${e.turnId}`)
    return { value: undefined } as never
  })
  on('session.compact', () => {
    calls.push('compact')
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never
  })
  on('prompt.submit', (_$, e) => {
    calls.push(`submit ${e.text}`)
    return { text: e.text } as never
  })

  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.session.measure(measure(10, 90))
  await $.tool.call(read)
  await $.tool.call(read)
  await clock.advance(1000)
  expect(calls).toEqual(['start t1'])

  await $.tool.call({ tool: 'Skill', skill: 'remember:remember' } as never)
  await clock.advance(0)
  await clock.advance(1000)

  expect(calls).toEqual(['start t1', 'abort t1', 'compact', `submit ${CONTINUE}`])
})
