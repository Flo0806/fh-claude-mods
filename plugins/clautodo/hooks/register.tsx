import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Item, Mode, Project, Status, TodoList } from '../types'
import { disable, formatNote, isTodoFile, pass } from './guards'
import { moveCommands } from './move'
import { drawPane } from './pane'
import type { Actions } from './pane'
import { RULES } from './rules'
import {
  addItem,
  deleteItem,
  editSummary,
  fileName,
  label,
  parse,
  renameItem,
  setStatus,
  summarize,
} from './todo'

// Everything that takes `$` and every state value lives in this file: the engine follows `$` and
// reads state references only within the module's own file, never across an import.

type Field = Exclude<Mode, 'view'>

const list = atom({ plugin: 'clautodo', key: 'list' } as const, null)
const selected = atom({ plugin: 'clautodo', key: 'selected' } as const, null)
const mode = atom({ plugin: 'clautodo', key: 'mode' } as const, 'view')
// Shown in the pane, where a toast would wait until the pane closes.
const notice = atom({ plugin: 'clautodo', key: 'notice' } as const, null)
const line = atom({ plugin: 'clautodo', key: 'line' } as const, null)
const pending = atom({ plugin: 'clautodo', key: 'pending' } as const, null)
const projects = atom({ plugin: 'clautodo', key: 'projects' } as const, null)

const PANE = 'clautodo'

const PANE_OPEN = { id: PANE, title: 'Todo', focus: true, closeOnEscape: true } as const

const POLL_MS = 2000

const IDLE_MS = 2 * 60 * 1000

const IDLE_CHECK_MS = 15 * 1000

const ACTIVE = '.active'

const todoDir = async ($: EngineInterface) => `${await $.session.root()}/.todo`

const isList = (entry: { kind: string; name: string }) =>
  entry.kind === 'file' && entry.name.endsWith('.md')

// The name in .active and the mtime it was read at, so a poll reads it again only after a change.
let pointer = { mtimeMs: -1, name: '' }

// The list named in .active, or the most recently changed one when that names none.
const activeList = async ($: EngineInterface, dir: string) => {
  const entries = await $.fs.list(dir).catch(() => [])
  const lists = entries.filter(isList)
  const marker = entries.find((entry) => entry.kind === 'file' && entry.name === ACTIVE)

  if (marker && marker.mtimeMs !== pointer.mtimeMs) {
    const name = String(await $.fs.read(`${dir}/${ACTIVE}`).catch(() => '')).trim()
    pointer = { mtimeMs: marker.mtimeMs, name }
  }
  const named = marker && lists.find((entry) => entry.name === pointer.name)
  return named ?? lists.toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0]
}

// Name and mtime of the list last read, so a poll reads it again only after a change.
let seen = ''

const load = async ($: EngineInterface, force = false) => {
  const dir = await todoDir($)
  const entry = await activeList($, dir)
  const stamp = entry ? `${entry.name}:${entry.mtimeMs}` : ''
  if (stamp === seen && !force) return
  seen = stamp

  const path = entry && `${dir}/${entry.name}`
  const text = path ? String(await $.fs.read(path).catch(() => '')) : ''
  const latest: TodoList | null = path ? { path, ...parse(text) } : null
  await update($, list, () => latest)
}

// An empty name hands the choice back to the newest list.
const setActive = async ($: EngineInterface, name: string) => {
  await $.fs.write(`${await todoDir($)}/${ACTIVE}`, name ? `${name}\n` : '')
  pointer = { mtimeMs: -1, name }
  await load($, true)
}

const readProjects = async ($: EngineInterface): Promise<Project[]> => {
  const dir = await todoDir($)
  const entries = await $.fs.list(dir).catch(() => [])
  const names = entries
    .filter(isList)
    .map((entry) => entry.name)
    .toSorted()

  return Promise.all(
    names.map(async (name) => {
      const { title, items } = parse(String(await $.fs.read(`${dir}/${name}`).catch(() => '')))
      const done = items.filter((item) => item.status === 'done').length
      return { name, title, done, total: items.length }
    }),
  )
}

const checkFormat = async (
  $: EngineInterface,
  path: string,
  ran: ToolCallResult,
): Promise<ToolCallResult> => {
  if (!isTodoFile(path) || ran.deny !== undefined || ran.isError) return ran

  const note = formatNote(path, String(await $.fs.read(path).catch(() => '')))
  return note ? { ...ran, context: [...(ran.context ?? []), note] } : ran
}

let lastActivity = 0

// Every action counts as activity, and any action but the second press drops what waits for it.
const touch = async ($: EngineInterface) => {
  lastActivity = await $.clock.now()
  await update($, pending, () => null)
}

// Never while a field is open, so typing is not cut off.
const closeWhenIdle = async ($: EngineInterface) => {
  const isOpen = (await $.ui.panes()).some((pane) => pane.id === PANE)
  const isIdle = (await $.clock.now()) - lastActivity >= IDLE_MS
  if (isOpen && isIdle && (await read($, mode)) === 'view') await $.ui.close({ id: PANE })
}

// Opens before loading, so the engine places the pane as the answer to /todo at any width; an
// open it takes for one of the plugin's own waits undrawn on a narrow terminal. Activity counts
// from before the open, so the idle check never closes the fresh pane.
const openPane = async ($: EngineInterface) => {
  await touch($)
  const opened = await $.ui.open(PANE_OPEN)
  if (!opened.isPlaced) $.ui.toast(`The todo pane waits: ${opened.reason}`)
  await update($, selected, () => null)
  await update($, mode, () => 'view')
  await update($, notice, () => null)
  await update($, projects, () => null)
  await load($, true)
}

// Reads the file again before writing, so an edit made meanwhile is kept.
const rewrite = async (
  $: EngineInterface,
  path: string,
  change: (text: string) => string | null,
) => {
  await touch($)
  const changed = change(String(await $.fs.read(path)))
  if (changed !== null) await $.fs.write(path, changed)
  await update($, notice, () =>
    changed === null ? 'The list changed meanwhile, try again.' : null,
  )
  await load($, true)
}

// True on the second press of the same action, else marks it as waiting.
const confirmed = async ($: EngineInterface, action: 'delete' | 'archive') => {
  const isSecond = (await read($, pending)) === action
  await touch($)
  if (!isSecond) await update($, pending, () => action)
  return isSecond
}

const select = async ($: EngineInterface, index: number) => {
  await touch($)
  await update($, notice, () => null)
  await update($, selected, (current) => (current === index ? null : index))
}

const remove = async ($: EngineInterface, path: string, item: Item) => {
  if (!(await confirmed($, 'delete'))) return
  await rewrite($, path, (text) => deleteItem(text, item))
  await update($, selected, () => null)
}

// The field handlers below close their field; an empty or unchanged entry changes nothing.

// The new item is the last one; the list is read again, as it may have changed since it was drawn.
const add = async ($: EngineInterface, path: string, entry: string) => {
  await touch($)
  if (entry.trim() !== '') {
    await rewrite($, path, (text) => addItem(text, entry))
    const count = (await read($, list))?.items.length ?? 0
    if (count > 0) await update($, selected, () => count - 1)
  }
  await update($, mode, () => 'view')
}

const rename = async ($: EngineInterface, path: string, item: Item, entry: string) => {
  await touch($)
  if (entry.trim() !== '' && entry.trim() !== item.title) {
    await rewrite($, path, (text) => renameItem(text, item, entry))
  }
  await update($, mode, () => 'view')
}

// Unlike a title, an emptied summary line is removed.
const changeLine = async (
  $: EngineInterface,
  path: string,
  item: Item,
  index: number,
  entry: string,
) => {
  await touch($)
  if (entry.trim() !== item.summary[index]) {
    await rewrite($, path, (text) => editSummary(text, item, index, entry))
  }
  await update($, mode, () => 'view')
}

const create = async ($: EngineInterface, title: string) => {
  await touch($)
  await update($, mode, () => 'view')
  const trimmed = title.trim()
  if (trimmed === '') return

  const name = fileName(trimmed)
  const path = `${await todoDir($)}/${name}`
  if (await $.fs.exists(path)) {
    await update($, notice, () => `${name} exists already.`)
    return
  }
  await $.fs.write(path, `# ${trimmed}\n\n`)
  await activate($, name)
}

const activate = async ($: EngineInterface, name: string) => {
  await touch($)
  await update($, projects, () => null)
  await update($, selected, () => null)
  await setActive($, name)
}

// Moves the active list to .todo/archive/; the newest list left becomes the active one.
const archive = async ($: EngineInterface, name: string) => {
  if (!(await confirmed($, 'archive'))) return

  const root = await $.session.root()
  const target = `.todo/archive/${name}`
  if (await $.fs.exists(`${root}/${target}`)) {
    await update($, notice, () => `${target} exists already.`)
    return
  }

  for (const argv of moveCommands(root, `.todo/${name}`, target, '.todo/archive')) {
    const { exitCode, stderr } = await $.process.run(argv, { cwd: root })
    if (exitCode !== 0) {
      await update($, notice, () => `Could not archive ${name}: ${stderr.trim() || exitCode}`)
      return
    }
  }

  await setActive($, '')
  const left = await readProjects($)
  await update($, projects, () => left)
}

const toggleProjects = async ($: EngineInterface) => {
  await touch($)
  await update($, notice, () => null)
  const isOpen = (await read($, projects)) !== null
  const next = isOpen ? null : await readProjects($)
  await update($, projects, () => next)
}

const FIELD: Record<Field, string> = {
  add: 'new-item',
  edit: 'edit-item',
  line: 'summary-line',
  project: 'new-project',
}

const openField = async ($: EngineInterface, field: Field) => {
  await touch($)
  await update($, mode, () => field)
  // Moving the ring is a convenience: without it the field still takes a click or Tab.
  await $.ui.focus({ requestId: PANE, key: FIELD[field] }).catch(() => undefined)
}

const openLine = async ($: EngineInterface, index: number) => {
  await update($, line, () => index)
  await openField($, 'line')
}

// The element a cancelled field hands the ring back to.
const returnTo = async ($: EngineInterface, field: Field) => {
  if (field === 'line') return `summary-${await read($, line)}`
  if (field === 'project') return 'new'
  const index = await read($, selected)
  const item = index === null ? undefined : (await read($, list))?.items[index]
  return field === 'edit' && item ? 'title' : 'add'
}

// Escape handed the keys back to the prompt: opening the pane again takes them back.
const refocus = async ($: EngineInterface, key: string) => {
  await $.ui.open(PANE_OPEN)
  await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
}

// Escape leaves an open field, then a pending second press, then the projects; false when there is
// nothing left to leave and the pane should close.
const stepBack = async ($: EngineInterface) => {
  const field = await read($, mode)
  const waiting = await read($, pending)

  if (field !== 'view') {
    await touch($)
    await update($, mode, () => 'view')
    await refocus($, await returnTo($, field))
  } else if (waiting !== null) {
    await touch($)
    await refocus($, waiting)
  } else if ((await read($, projects)) !== null) {
    await toggleProjects($)
    await refocus($, 'projects')
  } else {
    return false
  }
  return true
}

// The pane's buttons and fields bound to this session; `path` is the drawn list's.
const actionsFor = ($: EngineInterface, path: string): Actions => ({
  select: (index) => select($, index),
  changeStatus: (item: Item, status: Status) =>
    rewrite($, path, (text) => setStatus(text, item, status)),
  remove: (item) => remove($, path, item),
  add: (entry) => add($, path, entry),
  rename: (item, entry) => rename($, path, item, entry),
  changeLine: (item, index, entry) => changeLine($, path, item, index, entry),
  openField: (field) => openField($, field),
  openLine: (index) => openLine($, index),
  toggleProjects: () => toggleProjects($),
  activate: (name) => activate($, name),
  create: (title) => create($, title),
  archive: (name) => archive($, name),
})

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todo', description: 'Show the todo list' })
    await load($, true)
    $.clock.every(POLL_MS, () => void load($))
    $.clock.every(IDLE_CHECK_MS, () => void closeWhenIdle($))
    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($) => {
    await openPane($)
    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) =>
    e.origin.kind === 'person' && (await stepBack($)) ? { value: undefined } : next(e),
  ).catch(pass)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const todos = await read($, list)
    const view = {
      todos,
      projects: await read($, projects),
      selected: await read($, selected),
      mode: await read($, mode),
      line: await read($, line),
      pending: await read($, pending),
      notice: await read($, notice),
    }
    return drawPane($.ui.resolve(e), view, actionsFor($, todos?.path ?? ''))
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const current = summarize((await read($, list))?.items ?? [])
    if (current === null) return next(e)

    const tail = e.props.tail ? `${e.props.tail}  ${label(current)}` : label(current)
    return next({ ...e, props: { ...e.props, tail } })
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'clautodo:rules', text: RULES, scope: 'session' }] }
  })

  on('tool.call', { tool: 'TodoWrite' }, disable).catch(pass)
  on('tool.call', { tool: 'TaskCreate' }, disable).catch(pass)
  on('tool.call', { tool: 'TaskUpdate' }, disable).catch(pass)
  on('tool.call', { tool: 'TaskGet' }, disable).catch(pass)
  on('tool.call', { tool: 'TaskList' }, disable).catch(pass)

  on('tool.call', { tool: 'Edit' }, async ($, e, next) =>
    checkFormat($, e.file_path, await next(e)),
  ).catch(pass)
  on('tool.call', { tool: 'Write' }, async ($, e, next) =>
    checkFormat($, e.file_path, await next(e)),
  ).catch(pass)
}
