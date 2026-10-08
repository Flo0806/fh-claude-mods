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
