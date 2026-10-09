import type { Item, Status, Summary } from '../types'

const MARKS: Record<string, Status> = { ' ': 'open', '~': 'running', x: 'done', X: 'done' }

const MARK_OF: Record<Status, string> = { open: ' ', running: '~', done: 'x' }

// Only unindented items count, indented lines are an item's summary.
const ITEM = /^- \[([ ~xX])\] (.+)$/

const HEADING = /^# (.+)$/

export const parse = (text: string): { title?: string; items: Item[] } => {
  const items: Item[] = []
  let title: string | undefined
  // The item whose summary the following indented lines extend.
  let current: Item | undefined

  text.split('\n').forEach((raw, line) => {
    const trimmed = raw.trimEnd()
    const match = ITEM.exec(trimmed)
    const status = match && MARKS[match[1] ?? '']
    const heading = HEADING.exec(trimmed)

    if (match && status) {
      current = { title: match[2]!.trim(), status, summary: [], line }
      items.push(current)
    } else if (current && /^\s+\S/.test(raw)) {
      current.summary.push(raw.trim())
    } else if (trimmed !== '') {
      current = undefined
      title ??= heading?.[1]?.trim()
    }
  })

  return { title, items }
}

// Rewrites one item's mark; null when the line no longer holds that item.
export const setStatus = (text: string, item: Item, status: Status): string | null => {
  const lines = text.split('\n')
  const match = ITEM.exec(lines[item.line]?.trimEnd() ?? '')
  if (!match || match[2]!.trim() !== item.title) return null

  lines[item.line] = `- [${MARK_OF[status]}] ${match[2]}`
  return lines.join('\n')
}

// Adds an open item right after the last one and its summary, or below the heading without items.
// The first line of `entry` is the title, the rest becomes its indented summary.
export const addItem = (text: string, entry: string): string => {
  const [title = '', ...summary] = entry
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const added = [`- [ ] ${title}`, ...summary.map((line) => `  ${line}`)]
  const lines = text.split('\n')
  const last = lines.findLastIndex((line) => ITEM.test(line.trimEnd()))

  if (last === -1) {
    while (lines.at(-1)?.trim() === '') lines.pop()
    const head = lines.length > 0 ? [...lines, ''] : []
    return [...head, ...added, ''].join('\n')
  }

  let at = last + 1
  while (at < lines.length && (lines[at]!.trim() === '' || /^\s+\S/.test(lines[at]!))) at++
  while (at > last + 1 && lines[at - 1]!.trim() === '') at--

  lines.splice(at, 0, ...added)
  return lines.join('\n')
}

// An unindented line that starts like an item but is not one.
const BROKEN = /^[-*+]\s*\[/

export const problems = (text: string): string[] =>
  text.split('\n').flatMap((line, index) => {
    const isBroken = BROKEN.test(line) && !ITEM.test(line.trimEnd())
    return isBroken ? [`line ${index + 1}: \`${line.trim()}\``] : []
  })

export const summarize = (items: Item[]): Summary | null => {
  if (items.length === 0) return null
  return {
    done: items.filter((item) => item.status === 'done').length,
    total: items.length,
    running: items.find((item) => item.status === 'running')?.title,
  }
}

export const label = ({ done, total, running }: Summary) => {
  const count = `${done === total ? '☑' : '☐'} ${done}/${total}`
  return running ? `${count} · ${running}` : count
}
