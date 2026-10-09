import type { FsEntry, On } from 'claude-code'
import { expect, mock, test, type Engine, type Mounted } from 'claude-code/testing'

import { addItem, label, parse, problems, setStatus, summarize } from '../hooks/todo'

const ROOT = '/project'

const LIST = `# Nuxt migration

- [x] Switch the router
  Summary of what was done.
- [~] Adapt the tests
- [ ] Update the docs
  - [ ] an indented line is part of the summary
`

const HINT = {
  plugin: 'clautodo',
  surface: 'terminal',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const file = (name: string, mtimeMs: number): FsEntry => ({
  name,
  kind: 'file',
  size: 0,
  mtimeMs,
  isLink: false,
})

// The engine beneath the mod, with a .todo folder held in memory.
const engine = (on: On, files: Record<string, { text: string; mtimeMs: number }>) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.start', () => ({ cwd: ROOT }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.list', () => ({
    value: Object.entries(files).map(([name, { mtimeMs }]) => file(name, mtimeMs)),
  }))
  on('fs.read', (_$, e) => ({ value: files[e.path.split('/').pop() ?? '']?.text ?? '' }))
  on('fs.write', (_$, e) => {
    files[e.path.split('/').pop() ?? ''] = { text: e.text, mtimeMs: clock.now() + 1 }
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'PromptHint' }, ($, e) =>
    $.ui.resolve(e).Text({ children: e.props.tail ?? '' }),
  )
  return clock
}

const PANE = {
  plugin: 'clautodo',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'clautodo',
  props: {
    title: 'Todo',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// The rows drawn in the accent color, which marks the selected item.
const selectedTitles = async (pane: Mounted<'terminal', 'Pane'>) =>
  (await pane.findAll({ type: 'Text' }))
    .filter((text) => text.props.color === 'claude')
    .map((text) => text.text)

const start = ($: Engine) =>
  $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

test('parses the title, top level items and their indented summaries', async () => {
  const { title, items } = parse(LIST)

  expect(title).toBe('Nuxt migration')
  expect(items.map((item) => item.status)).toEqual(['done', 'running', 'open'])
  expect(items[0]?.summary).toEqual(['Summary of what was done.'])
  expect(items[2]?.summary).toEqual(['- [ ] an indented line is part of the summary'])
  expect(items.map((item) => item.line)).toEqual([2, 4, 5])
  expect(summarize(items)).toEqual({ done: 1, total: 3, running: 'Adapt the tests' })
  expect(summarize(parse('# Empty').items)).toBeNull()
})

test('rewrites one mark in place and refuses a line that moved', async () => {
  const [, running] = parse(LIST).items

  expect(setStatus(LIST, running!, 'done')).toBe(LIST.replace('- [~] Adapt', '- [x] Adapt'))
  expect(setStatus(`\n${LIST}`, running!, 'done')).toBeNull()
})

test('labels the count, the running item and a finished list', async () => {
  expect(label({ done: 1, total: 3, running: 'Adapt the tests' })).toBe('☐ 1/3 · Adapt the tests')
  expect(label({ done: 1, total: 3 })).toBe('☐ 1/3')
  expect(label({ done: 3, total: 3 })).toBe('☑ 3/3')
})

test('shows the newest list at the end of the hint line', async ($, on) => {
  engine(on, {
    'old.md': { text: '- [ ] Old item', mtimeMs: 1 },
    'nuxt.md': { text: LIST, mtimeMs: 2 },
  })
  await start($)

  const hint = await $.ui.mount(HINT)

  expect(await hint.find({ text: '☐ 1/3 · Adapt the tests' })).toBeDefined()
})

test('picks up a changed list on the next poll', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  const clock = engine(on, files)
  await start($)
  const hint = await $.ui.mount(HINT)

  files['nuxt.md'] = {
    text: LIST.replace('[~]', '[x]').replace('[ ] Update', '[x] Update'),
    mtimeMs: 2,
  }
  await clock.advance(2000)

  expect(await hint.find({ text: '☑ 3/3' })).toBeDefined()
})

test('leaves the hint line alone without a .todo folder', async ($, on) => {
  engine(on, {})
  await start($)

  const hint = await $.ui.mount(HINT)

  expect(await hint.find({ text: /[☐☑]/ })).toBeUndefined()
})

test('names each line that looks like an item but is not one', async () => {
  expect(problems(LIST)).toEqual([])
  expect(
    problems('- [x] Done\n- [*] Odd mark\n-[ ] No space\n  - [?] indented is a summary'),
  ).toEqual(['line 2: `- [*] Odd mark`', 'line 3: `-[ ] No space`'])
})

test('adds its rules last to the system prompt', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hi', scope: 'shared' }] }))

  const { sections } = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  expect(sections.map((section) => section.id)).toEqual(['intro', 'clautodo:rules'])
  expect(sections[1]?.text).toContain('.todo/<project>.md')
})

test('refuses the built-in todo tools in the main conversation', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' as never }))

  const todo = await $.tool.call({ tool: 'TodoWrite', todos: [] })
  const task = await $.tool.call({ tool: 'TaskCreate', subject: 'x', description: 'y' })
  const stop = await $.tool.call({ tool: 'TaskStop', task_id: '1' })

  expect(todo.deny).toContain('built-in todo list is disabled')
  expect(task.deny).toContain('built-in todo list is disabled')
  expect(stop.deny).toBeUndefined()
})

test('tells the model about broken lines after it edited a todo file', async ($, on) => {
  const files = { 'nuxt.md': { text: '- [x] Done\n- [*] Odd mark', mtimeMs: 1 } }
  engine(on, files)
  on('tool.call', () => ({ result: 'edited' as never }))
  const edit = { old_string: 'a', new_string: 'b' }

  const broken = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/.todo/nuxt.md`, ...edit })
  const other = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/notes.md`, ...edit })
  files['nuxt.md'].text = LIST
  const fixed = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/.todo/nuxt.md`, ...edit })

  expect(broken.context?.join('\n')).toContain('line 2: `- [*] Odd mark`')
  expect(other.context).toBeUndefined()
  expect(fixed.context).toBeUndefined()
})

test('lists the items, shows the selected one and checks it off', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  expect(await pane.find({ text: 'Nuxt migration' })).toBeDefined()
  expect(await pane.find({ text: 'Select an item: 1-9 or Enter' })).toBeDefined()
  expect(await pane.find({ key: 'done' })).toBeUndefined()

  await pane.press({ key: 'item-2' })
  expect(await pane.find({ text: 'Summary of what was done.' })).toBeDefined()
  expect(await selectedTitles(pane)).toEqual(['Switch the router'])

  await pane.press({ key: 'item-4' })
  expect(await pane.find({ text: 'No summary.' })).toBeDefined()

  await pane.press({ key: 'done' })
  expect(files['nuxt.md'].text).toContain('- [x] Adapt the tests')
  expect((await pane.find({ key: 'done' }))?.props.label).toBe('reopen')
})

test('drops the selection when the selected item is pressed again', async ($, on) => {
  engine(on, { 'nuxt.md': { text: LIST, mtimeMs: 1 } })
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'item-2' })
  await pane.press({ key: 'item-2' })

  expect(await selectedTitles(pane)).toEqual([])
  expect(await pane.find({ text: 'Select an item: 1-9 or Enter' })).toBeDefined()
})

test('adds an item after the last one and its summary', async () => {
  const withNotes = `${LIST}\n## Notes\nfree text\n`

  expect(addItem(LIST, 'New one')).toBe(LIST.replace('summary\n', 'summary\n- [ ] New one\n'))
  expect(addItem(withNotes, 'New one')).toContain('summary\n- [ ] New one\n\n## Notes')
  expect(addItem('# Empty\n', 'First')).toBe('# Empty\n\n- [ ] First\n')
  expect(addItem('', 'First')).toBe('- [ ] First\n')
  expect(addItem('', 'First\n  second line\n\nthird\n')).toBe(
    '- [ ] First\n  second line\n  third\n',
  )
})

test('adds an item from the pane and selects it', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'add' })
  await pane.input({ key: 'new-item', text: 'Write the changelog' })

  expect(files['nuxt.md'].text).toContain('- [ ] Write the changelog')
  expect(await selectedTitles(pane)).toEqual(['Write the changelog'])
  expect(await pane.find({ key: 'new-item' })).toBeUndefined()
})

test('closes the field without a change on an empty title', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'add' })
  await pane.input({ key: 'new-item', text: '  ' })

  expect(files['nuxt.md'].text).toBe(LIST)
  expect(await pane.find({ key: 'add' })).toBeDefined()
})

test('says so when there is no list', async ($, on) => {
  engine(on, {})
  await start($)

  const pane = await $.ui.mount(PANE)

  expect(await pane.find({ text: 'No todo list in .todo/ yet.' })).toBeDefined()
})
