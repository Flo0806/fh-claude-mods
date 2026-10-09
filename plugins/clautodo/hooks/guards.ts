import { DISABLED } from './rules'
import { problems } from './todo'

export const isTodoFile = (path: string) => /(^|\/)\.todo\/[^/]+\.md$/.test(path)

// What the model reads after editing a todo file it left lines in the mod cannot read.
export const formatNote = (path: string, text: string) => {
  const found = problems(text)
  return found.length === 0
    ? undefined
    : `clautodo: ${path} has lines that are not valid todo items (use \`- [ ]\`, \`- [~]\` or \`- [x]\`):\n${found.join('\n')}`
}

// Subagents and teammates keep the built-in list, a team coordinates over it.
export function disable<E extends { agentId?: string }, R>(_$: unknown, e: E, next: (e: E) => R) {
  return e.agentId === undefined ? { deny: DISABLED } : next(e)
}

// A failing hook lets the event through rather than blocking the session.
export function pass<E, R>(_$: unknown, e: E, next: (e: E) => R) {
  return next(e)
}
