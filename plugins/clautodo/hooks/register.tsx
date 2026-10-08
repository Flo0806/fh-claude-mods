import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Item, Status, TodoList } from '../types'
import { DISABLED, RULES } from './rules'
import { label, parse, problems, setStatus, summarize } from './todo'

const list = atom({ plugin: 'clautodo', key: 'list' } as const, null)
const selected = atom({ plugin: 'clautodo', key: 'selected' } as const, null)

const PANE = 'clautodo'

const POLL_MS = 2000

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

// Until projects can be switched, the most recently changed list is the active one.
const newestList = async ($: EngineInterface, dir: string) => {
  const entries = await $.fs.list(dir).catch(() => [])
  return entries
    .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md'))
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0]
}

// Name and mtime of the list last read, so a poll reads the file only after it changed.
let seen = ''

const load = async ($: EngineInterface, force = false) => {
  const dir = `${await $.session.root()}/.todo`
  const entry = await newestList($, dir)
  const stamp = entry ? `${entry.name}:${entry.mtimeMs}` : ''
  if (stamp === seen && !force) return
  seen = stamp

  const path = entry && `${dir}/${entry.name}`
  const text = path ? String(await $.fs.read(path).catch(() => '')) : ''
  const latest: TodoList | null = path ? { path, ...parse(text) } : null
  await update($, list, () => latest)
}

// Reads the file again before writing, so an edit made meanwhile is kept.
const changeStatus = async ($: EngineInterface, path: string, item: Item, status: Status) => {
  const changed = setStatus(String(await $.fs.read(path)), item, status)
  if (changed === null) {
    $.ui.toast('The list changed meanwhile, try again.')
  } else {
    await $.fs.write(path, changed)
  }
  await load($, true)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todo', description: 'Show the todo list' })
    await load($, true)
    $.clock.every(POLL_MS, () => void load($))
    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($) => {
    await load($, true)
    await update($, selected, () => null)
    await $.ui.open({ id: PANE, title: 'Todo', focus: true, closeOnEscape: true })
    return {}
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

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const current = summarize((await read($, list))?.items ?? [])
    if (current === null) return next(e)

    const tail = e.props.tail ? `${e.props.tail}  ${label(current)}` : label(current)
    return next({ ...e, props: { ...e.props, tail } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const todos = await read($, list)

    if (todos === null || todos.items.length === 0) {
      return <Text dimColor>No todo list in .todo/ yet.</Text>
    }

    const { path, title, items } = todos
    const chosen = await read($, selected)
    const index = chosen !== null && chosen < items.length ? chosen : null
    const item = index === null ? undefined : items[index]

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{title ?? path.split('/').pop()}</Text>

        <Box flexDirection="column">
          {items.map((one, i) => (
            <Button
              key={`item-${one.line}`}
              plain
              hotkey={i < 9 ? String(i + 1) : undefined}
              onPress={() => update($, selected, (current) => (current === i ? null : i))}
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

        {item ? (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column" borderStyle="round" paddingX={1}>
              <Text bold>{item.title}</Text>
              {item.summary.length > 0 ? (
                item.summary.map((line) => <Text dimColor>{line}</Text>)
              ) : (
                <Text dimColor>No summary.</Text>
              )}
            </Box>

            <Box gap={2}>
              <Button
                key="done"
                hotkey="x"
                label={item.status === 'done' ? 'reopen' : 'done'}
                onPress={() =>
                  changeStatus($, path, item, item.status === 'done' ? 'open' : 'done')
                }
              />
              {item.status !== 'running' && (
                <Button
                  key="start"
                  hotkey="s"
                  label="start"
                  onPress={() => changeStatus($, path, item, 'running')}
                />
              )}
            </Box>
          </Box>
        ) : (
          <Text dimColor>Select an item: 1-9 or Enter</Text>
        )}
      </Box>
    )
  })
}
