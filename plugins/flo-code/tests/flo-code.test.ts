import { expect, mock, test } from 'claude-code/testing'

const NOW = new Date(2026, 10, 24, 9, 30).getTime()

const BAND = {
  plugin: 'flo-code',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('shows the time and date above the prompt and moves with the minute', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('theme.set', () => ({ value: { isDrawn: false, reason: 'no desktop in tests' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, (engine, e) => engine.ui.resolve(e).Box({}))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ text: '09:30' })).toBeDefined()
  expect(await band.find({ text: /24/ })).toBeDefined()

  await clock.advance(60_000)
  const later = await $.ui.mount(BAND)
  expect(await later.find({ text: '09:31' })).toBeDefined()
})
