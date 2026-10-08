import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit, SessionUsage } from 'claude-code'

import type { Bar, Usage } from '../types'

const usage = atom({ plugin: 'clausage', key: 'usage' } as const, null)

const toBar = (limit?: SessionRateLimit): Bar | undefined =>
  limit && { percent: limit.percentUsed, resetsAt: limit.resetsAt }

// Fall back to tokens/window when the engine reports no percentage.
const contextBar = ({ percent, tokens, window }: SessionContextUsage): Bar | undefined => {
  if (percent !== undefined) return { percent }
  if (tokens !== undefined && window > 0) return { percent: (tokens / window) * 100 }
  return undefined
}

const toUsage = ({ rateLimits, context }: Pick<SessionUsage, 'rateLimits' | 'context'>): Usage => ({
  fiveHour: toBar(rateLimits.find((r) => r.kind === 'five_hour')),
  sevenDay: toBar(rateLimits.find((r) => r.kind === 'seven_day')),
  context: contextBar(context),
})

const WIDTH = 8

const meter = (percent: number) => {
  const filled = Math.round((Math.min(percent, 100) / 100) * WIDTH)
  return '▰'.repeat(filled) + '▱'.repeat(WIDTH - filled)
}

// A missing bar draws as an empty placeholder, so the band keeps its shape.
const segment = (label: string, bar?: Bar) =>
  bar ? `${label} ${meter(bar.percent)} ${Math.round(bar.percent)}%` : `${label} ${meter(0)} –`

export const register: Register = (on) => {
  // Seed right away, so the band shows after a start or reload without waiting for a turn.
  on('session.start', async ($, e, next) => {
    const now = toUsage(await $.session.usage())
    await update($, usage, () => now)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const measured = toUsage(e)
    await update($, usage, () => measured)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, usage)
    if (e.props.hasSurvey || current === null) {
      return next(e)
    }

    const line = [
      current.fiveHour && segment('5h', current.fiveHour),
      current.sevenDay && segment('7d', current.sevenDay),
      segment('ctx', current.context),
    ]
      .filter(Boolean)
      .join(' · ')

    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{line}</Text>
  })
}
