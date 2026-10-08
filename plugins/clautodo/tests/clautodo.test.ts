import type { FsEntry, On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { label, parse, problems, summarize } from '../hooks/todo'

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
  on('ui.render', { component: 'PromptHint' }, ($, e) =>
    $.ui.resolve(e).Text({ children: e.props.tail ?? '' }),
  )
  return clock
}

const start = ($: Engine) =>
  $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

test('parses top level items and ignores indented summary lines', async () => {
  expect(parse(LIST).map((item) => item.status)).toEqual(['done', 'running', 'open'])
  expect(summarize(parse(LIST))).toEqual({ done: 1, total: 3, running: 'Adapt the tests' })
  expect(summarize(parse('# Empty'))).toBeNull()
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
