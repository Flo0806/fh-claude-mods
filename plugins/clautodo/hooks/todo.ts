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

// The item's line split into mark and title; null when the line no longer holds that item.
const itemAt = (lines: string[], item: Item) => {
  const match = ITEM.exec(lines[item.line]?.trimEnd() ?? '')
  return match && match[2]!.trim() === item.title ? { mark: match[1]!, title: match[2]! } : null
}

// The first line of an entry is a title, the others its summary; blank lines drop out.
const splitEntry = (entry: string) => {
  const [title = '', ...summary] = entry
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return { title, summary: summary.map((line) => `  ${line}`) }
}

// The index right after an item and its summary, trailing blank lines left out.
const blockEnd = (lines: string[], line: number) => {
  let at = line + 1
  while (at < lines.length && (lines[at]!.trim() === '' || /^\s+\S/.test(lines[at]!))) at++
  while (at > line + 1 && lines[at - 1]!.trim() === '') at--
  return at
}

export const setStatus = (text: string, item: Item, status: Status): string | null => {
  const lines = text.split('\n')
  const found = itemAt(lines, item)
  if (!found) return null

  lines[item.line] = `- [${MARK_OF[status]}] ${found.title}`
  return lines.join('\n')
}

// Keeps the mark; further lines of `entry` are added to the end of the summary.
export const renameItem = (text: string, item: Item, entry: string): string | null => {
  const lines = text.split('\n')
  const found = itemAt(lines, item)
  const { title, summary } = splitEntry(entry)
  if (!found || title === '') return null

  lines.splice(blockEnd(lines, item.line), 0, ...summary)
  lines[item.line] = `- [${found.mark}] ${title}`
  return lines.join('\n')
}

// Removes an item with its summary; null when the line no longer holds that item.
export const deleteItem = (text: string, item: Item): string | null => {
  const lines = text.split('\n')
  if (!itemAt(lines, item)) return null

  lines.splice(item.line, blockEnd(lines, item.line) - item.line)
  return lines.join('\n')
}

// Replaces one summary line, keeping its indent; an empty entry removes it, more lines take its place.
export const editSummary = (
  text: string,
  item: Item,
  index: number,
  entry: string,
): string | null => {
  const lines = text.split('\n')
  if (!itemAt(lines, item)) return null

  const at = summaryLines(lines, item.line)[index]
  if (at === undefined || lines[at]!.trim() !== item.summary[index]) return null

  const indent = /^\s*/.exec(lines[at]!)![0]
  const { title, summary } = splitEntry(entry)
  const replaced = title === '' ? [] : [title, ...summary.map((line) => line.trim())]
  lines.splice(at, 1, ...replaced.map((line) => `${indent}${line}`))
  return lines.join('\n')
}

// The file indices of an item's summary lines, as parse collects them.
const summaryLines = (lines: string[], line: number) => {
  const found: number[] = []
  for (let at = line + 1; at < lines.length; at++) {
    if (/^\s+\S/.test(lines[at]!)) found.push(at)
    else if (lines[at]!.trim() !== '') break
  }
  return found
}

// Adds an open item right after the last one and its summary, or below the heading without items.
// The first line of `entry` is the title, the rest becomes its indented summary.
export const addItem = (text: string, entry: string): string => {
  const { title, summary } = splitEntry(entry)
  const added = [`- [ ] ${title}`, ...summary]
  const lines = text.split('\n')
  const last = lines.findLastIndex((line) => ITEM.test(line.trimEnd()))

  if (last === -1) {
    while (lines.at(-1)?.trim() === '') lines.pop()
    const head = lines.length > 0 ? [...lines, ''] : []
    return [...head, ...added, ''].join('\n')
  }

  lines.splice(blockEnd(lines, last), 0, ...added)
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
