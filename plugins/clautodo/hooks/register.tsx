import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Item, Mode, Status, TodoList } from '../types'
import { DISABLED, RULES } from './rules'
import {
  addItem,
  deleteItem,
  editSummary,
  label,
  parse,
  problems,
  renameItem,
  setStatus,
  summarize,
} from './todo'

const list = atom({ plugin: 'clautodo', key: 'list' } as const, null)
const selected = atom({ plugin: 'clautodo', key: 'selected' } as const, null)
const mode = atom({ plugin: 'clautodo', key: 'mode' } as const, 'view')
// Shown in the pane, where a toast would wait until it closes.
const notice = atom({ plugin: 'clautodo', key: 'notice' } as const, null)
// The summary line being edited, by its index in the selected item's summary.
const line = atom({ plugin: 'clautodo', key: 'line' } as const, null)
// Whether the delete button waits for a second press.
const confirming = atom({ plugin: 'clautodo', key: 'confirming' } as const, false)

const PANE = 'clautodo'

const PANE_OPEN = { id: PANE, title: 'Todo', focus: true, closeOnEscape: true } as const

const POLL_MS = 2000

// The pane closes by itself after this long without a press or an open field.
const IDLE_MS = 2 * 60 * 1000

const IDLE_CHECK_MS = 15 * 1000

const TODO_FILE = /(^|\/)\.todo\/[^/]+\.md$/

const GLYPH: Record<Status, string> = { open: '○', running: '◐', done: '●' }

const COLOR: Record<Status, string | undefined> = {
  open: undefined,
  running: 'warning',
  done: 'success',
}

// Tells the model right after its edit when it left a todo line the mod cannot read.
const checkFormat = async (
  $: EngineInterface,
  path: string,
  ran: ToolCallResult,
): Promise<ToolCallResult> => {
  if (!TODO_FILE.test(path) || ran.deny !== undefined || ran.isError) return ran

  const found = problems(String(await $.fs.read(path).catch(() => '')))
  if (found.length === 0) return ran

  const note = `clautodo: ${path} has lines that are not valid todo items (use \`- [ ]\`, \`- [~]\` or \`- [x]\`):\n${found.join('\n')}`
  return { ...ran, context: [...(ran.context ?? []), note] }
}

// Subagents and teammates keep the built-in list, a team coordinates over it.
function disable<E extends { agentId?: string }, R>(_$: unknown, e: E, next: (e: E) => R) {
  return e.agentId === undefined ? { deny: DISABLED } : next(e)
}

// A failing hook lets the call through rather than blocking the session.
function pass<E, R>(_$: unknown, e: E, next: (e: E) => R) {
  return next(e)
}

const ACTIVE = '.active'

// The name in .todo/.active and the mtime it was read at, so a poll reads it only after a change.
let pointer = { mtimeMs: -1, name: '' }

// The list named in .todo/.active, or the most recently changed one without a valid name there.
const activeList = async ($: EngineInterface, dir: string) => {
  const entries = await $.fs.list(dir).catch(() => [])
  const lists = entries.filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md'))
  const marker = entries.find((entry) => entry.kind === 'file' && entry.name === ACTIVE)

  if (marker && marker.mtimeMs !== pointer.mtimeMs) {
    const name = String(await $.fs.read(`${dir}/${ACTIVE}`).catch(() => '')).trim()
    pointer = { mtimeMs: marker.mtimeMs, name }
  }
  const named = marker && lists.find((entry) => entry.name === pointer.name)
  return named ?? lists.toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0]
}

// Name and mtime of the list last read, so a poll reads the file only after it changed.
let seen = ''

const load = async ($: EngineInterface, force = false) => {
  const dir = `${await $.session.root()}/.todo`
  const entry = await activeList($, dir)
  const stamp = entry ? `${entry.name}:${entry.mtimeMs}` : ''
  if (stamp === seen && !force) return
  seen = stamp

  const path = entry && `${dir}/${entry.name}`
  const text = path ? String(await $.fs.read(path).catch(() => '')) : ''
  const latest: TodoList | null = path ? { path, ...parse(text) } : null
  await update($, list, () => latest)
}

// When the person last did something in the pane.
let lastActivity = 0

// Any action but a second delete press drops a pending delete.
const touch = async ($: EngineInterface) => {
  lastActivity = await $.clock.now()
  await update($, confirming, () => false)
}

const select = async ($: EngineInterface, index: number) => {
  await touch($)
  await update($, notice, () => null)
  await update($, selected, (current) => (current === index ? null : index))
}

// An open field counts as activity, so typing is never cut off.
const closeWhenIdle = async ($: EngineInterface) => {
  const isOpen = (await $.ui.panes()).some((pane) => pane.id === PANE)
  const isIdle = (await $.clock.now()) - lastActivity >= IDLE_MS
  if (isOpen && isIdle && (await read($, mode)) === 'view') await $.ui.close({ id: PANE })
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

// The first press asks, the second deletes the item with its summary.
const remove = async ($: EngineInterface, path: string, item: Item) => {
  const isConfirmed = await read($, confirming)
  await touch($)
  if (!isConfirmed) {
    await update($, confirming, () => true)
    return
  }
  await rewrite($, path, (text) => deleteItem(text, item))
  await update($, selected, () => null)
}

const changeStatus = ($: EngineInterface, path: string, item: Item, status: Status) =>
  rewrite($, path, (text) => setStatus(text, item, status))

// An empty title just closes the field.
const add = async ($: EngineInterface, path: string, count: number, title: string) => {
  await touch($)
  const trimmed = title.trim()
  if (trimmed !== '') {
    await rewrite($, path, (text) => addItem(text, trimmed))
    await update($, selected, () => count)
  }
  await update($, mode, () => 'view')
}

// An empty or unchanged title just closes the field.
const rename = async ($: EngineInterface, path: string, item: Item, entry: string) => {
  await touch($)
  if (entry.trim() !== '' && entry.trim() !== item.title) {
    await rewrite($, path, (text) => renameItem(text, item, entry))
  }
  await update($, mode, () => 'view')
}

// An unchanged line just closes the field, an empty one removes it.
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

const FIELD: Record<Exclude<Mode, 'view'>, string> = {
  add: 'new-item',
  edit: 'edit-item',
  line: 'summary-line',
}

const openLine = async ($: EngineInterface, index: number) => {
  await update($, line, () => index)
  await openField($, 'line')
}

// The element a cancelled field hands the ring back to.
const returnTo = async ($: EngineInterface, field: Exclude<Mode, 'view'>) => {
  const index = await read($, selected)
  const item = index === null ? undefined : (await read($, list))?.items[index]
  if (field === 'line') return `summary-${await read($, line)}`
  return field === 'edit' && item ? 'title' : 'add'
}

// Escape handed the keys back to the prompt: opening the pane again takes them back.
const refocus = async ($: EngineInterface, key: string) => {
  await $.ui.open(PANE_OPEN)
  await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
}

const openField = async ($: EngineInterface, next: Exclude<Mode, 'view'>) => {
  await touch($)
  await update($, mode, () => next)
  // Moving the ring is a convenience: without it the field still takes a click or Tab.
  await $.ui.focus({ requestId: PANE, key: FIELD[next] }).catch(() => undefined)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todo', description: 'Show the todo list' })
    await load($, true)
    $.clock.every(POLL_MS, () => void load($))
    $.clock.every(IDLE_CHECK_MS, () => void closeWhenIdle($))
    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($) => {
    await load($, true)
    await update($, selected, () => null)
    await update($, mode, () => 'view')
    await update($, notice, () => null)
    await touch($)
    await $.ui.open(PANE_OPEN)
    return {}
  })

  // Escape with a field open or a delete pending cancels that and keeps the pane; the next one
  // closes it.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const field = await read($, mode)
    const isAsking = await read($, confirming)
    if (e.origin.kind !== 'person' || (field === 'view' && !isAsking)) return next(e)
    await touch($)
    await update($, mode, () => 'view')
    await refocus($, field === 'view' ? 'delete' : await returnTo($, field))
    return { value: undefined }
  }).catch(pass)

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

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const current = summarize((await read($, list))?.items ?? [])
    if (current === null) return next(e)

    const tail = e.props.tail ? `${e.props.tail}  ${label(current)}` : label(current)
    return next({ ...e, props: { ...e.props, tail } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // Mobile has no text field, so it cannot add items.
    const Input = 'Input' in elements ? elements.Input : undefined
    const todos = await read($, list)

    if (todos === null || todos.items.length === 0) {
      return <Text dimColor>No todo list in .todo/ yet.</Text>
    }

    const { path, title, items } = todos
    const chosen = await read($, selected)
    const index = chosen !== null && chosen < items.length ? chosen : null
    const item = index === null ? undefined : items[index]
    const shown = await read($, mode)
    const isAsking = (await read($, confirming)) && item !== undefined
    const warning = isAsking
      ? `Delete "${item.title}" and its summary? Press d again.`
      : await read($, notice)
    const isAdding = shown === 'add'
    const isEditing = shown === 'edit' && item !== undefined
    const lineIndex = shown === 'line' ? await read($, line) : null
    const hasField = (isAdding || isEditing || lineIndex !== null) && Input !== undefined

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{title ?? path.split('/').pop()}</Text>

        <Box flexDirection="column">
          {items.map((one, i) => (
            <Button
              key={`item-${one.line}`}
              plain
              hotkey={i < 9 ? String(i + 1) : undefined}
              onPress={() => select($, i)}
            >
              <Text color={COLOR[one.status]}>{GLYPH[one.status]}</Text>{' '}
              <Text
                bold={i === index}
                color={i === index ? 'claude' : undefined}
                dimColor={one.status === 'done' && i !== index}
              >
                {one.title}
              </Text>
            </Button>
          ))}
        </Box>

        {isAdding && Input ? (
          <Input
            key="new-item"
            label="New item"
            placeholder="Title, Enter to add, empty to cancel"
            autoFocus
            onSubmit={(value: string) => add($, path, items.length, value)}
          />
        ) : item ? (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column" borderStyle="round" paddingX={1}>
              {isEditing && Input ? (
                <Input
                  key="edit-item"
                  value={item.title}
                  placeholder="More lines are added to the summary, empty to cancel"
                  autoFocus
                  onSubmit={(value: string) => rename($, path, item, value)}
                />
              ) : Input ? (
                <Button key="title" plain onPress={() => openField($, 'edit')}>
                  <Text bold>{item.title}</Text>
                </Button>
              ) : (
                <Text bold>{item.title}</Text>
              )}
              {item.summary.length > 0 ? (
                item.summary.map((text, j) =>
                  j === lineIndex && Input ? (
                    <Input
                      key="summary-line"
                      value={text}
                      placeholder="Empty removes the line, more lines are added below"
                      autoFocus
                      onSubmit={(value: string) => changeLine($, path, item, j, value)}
                    />
                  ) : Input ? (
                    <Button key={`summary-${j}`} plain onPress={() => openLine($, j)}>
                      <Text dimColor>{text}</Text>
                    </Button>
                  ) : (
                    <Text dimColor>{text}</Text>
                  ),
                )
              ) : (
                <Text dimColor>No summary.</Text>
              )}
            </Box>
          </Box>
        ) : (
          <Text dimColor>Select an item: 1-9 or Enter</Text>
        )}

        {warning && <Text color="warning">{warning}</Text>}

        {!hasField && (
          <Box gap={2}>
            {item && (
              <Button
                key="done"
                hotkey="x"
                label={item.status === 'done' ? 'reopen' : 'done'}
                onPress={() =>
                  changeStatus($, path, item, item.status === 'done' ? 'open' : 'done')
                }
              />
            )}
            {item && item.status !== 'running' && (
              <Button
                key="start"
                hotkey="s"
                label="start"
                onPress={() => changeStatus($, path, item, 'running')}
              />
            )}
            {Input && (
              <Button key="add" hotkey="a" label="add" onPress={() => openField($, 'add')} />
            )}
            {item && (
              <Button
                key="delete"
                hotkey="d"
                label={isAsking ? 'confirm' : 'delete'}
                onPress={() => remove($, path, item)}
              />
            )}
          </Box>
        )}
      </Box>
    )
  })
}
