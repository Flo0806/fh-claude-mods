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

const DAY_MS = 24 * 60 * 60 * 1000

const pad = (n: number) => String(n).padStart(2, '0')

// Within a day the clock time is precise enough, further out the weekday is.
const resetLabel = (iso: string, now: number) => {
  const at = new Date(iso)
  return at.getTime() - now < DAY_MS
    ? `${pad(at.getHours())}:${pad(at.getMinutes())}`
    : at.toLocaleDateString(undefined, { weekday: 'short' })
}

const tone = (percent: number) => (percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success')

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

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    // A missing bar draws as an empty placeholder, so the band keeps its shape.
    const segment = (label: string, bar?: Bar) => (
      <Box gap={1}>
        <Text dimColor>{label}</Text>
        {bar ? (
          <Text color={tone(bar.percent)}>
            {meter(bar.percent)} {Math.round(bar.percent)}%
          </Text>
        ) : (
          <Text dimColor>{meter(0)} –</Text>
        )}
        {bar?.resetsAt && <Text dimColor>↻{resetLabel(bar.resetsAt, now)}</Text>}
      </Box>
    )

    // Stack below other plugins' bands instead of replacing them, so ours sits next to the prompt.
    const beneath = await next(e)

    return (
      <Box flexDirection="column">
        {beneath}
        <Box gap={2}>
          {current.fiveHour && segment('5h', current.fiveHour)}
          {current.sevenDay && segment('7d', current.sevenDay)}
          {segment('ctx', current.context)}
        </Box>
      </Box>
    )
  })
}
