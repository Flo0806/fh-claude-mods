export type Status = 'open' | 'running' | 'done'

// `line` is the item's index in the file, so a change can be written back in place.
export type Item = { title: string; status: Status; summary: string[]; line: number }

export type TodoList = { path: string; title?: string; items: Item[] }

// What the pane shows below the list: the selected item, or a field for a new one.
export type Mode = 'view' | 'add'

export type Summary = { done: number; total: number; running?: string }

declare module 'claude-code' {
  interface PluginState {
    clautodo: { list: TodoList | null; selected: number | null; mode: Mode }
  }
}
