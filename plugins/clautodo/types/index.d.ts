export type Status = 'open' | 'running' | 'done'

// `line` is the item's index in the file, so a change can be written back in place.
export type Item = { title: string; status: Status; summary: string[]; line: number }

export type TodoList = { path: string; title?: string; items: Item[] }

export type Summary = { done: number; total: number; running?: string }

declare module 'claude-code' {
  interface PluginState {
    clautodo: { list: TodoList | null; selected: number | null }
  }
}
