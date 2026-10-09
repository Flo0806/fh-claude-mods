export type Status = 'open' | 'running' | 'done'

// `line` is the item's index in the file, so a change can be written back in place.
export type Item = { title: string; status: Status; summary: string[]; line: number }

export type TodoList = { path: string; title?: string; items: Item[] }

// Which field the pane shows, if any: to add an item, edit its title or one line of its summary,
// or name a new project.
export type Mode = 'view' | 'add' | 'edit' | 'line' | 'project'

export type Summary = { done: number; total: number; running?: string }

// One list in .todo/ as the project view shows it.
export type Project = { name: string; title?: string; done: number; total: number }

declare module 'claude-code' {
  interface PluginState {
    clautodo: {
      list: TodoList | null
      selected: number | null
      mode: Mode
      notice: string | null
      line: number | null
      confirming: boolean
      // The lists the project view shows; null while it is closed.
      projects: Project[] | null
    }
  }
}
