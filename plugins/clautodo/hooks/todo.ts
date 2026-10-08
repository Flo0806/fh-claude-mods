import type { Item, Status, Summary } from '../types'

const MARKS: Record<string, Status> = { ' ': 'open', '~': 'running', x: 'done', X: 'done' }

// Only unindented items count, indented lines are an item's summary.
const ITEM = /^- \[([ ~xX])\] (.+)$/

export const parse = (text: string): Item[] =>
  text.split('\n').flatMap((line) => {
    const match = ITEM.exec(line.trimEnd())
    const status = match && MARKS[match[1] ?? '']
    return match && status ? [{ title: match[2]!.trim(), status }] : []
  })

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
