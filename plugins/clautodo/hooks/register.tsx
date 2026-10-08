import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Summary } from '../types'
import { DISABLED, RULES } from './rules'
import { label, parse, problems, summarize } from './todo'

const summary = atom({ plugin: 'clautodo', key: 'summary' } as const, null)

const POLL_MS = 2000

const TODO_FILE = /(^|\/)\.todo\/[^/]+\.md$/

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

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const dir = `${await $.session.root()}/.todo`
    let seen = ''

    const refresh = async () => {
      const entry = await newestList($, dir)
      const stamp = entry ? `${entry.name}:${entry.mtimeMs}` : ''
      if (stamp === seen) return
      seen = stamp

      const text = entry ? await $.fs.read(`${dir}/${entry.name}`).catch(() => '') : ''
      const latest: Summary | null = summarize(parse(String(text)))
      await update($, summary, () => latest)
    }

    await refresh()
    $.clock.every(POLL_MS, () => void refresh())
    return next(e)
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
    const current = await read($, summary)
    if (current === null) return next(e)

    const tail = e.props.tail ? `${e.props.tail}  ${label(current)}` : label(current)
    return next({ ...e, props: { ...e.props, tail } })
  })
}
