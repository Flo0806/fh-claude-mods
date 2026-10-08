import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Summary } from '../types'
import { label, parse, summarize } from './todo'

const summary = atom({ plugin: 'clautodo', key: 'summary' } as const, null)

const POLL_MS = 2000

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

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const current = await read($, summary)
    if (current === null) return next(e)

    const tail = e.props.tail ? `${e.props.tail}  ${label(current)}` : label(current)
    return next({ ...e, props: { ...e.props, tail } })
  })
}
