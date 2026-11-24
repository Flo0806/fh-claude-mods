import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './scene'

// Calm, cool grays tinted toward blue, crisp system-like accents. Dark is its own night version.
const { theme, problems } = makeColors({
  label: 'Flo Code',
  roles: {
    accent: '#0a84ff',
    danger: '#ff453a',
    success: '#30d158',
    warning: '#ff9f0a',
    pro: '#bf5af2',
  },
  light: {
    gray: {
      anchors: {
        'surface-0': '#eceff4',
        'surface-1': '#f4f6f9',
        'surface-2': '#fbfcfd',
        'text-primary': '#1c1c1e',
        'text-secondary': '#3a3a3f',
        'text-muted': '#636369',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#16171b',
        'surface-1': '#1d1e23',
        'surface-2': '#24252b',
        'surface-3': '#2a2b31',
        'text-primary': '#f4f4f7',
        'text-secondary': '#cdcdd3',
        'text-muted': '#a1a1a8',
      },
    },
  },
})

const BUBBLE = { radius: 20, paddingX: 16, paddingY: 10 } as const

const LOOK: ThemeSetArgs = {
  colors: theme,
  // Panels frost over the flowing scene: the liquid part of the look.
  backdrop: { scene: 'flow', glass: { blur: 28, opacity: 0.62 } },
  style: {
    UserMessage: { ...BUBBLE, backgroundColor: 'surface-2' },
    ToolUse: { radius: 12 },
  },
}

const clock = atom({ plugin: 'flo-code', key: 'clock' } as const, '')
const date = atom({ plugin: 'flo-code', key: 'date' } as const, '')

const pad = (n: number) => String(n).padStart(2, '0')

// Only a changed minute writes, so the row redraws once a minute.
const tick = async ($: EngineInterface) => {
  const now = new Date(await $.clock.now())
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  if ((await read($, clock)) === time) return
  const day = now.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
  await update($, clock, () => time)
  await update($, date, () => day)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    // While building: the line that would stop Desktop painting the whole look.
    const unpainted = problems.find((line) => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) $.ui.toast(unpainted)

    try {
      await $.theme.set(LOOK)
    } catch (error) {
      // An older build refuses `style`: keep the colors and the scene.
      $.ui.log(String(error))
      await $.theme.set({ colors: LOOK.colors, backdrop: LOOK.backdrop })
    }

    await tick($)
    $.clock.every(5_000, () => void tick($))
    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.props.plugin !== 'flo-code' || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    return <Svg source={SCENE} alt="Soft color fields drifting slowly" isInteractive />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const time = await read($, clock)
    if (e.props.hasSurvey || time === '') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Text bold>{time}</Text>
        <Text dimColor>{await read($, date)}</Text>
      </Box>
    )
  })
}
