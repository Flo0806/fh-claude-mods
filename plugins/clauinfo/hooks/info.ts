import type { Color } from 'claude-code'

import type { Info } from '../types'

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const
type Family = (typeof FAMILIES)[number]

export type Model = { family?: Family; version?: string; name: string }

// Reads `claude-opus-5-5`, `opus[1m]` or `Opus 5.5` alike; an unknown model keeps its own name.
export const parseModel = (raw: string): Model => {
  const lower = raw.toLowerCase()
  const family = FAMILIES.find((f) => lower.includes(f))
  if (!family) return { name: raw }
  const digits = lower
    .slice(lower.indexOf(family) + family.length)
    .match(/^[-\s]*(\d+)(?:[-.](\d+))?/)
  const version = digits?.[1] && (digits[2] ? `${digits[1]}.${digits[2]}` : digits[1])
  const name = family[0]!.toUpperCase() + family.slice(1)
  return { family, version, name: version ? `${name} ${version}` : name }
}

// Same model when the family matches and neither names a different version: `opus` and `claude-opus-5-5` agree.
export const sameModel = (a: string, b: string) => {
  const x = parseModel(a)
  const y = parseModel(b)
  if (!x.family || !y.family) return a === b
  return x.family === y.family && (!x.version || !y.version || x.version === y.version)
}

// Fable stands out, Opus is the everyday one, Haiku the small one worth noticing.
export const modelLook = (family?: Family): { color?: Color; bold?: boolean } => {
  switch (family) {
    case 'fable':
      return { color: 'claude', bold: true }
    case 'sonnet':
      return { color: 'suggestion' }
    case 'haiku':
      return { color: 'warning' }
    default:
      return { color: 'text' }
  }
}

// Low and medium recede, high is bright, everything above warns.
export const effortLook = (
  effort: string,
): { color?: Color; bold?: boolean; dimColor?: boolean } => {
  switch (effort) {
    case 'low':
    case 'medium':
      return { dimColor: true }
    case 'high':
      return { color: 'text', bold: true }
    case 'xhigh':
      return { color: 'warning', bold: true }
    case 'max':
      return { color: 'error', bold: true }
    default:
      return { dimColor: true }
  }
}

export const label = ({ model, effort }: Info) =>
  effort === null ? parseModel(model).name : `${parseModel(model).name} · ${effort ?? '?'}`

// The effort saved for a model: its own entry under modelSettings, else the global effortLevel.
export const savedEffort = (settings: Readonly<Record<string, unknown>>, model: string) => {
  const perModel = settings.modelSettings
  if (perModel && typeof perModel === 'object') {
    for (const [id, entry] of Object.entries(perModel)) {
      const level = (entry as { effortLevel?: unknown } | null)?.effortLevel
      if (typeof level === 'string' && sameModel(id, model)) return level
    }
  }
  return typeof settings.effortLevel === 'string' ? settings.effortLevel : undefined
}
