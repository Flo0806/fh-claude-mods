import type { On, SessionContextUsage, SessionMeasureInput } from 'claude-code'
import { expect, mock, test, type Plugin } from 'claude-code/testing'

const NOW = Date.parse('2026-10-09T11:00:00+02:00')

const BAND = {
  plugin: 'clausage',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// The engine's own end of each chain the mod calls next() on.
const engine = (on: On, context = (): SessionContextUsage => ({ window: 200_000 })) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: { startedAt: NOW, context: context(), rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  // An empty band, as the engine draws when no plugin shows anything.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
}

const measure = (e: Partial<SessionMeasureInput>): SessionMeasureInput => ({
  context: { window: 200_000 },
  rateLimits: [],
  changed: ['context'],
  ...e,
})

test('draws all three bars, colored by level, with reset times', async ($, on) => {
  engine(on)
  await $.session.measure(
    measure({
      context: { window: 200_000, tokens: 12_000, percent: 6 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 55, resetsAt: '2026-10-09T14:30:00+02:00' },
        { kind: 'seven_day', percentUsed: 85, resetsAt: '2026-10-12T09:00:00+02:00' },
      ],
    }),
  )

  const band = await $.ui.mount(BAND)

  expect((await band.find({ text: /^▰▰▰▰▱▱▱▱ 55%$/ }))?.props.color).toBe('warning')
  expect((await band.find({ text: /^▰▰▰▰▰▰▰▱ 85%$/ }))?.props.color).toBe('error')
  expect((await band.find({ text: /^▱▱▱▱▱▱▱▱ 6%$/ }))?.props.color).toBe('success')
  expect(await band.find({ text: /^↻ 14:30$/ })).toBeDefined()
  expect(await band.find({ text: /^↻ Mon?$/ })).toBeDefined()
})

test('shows only a context placeholder off a subscription, before the first response', async ($, on) => {
  engine(on)
  await $.session.measure(measure({}))

  const band = await $.ui.mount(BAND)

  expect(await band.find({ text: '5h' })).toBeUndefined()
  expect(await band.find({ text: '7d' })).toBeUndefined()
  expect(await band.find({ text: '▱▱▱▱▱▱▱▱ –' })).toBeDefined()
})

// Loads further in than clausage and draws its band without calling next().
const other = {
  name: 'other-band',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) =>
      $.ui.resolve(e).Text({ children: 'other band' }),
    )
  },
} satisfies Plugin

test(
  'keeps the bands of plugins further in, drawing below them',
  { plugins: [other] },
  async ($, on) => {
    engine(on)
    await $.session.measure(measure({ context: { window: 200_000, percent: 6 } }))

    const band = await $.ui.mount(BAND)
    const texts = (await band.findAll({ type: 'Text' })).map((t) => t.text)

    expect(texts).toContain('other band')
    expect(texts.indexOf('other band')).toBeLessThan(texts.indexOf('ctx'))
  },
)

test('steps aside while compacting and reads the context afresh afterwards', async ($, on) => {
  // The engine's compaction: the band is drawn mid-way, the context has shrunk once it is done.
  let percent = 92
  let during: (string | undefined)[] = []
  engine(on, () => ({ window: 200_000, percent }))
  on('session.compact', async (_$, e) => {
    during = (await (await $.ui.mount(BAND)).findAll({ type: 'Text' })).map((t) => t.text)
    percent = 4
    return { messages: e.messages }
  })

  await $.session.measure(measure({ context: { window: 200_000, percent: 92 } }))
  await $.session.compact({
    trigger: 'manual',
    messages: [{ role: 'user', text: 'a long conversation', toolUses: [] }],
  })
  const band = await $.ui.mount(BAND)

  expect(during).not.toContain('ctx')
  expect(await band.find({ text: /^▱▱▱▱▱▱▱▱ 4%$/ })).toBeDefined()
})

test('shows the context placeholder again after /clear', async ($, on) => {
  engine(on)
  await $.session.measure(measure({ context: { window: 200_000, percent: 60 } }))

  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
  const band = await $.ui.mount(BAND)

  expect(await band.find({ text: '▱▱▱▱▱▱▱▱ –' })).toBeDefined()
})
