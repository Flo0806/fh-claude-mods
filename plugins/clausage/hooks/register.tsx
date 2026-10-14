import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionRateLimit,
  SessionUsage,
} from 'claude-code'

import type { Bar, Usage } from '../types'

const usage = atom({ plugin: 'clausage', key: 'usage' } as const, null)
const compacting = atom({ plugin: 'clausage', key: 'compacting' } as const, false)

const toBar = (limit?: SessionRateLimit): Bar | undefined =>
  limit && { percent: limit.percentUsed, resetsAt: limit.resetsAt }

// Fall back to tokens/window when the engine reports no percentage.
const contextBar = ({ percent, tokens, window }: SessionContextUsage): Bar | undefined => {
  if (percent !== undefined) return { percent }
  if (tokens !== undefined && window > 0) return { percent: (tokens / window) * 100 }
  return undefined
}

// Without a measurement (right after a compaction) estimate the fill the way /context does, against
// the same window the status line measures. Only a read that asked for the breakdown has one.
const estimatedBar = ({ breakdown, window }: SessionContextUsage): Bar | undefined =>
  breakdown && window > 0 ? { percent: (breakdown.totalTokens / window) * 100 } : undefined

const toUsage = ({ rateLimits, context }: Pick<SessionUsage, 'rateLimits' | 'context'>): Usage => ({
  fiveHour: toBar(rateLimits.find((r) => r.kind === 'five_hour')),
  sevenDay: toBar(rateLimits.find((r) => r.kind === 'seven_day')),
  context: contextBar(context) ?? estimatedBar(context),
})

// Reads the usage once the compacted conversation stands, then brings the band back.
const settle = async ($: EngineInterface) => {
  try {
    const now = await $.session.usage({ breakdown: 'summary' })
    const settled = toUsage(now)
    await update($, usage, () => settled)
  } finally {
    await update($, compacting, () => false)
  }
}

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
    // A reload while the band waits for a compaction's figures drops that wait: show the band again.
    await update($, compacting, () => false)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const measured = toUsage(e)
    await update($, usage, () => measured)
    return next(e)
  })

  // Step aside while the main conversation compacts, so the engine's progress shows in the band.
  // The engine puts the compacted conversation in place only once every hook has returned, so a
  // read in here still sees the old fill: read it right after, with the band aside until then.
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute' || e.agentId !== undefined) return next(e)

    await update($, compacting, () => true)
    try {
      const result = await next(e)
      if (result.skip !== undefined) {
        await update($, compacting, () => false)
        return result
      }
      $.clock.after(0, () => void settle($))
      return result
    } catch (error) {
      await update($, compacting, () => false)
      throw error
    }
  })

  // A /clear starts the conversation over, so the old context fill no longer applies.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, usage, (current) => current && { ...current, context: undefined })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, usage)
    if (e.props.hasSurvey || current === null || (await read($, compacting))) {
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
        {bar?.resetsAt && <Text dimColor>↻ {resetLabel(bar.resetsAt, now)}</Text>}
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
