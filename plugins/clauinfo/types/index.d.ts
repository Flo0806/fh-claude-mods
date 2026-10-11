// What the band shows: the model as the engine names it and its effort, undefined while unknown
// (no request since a switch), null for a model that takes none.
export type Info = {
  model: string
  effort?: string | null
}

// The last look at the session's model and the effort the settings keep for it.
export type Saved = { model: string; effort?: string }

declare module 'claude-code' {
  interface PluginState {
    clauinfo: { info: Info | null; saved: Saved | null; compacting: boolean }
  }
}
