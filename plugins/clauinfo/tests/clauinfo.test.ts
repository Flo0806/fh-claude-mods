import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'

import { effortLook, modelLook, parseModel, sameModel, savedEffort } from '../hooks/info'

const BAND = {
  plugin: 'clauinfo',
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

const SETTINGS = { model: 'opus', modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }

// The engine's own end of each chain the mod calls next() on; `session` is what /model and /effort
// leave behind, `toasts` what the mod showed.
const engine = (on: On) => {
  const session = { model: 'claude-opus-5-5', settings: SETTINGS as Record<string, unknown> }
  const toasts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: session.model }))
  on('settings.read', () => ({ value: session.settings }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.run', () => ({}))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  return { session, toasts }
}

const start = ($: Engine) =>
  $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const run = ($: Engine, command: string, args = '') =>
  $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

test('reads model names however the engine spells them', () => {
  expect(parseModel('claude-opus-5-5')).toEqual({
    family: 'opus',
    version: '5.5',
    name: 'Opus 5.5',
  })
  expect(parseModel('opus[1m]').name).toBe('Opus')
  expect(parseModel('Haiku 5.5').name).toBe('Haiku 5.5')
  expect(parseModel('claude-fable-5-1').name).toBe('Fable 5.1')
  expect(parseModel('some-other-model').name).toBe('some-other-model')
  expect(sameModel('opus', 'claude-opus-5-5')).toBe(true)
  expect(sameModel('claude-opus-5-5', 'claude-haiku-5-5')).toBe(false)
})

test('colors the effort from receding to warning', () => {
  expect(effortLook('medium').dimColor).toBe(true)
  expect(effortLook('high')).toEqual({ color: 'text', bold: true })
  expect(effortLook('xhigh').color).toBe('warning')
  expect(effortLook('max').color).toBe('error')
  expect(modelLook('fable').color).toBe('claude')
  expect(modelLook('haiku').color).toBe('warning')
})

test('finds the effort saved for the model, else the global one', () => {
  expect(savedEffort(SETTINGS, 'opus')).toBe('medium')
  expect(savedEffort({ effortLevel: 'high' }, 'claude-sonnet-5-5')).toBe('high')
  expect(savedEffort({}, 'opus')).toBeUndefined()
})

test('names model and effort at start, in the band and as a toast', async ($, on) => {
  const { toasts } = engine(on)
  await start($)

  const band = await $.ui.mount(BAND)

  expect(await band.find({ text: 'Opus 5.5' })).toBeDefined()
  expect((await band.find({ type: 'Text', text: 'medium' }))?.props.dimColor).toBe(true)
  expect(toasts).toEqual(['Opus 5.5 · medium'])
})

test('follows /model and /effort, toasting each change once', async ($, on) => {
  const { session, toasts } = engine(on)
  await start($)

  session.model = 'claude-haiku-5-5'
  await run($, 'model')
  session.settings = { modelSettings: { 'claude-haiku-5-5': { effortLevel: 'xhigh' } } }
  await run($, 'effort')
  await run($, 'effort')

  const band = await $.ui.mount(BAND)

  expect((await band.find({ type: 'Text', text: 'Haiku 5.5' }))?.props.color).toBe('warning')
  expect((await band.find({ type: 'Text', text: 'xhigh' }))?.props.color).toBe('warning')
  expect(toasts).toEqual(['Opus 5.5 · medium', 'Haiku 5.5 · ?', 'Haiku 5.5 · xhigh'])
})

test('marks the effort as unknown after a switch, until a request tells', async ($, on) => {
  const { session } = engine(on)
  await start($)

  session.model = 'claude-sonnet-5-5'
  await run($, 'model')
  const band = await $.ui.mount(BAND)

  expect(await band.find({ type: 'Text', text: 'Sonnet 5.5' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '?' })).toBeDefined()
})

test('takes /effort max from the command, and keeps it over the saved level', async ($, on) => {
  const { toasts } = engine(on)
  await start($)

  await run($, 'effort', 'max')
  await run($, 'model')
  const band = await $.ui.mount(BAND)

  expect((await band.find({ type: 'Text', text: 'max' }))?.props.color).toBe('error')
  expect(toasts).toEqual(['Opus 5.5 · medium', 'Opus 5.5 · max'])
})
