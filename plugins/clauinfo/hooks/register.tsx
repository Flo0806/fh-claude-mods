import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Info } from '../types'
import { effortLook, label, modelLook, parseModel, sameModel, savedEffort } from './info'

// Everything that takes `$` and every state value lives in this file: the engine follows `$` and
// reads state references only within the module's own file, never across an import.

const info = atom({ plugin: 'clauinfo', key: 'info' } as const, null)
const compacting = atom({ plugin: 'clauinfo', key: 'compacting' } as const, false)

const saved = atom({ plugin: 'clauinfo', key: 'saved' } as const, null)

const POLL_MS = 1000

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Keeps the newest reading and toasts when it says something else than before. A first reading
// toasts too, so every session starts by naming its model.
const show = async ($: EngineInterface, next: Info) => {
  const before = await read($, info)
  await update($, info, () => next)
  const changed =
    before === null ||
    !sameModel(before.model, next.model) ||
    (next.effort !== undefined &&
      before.effort !== next.effort &&
      !(next.effort === null && before.effort === undefined))
  if (changed) $.ui.toast(label(next))
}

// What the session and the settings hold, applied only where it moved since the last look: the
// picker of /model and /effort writes there, while an effort just for this session (max) does not,
// and must not be overwritten by the saved one.
const look = async ($: EngineInterface) => {
  const model = await $.session.model()
  const effort = savedEffort(await $.settings.read({}), model)
  const last = await read($, saved)
  await update($, saved, () => ({ model, effort }))

  const shown = await read($, info)
  if (last === null || shown === null) return show($, { model, effort })
  if (last.model !== model) return show($, { model, effort })
  if (last.effort !== effort && effort !== undefined) return show($, { ...shown, effort })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await look($)
    $.clock.every(POLL_MS, () => void look($))
    return next(e)
  })

  // What a request of the main conversation really sends: a fallback model or a lowered effort
  // shows here, and null for a model that takes none.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort =
        typeof e.effort === 'string' ? e.effort : e.effort === undefined ? null : String(e.effort)
      await show($, { model: e.model, effort })
    }
    return yield* next(e)
  })

  // `/effort max` names the level right away, one the settings never see when it is for this session only.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    const level = e.args.trim().toLowerCase()
    const shown = await read($, info)
    if (e.command === 'effort' && EFFORTS.includes(level) && shown)
      await show($, { ...shown, effort: level })
    else if (e.command === 'model' || e.command === 'effort') await look($)
    return result
  })

  // Step aside while the main conversation compacts, so the engine's progress shows in the band.
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute' || e.agentId !== undefined) return next(e)
    await update($, compacting, () => true)
    try {
      return await next(e)
    } finally {
      await update($, compacting, () => false)
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, info)
    if (e.props.hasSurvey || shown === null || (await read($, compacting))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const model = parseModel(shown.model)

    // Stack below other plugins' bands instead of replacing them.
    const beneath = await next(e)

    return (
      <Box flexDirection="column">
        {beneath}
        <Box gap={1}>
          <Text {...modelLook(model.family)}>{model.name}</Text>
          {shown.effort !== null && <Text dimColor>·</Text>}
          {shown.effort === undefined && <Text dimColor>?</Text>}
          {shown.effort && <Text {...effortLook(shown.effort)}>{shown.effort}</Text>}
        </Box>
      </Box>
    )
  })
}
