import type { FsEntry, On } from 'claude-code'
import { expect, mock, test, type Engine, type Mounted } from 'claude-code/testing'

import {
  addItem,
  deleteItem,
  editSummary,
  fileName,
  label,
  parse,
  problems,
  renameItem,
  setStatus,
  summarize,
} from '../hooks/todo'
import { moveCommands } from '../hooks/move'

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

// Whether the engine holds the pane open; ui.close clears it.
let open = true

// The commands the mod ran, and whether they fail.
let runs: (readonly string[])[] = []
let failing = false

const PANE_ROW = { id: 'clautodo', title: 'Todo', isShown: true, isFocused: true, isPlaced: true }

// The engine beneath the mod, with a .todo folder held in memory.
const engine = (on: On, files: Record<string, { text: string; mtimeMs: number }>) => {
  open = true
  runs = []
  failing = false
  const clock = mock.clock(on, { now: 0 })
  on('session.start', () => ({ cwd: ROOT }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.list', () => ({
    value: Object.entries(files)
      .filter(([name]) => !name.includes('/'))
      .map(([name, { mtimeMs }]) => file(name, mtimeMs)),
  }))
  on('fs.read', (_$, e) => ({ value: files[e.path.split('/').pop() ?? '']?.text ?? '' }))
  on('fs.write', (_$, e) => {
    files[e.path.split('/').pop() ?? ''] = { text: e.text, mtimeMs: clock.now() + 1 }
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: e.path.replace(`${ROOT}/.todo/`, '') in files }))
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    const [command, from, to] = e.argv
    if (command === 'mv' && from && to) {
      const name = from.split('/').pop() ?? ''
      files[`archive/${name}`] = files[name]!
      delete files[name]
    }
    const stderr = failing ? 'denied' : ''
    const output = { stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false }
    return { value: { exitCode: failing ? 1 : 0, ...output } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: open ? [PANE_ROW] : [] }))
  on('ui.close', () => {
    open = false
    return { value: undefined }
  })
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

test('selects the added item even when the list grew since it was drawn', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'add' })
  files['nuxt.md'].text = addItem(LIST, 'Added meanwhile')
  await pane.input({ key: 'new-item', text: 'Write the changelog' })

  expect(await selectedTitles(pane)).toEqual(['Write the changelog'])
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

test('renames an item, keeps its mark and adds further lines to its summary', async () => {
  const [done, running] = parse(LIST).items

  expect(renameItem(LIST, running!, 'Fix the tests')).toBe(
    LIST.replace('- [~] Adapt the tests', '- [~] Fix the tests'),
  )
  expect(renameItem(LIST, done!, 'Router\nAlso the guards')).toBe(
    LIST.replace(
      '- [x] Switch the router\n  Summary of what was done.\n',
      '- [x] Router\n  Summary of what was done.\n  Also the guards\n',
    ),
  )
  expect(renameItem(LIST, running!, '  ')).toBeNull()
  expect(renameItem(`\n${LIST}`, running!, 'Moved')).toBeNull()
})

test('edits the title of the selected item from the pane', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  expect(await pane.find({ key: 'title' })).toBeUndefined()
  await pane.press({ key: 'item-4' })
  await pane.press({ key: 'title' })

  expect((await pane.find({ key: 'edit-item' }))?.props.value).toBe('Adapt the tests')
  await pane.input({ key: 'edit-item', text: 'Fix the tests' })

  expect(files['nuxt.md'].text).toContain('- [~] Fix the tests')
  expect(await pane.find({ key: 'edit-item' })).toBeUndefined()
  expect(await selectedTitles(pane)).toEqual(['Fix the tests'])
})

test('leaves the file alone when the title is submitted unchanged', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'item-4' })
  await pane.press({ key: 'title' })
  await pane.input({ key: 'edit-item', text: 'Adapt the tests' })

  expect(files['nuxt.md'].mtimeMs).toBe(1)
  expect(await pane.find({ key: 'title' })).toBeDefined()
})

test('says in the pane when the list changed before a write', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'item-4' })
  files['nuxt.md'].text = `\n${LIST}`
  await pane.press({ key: 'done' })

  expect(files['nuxt.md'].text).toBe(`\n${LIST}`)
  expect(await pane.find({ text: 'The list changed meanwhile, try again.' })).toBeDefined()
})

test('closes itself after two idle minutes, but never while a field is open', async ($, on) => {
  const clock = engine(on, { 'nuxt.md': { text: LIST, mtimeMs: 1 } })
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'add' })
  await clock.advance(5 * 60 * 1000)
  expect(open).toBe(true)

  await pane.input({ key: 'new-item', text: '' })
  await clock.advance(60 * 1000)
  expect(open).toBe(true)

  await clock.advance(75 * 1000)
  expect(open).toBe(false)
})

test('replaces, removes or splits one summary line and keeps its indent', async () => {
  const [done, , last] = parse(LIST).items
  const nested = '  - [ ] an indented line is part of the summary'

  expect(editSummary(LIST, done!, 0, 'Router switched.')).toBe(
    LIST.replace('  Summary of what was done.', '  Router switched.'),
  )
  expect(editSummary(LIST, done!, 0, '')).toBe(LIST.replace('  Summary of what was done.\n', ''))
  expect(editSummary(LIST, done!, 0, 'One\nTwo')).toBe(
    LIST.replace('  Summary of what was done.', '  One\n  Two'),
  )
  expect(editSummary(LIST, last!, 0, 'nested')).toBe(LIST.replace(nested, '  nested'))
  expect(editSummary(LIST.replace('was done', 'changed'), done!, 0, 'x')).toBeNull()
  expect(editSummary(LIST, done!, 5, 'x')).toBeNull()
})

test('edits a summary line in place from the pane', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'item-2' })
  await pane.press({ key: 'summary-0' })
  expect((await pane.find({ key: 'summary-line' }))?.props.value).toBe('Summary of what was done.')
  expect(await pane.find({ key: 'done' })).toBeUndefined()

  await pane.input({ key: 'summary-line', text: 'Router switched, guards too.' })

  expect(files['nuxt.md'].text).toContain('  Router switched, guards too.\n')
  expect(await pane.find({ text: 'Router switched, guards too.' })).toBeDefined()
  expect(await pane.find({ key: 'summary-line' })).toBeUndefined()
})

test('deletes an item with its summary and refuses a line that moved', async () => {
  const [done, , last] = parse(LIST).items

  expect(deleteItem(LIST, done!)).toBe(
    LIST.replace('- [x] Switch the router\n  Summary of what was done.\n', ''),
  )
  expect(deleteItem(LIST, last!)).toBe(LIST.replace(/- \[ \] Update the docs\n.*\n/, ''))
  expect(deleteItem(`\n${LIST}`, done!)).toBeNull()
})

test('deletes only on a second press', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'item-2' })
  await pane.press({ key: 'delete' })

  expect(files['nuxt.md'].text).toBe(LIST)
  expect((await pane.find({ key: 'delete' }))?.props.label).toBe('confirm')
  expect(
    await pane.find({ text: 'Delete "Switch the router" and its summary? Press d again.' }),
  ).toBeDefined()

  await pane.press({ key: 'delete' })

  expect(files['nuxt.md'].text).not.toContain('Switch the router')
  expect(await pane.find({ text: 'Select an item: 1-9 or Enter' })).toBeDefined()
})

test('drops a pending delete on any other action', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'item-2' })
  await pane.press({ key: 'delete' })
  await pane.press({ key: 'item-4' })
  await pane.press({ key: 'delete' })

  expect(files['nuxt.md'].text).toBe(LIST)
  expect((await pane.find({ key: 'delete' }))?.props.label).toBe('confirm')
})

test('shows the list named in .todo/.active, even when another changed later', async ($, on) => {
  engine(on, {
    'nuxt.md': { text: LIST, mtimeMs: 1 },
    'other.md': { text: '- [ ] Other item', mtimeMs: 5 },
    '.active': { text: 'nuxt.md\n', mtimeMs: 1 },
  })
  await start($)

  const hint = await $.ui.mount(HINT)

  expect(await hint.find({ text: '☐ 1/3 · Adapt the tests' })).toBeDefined()
})

test('falls back to the newest list when .todo/.active names none', async ($, on) => {
  engine(on, {
    'nuxt.md': { text: LIST, mtimeMs: 1 },
    'other.md': { text: '- [ ] Other item', mtimeMs: 5 },
    '.active': { text: 'gone.md', mtimeMs: 1 },
  })
  await start($)

  const hint = await $.ui.mount(HINT)

  expect(await hint.find({ text: '☐ 0/1' })).toBeDefined()
})

test('switches lists on the next poll when .todo/.active changes', async ($, on) => {
  const files = {
    'nuxt.md': { text: LIST, mtimeMs: 1 },
    'other.md': { text: '- [ ] Other item', mtimeMs: 5 },
    '.active': { text: 'nuxt.md', mtimeMs: 1 },
  }
  const clock = engine(on, files)
  await start($)
  const hint = await $.ui.mount(HINT)

  files['.active'] = { text: 'other.md', mtimeMs: 2 }
  await clock.advance(2000)

  expect(await hint.find({ text: '☐ 0/1' })).toBeDefined()
})

test('lists the projects with their progress and switches the active one', async ($, on) => {
  const files = {
    'nuxt.md': { text: LIST, mtimeMs: 1 },
    'other.md': { text: '# Other\n\n- [x] Done item\n- [ ] Open item', mtimeMs: 5 },
    '.active': { text: 'nuxt.md', mtimeMs: 1 },
  }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'projects' })

  expect(await pane.find({ text: 'Projects' })).toBeDefined()
  expect(await pane.find({ text: '1/3' })).toBeDefined()
  expect(await pane.find({ text: '1/2' })).toBeDefined()
  expect(await selectedTitles(pane)).toEqual(['Nuxt migration'])

  await pane.press({ key: 'project-other.md' })

  expect(files['.active'].text).toBe('other.md\n')
  expect(await pane.find({ text: 'Other' })).toBeDefined()
  expect(await pane.find({ text: 'Open item' })).toBeDefined()
  expect(await pane.find({ key: 'projects' })).toBeDefined()
})

test('goes back to the items without a change', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'projects' })
  expect((await pane.find({ key: 'projects' }))?.props.label).toBe('items')
  await pane.press({ key: 'projects' })

  expect(await pane.find({ text: 'Nuxt migration' })).toBeDefined()
  expect(Object.keys(files)).toEqual(['nuxt.md'])
})

test('turns a project title into a file name', async () => {
  expect(fileName('Nuxt Migration')).toBe('nuxt-migration.md')
  expect(fileName('Größe & Übersicht!')).toBe('grosse-ubersicht.md')
  expect(fileName('  ***  ')).toBe('todo.md')
})

test('creates a project, makes it active and shows its empty list', async ($, on) => {
  const files: Record<string, { text: string; mtimeMs: number }> = {
    'nuxt.md': { text: LIST, mtimeMs: 1 },
  }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'projects' })
  await pane.press({ key: 'new' })
  await pane.input({ key: 'new-project', text: 'Nuxt Docs' })

  expect(files['nuxt-docs.md']?.text).toBe('# Nuxt Docs\n\n')
  expect(files['.active']?.text).toBe('nuxt-docs.md\n')
  expect(await pane.find({ text: 'Nuxt Docs' })).toBeDefined()
  expect(await pane.find({ text: 'No items yet.' })).toBeDefined()
  expect(await pane.find({ key: 'add' })).toBeDefined()
})

test('refuses a project whose file exists already', async ($, on) => {
  const files = { 'nuxt.md': { text: LIST, mtimeMs: 1 } }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'projects' })
  await pane.press({ key: 'new' })
  await pane.input({ key: 'new-project', text: 'Nuxt' })

  expect(files['nuxt.md'].text).toBe(LIST)
  expect(await pane.find({ text: 'nuxt.md exists already.' })).toBeDefined()
  expect(await pane.find({ text: 'Projects' })).toBeDefined()

  await pane.press({ key: 'projects' })
  expect(await pane.find({ text: 'nuxt.md exists already.' })).toBeUndefined()
})

test('moves with mv here and with move on Windows', async () => {
  expect(
    moveCommands('/home/flo/app', '.todo/a.md', '.todo/archive/a.md', '.todo/archive'),
  ).toEqual([
    ['mkdir', '-p', '.todo/archive'],
    ['mv', '.todo/a.md', '.todo/archive/a.md'],
  ])
  expect(moveCommands('C:\\app', '.todo/a.md', '.todo/archive/a.md', '.todo/archive')).toEqual([
    ['cmd', '/c', 'if', 'not', 'exist', '.todo\\archive', 'mkdir', '.todo\\archive'],
    ['cmd', '/c', 'move', '.todo\\a.md', '.todo\\archive\\a.md'],
  ])
})

test('archives the active project on a second press and clears .active', async ($, on) => {
  const files: Record<string, { text: string; mtimeMs: number }> = {
    'nuxt.md': { text: LIST, mtimeMs: 1 },
    'other.md': { text: '# Other\n\n- [ ] Open item', mtimeMs: 5 },
    '.active': { text: 'nuxt.md', mtimeMs: 1 },
  }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'projects' })
  await pane.press({ key: 'archive' })
  expect(await pane.find({ text: 'Archive "Nuxt migration"? Press c again.' })).toBeDefined()
  expect(runs).toEqual([])

  await pane.press({ key: 'archive' })

  expect(runs.at(-1)).toEqual(['mv', '.todo/nuxt.md', '.todo/archive/nuxt.md'])
  expect(files['archive/nuxt.md']?.text).toBe(LIST)
  expect(files['.active']?.text).toBe('')
  expect(await pane.find({ text: 'Nuxt migration' })).toBeUndefined()
  expect(await selectedTitles(pane)).toEqual(['Other'])
})

test('keeps the project when the archive holds one of that name or the move fails', async ($, on) => {
  const files = {
    'nuxt.md': { text: LIST, mtimeMs: 1 },
    'archive/nuxt.md': { text: 'older', mtimeMs: 0 },
  }
  engine(on, files)
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'projects' })
  await pane.press({ key: 'archive' })
  await pane.press({ key: 'archive' })

  expect(runs).toEqual([])
  expect(await pane.find({ text: '.todo/archive/nuxt.md exists already.' })).toBeDefined()

  delete (files as Record<string, unknown>)['archive/nuxt.md']
  failing = true
  await pane.press({ key: 'archive' })
  await pane.press({ key: 'archive' })

  expect(files['nuxt.md'].text).toBe(LIST)
  expect(await pane.find({ text: 'Could not archive nuxt.md: denied' })).toBeDefined()
})

test('shows each action button with its key', async ($, on) => {
  engine(on, { 'nuxt.md': { text: LIST, mtimeMs: 1 } })
  await start($)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'item-5' })
  const items = await pane.findAll({ type: 'Button' })
  await pane.press({ key: 'projects' })
  const projectButtons = await pane.findAll({ type: 'Button' })

  const actions = [...items, ...projectButtons].filter((button) =>
    /^[a-z]$/.test(String(button.props.hotkey ?? '')),
  )
  expect(actions.map((button) => button.props.hotkey).toSorted()).toEqual([
    'a',
    'c',
    'd',
    'n',
    'p',
    'p',
    's',
    'x',
  ])
  expect(actions.every((button) => button.props.plain)).toBe(true)
})

test('says so when there is no list', async ($, on) => {
  engine(on, {})
  await start($)

  const pane = await $.ui.mount(PANE)

  expect(await pane.find({ text: 'No todo list in .todo/ yet.' })).toBeDefined()
})
