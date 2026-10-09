import type { Elements, RenderSurface } from 'claude-code'

import type { Item, Mode, Project, Status, TodoList } from '../types'

type Ui = Elements[RenderSurface]

export type View = {
  todos: TodoList | null
  projects: Project[] | null
  selected: number | null
  mode: Mode
  line: number | null
  pending: 'delete' | 'archive' | null
  notice: string | null
}

export type Actions = {
  select: (index: number) => Promise<void>
  changeStatus: (item: Item, status: Status) => Promise<void>
  remove: (item: Item) => Promise<void>
  add: (entry: string) => Promise<void>
  rename: (item: Item, entry: string) => Promise<void>
  changeLine: (item: Item, index: number, entry: string) => Promise<void>
  openField: (field: Exclude<Mode, 'view'>) => Promise<void>
  openLine: (index: number) => Promise<void>
  toggleProjects: () => Promise<void>
  activate: (name: string) => Promise<void>
  create: (title: string) => Promise<void>
  archive: (name: string) => Promise<void>
}

const GLYPH: Record<Status, string> = { open: '○', running: '◐', done: '●' }

const COLOR: Record<Status, string | undefined> = {
  open: undefined,
  running: 'warning',
  done: 'success',
}

export const drawPane = (ui: Ui, view: View, act: Actions) =>
  view.projects ? drawProjects(ui, view, view.projects, act) : drawItems(ui, view, act)

const switchButton = ({ Button }: Ui, isProjects: boolean, act: Actions) => (
  <Button
    key="projects"
    plain
    hotkey="p"
    label={isProjects ? 'items' : 'projects'}
    onPress={act.toggleProjects}
  />
)

// Mobile has no text field, so nothing can be typed there.
const inputOf = (ui: Ui) => ('Input' in ui ? ui.Input : undefined)

const drawProjects = (ui: Ui, view: View, shown: Project[], act: Actions) => {
  const { Box, Button, Text } = ui
  const Input = inputOf(ui)
  const active = view.todos?.path.split('/').pop()
  const isArchiving = view.pending === 'archive' && active !== undefined
  const warning = isArchiving
    ? `Archive "${view.todos?.title ?? active}"? Press c again.`
    : view.notice

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Projects</Text>
      <Box flexDirection="column">
        {shown.length === 0 && <Text dimColor>No lists in .todo/ yet.</Text>}
        {shown.map((project, i) => (
          <Button
            key={`project-${project.name}`}
            plain
            hotkey={i < 9 ? String(i + 1) : undefined}
            onPress={() => act.activate(project.name)}
          >
            <Text
              bold={project.name === active}
              color={project.name === active ? 'claude' : undefined}
            >
              {project.title ?? project.name}
            </Text>{' '}
            <Text dimColor>
              {project.done}/{project.total}
            </Text>
          </Button>
        ))}
      </Box>
      {view.mode === 'project' && Input ? (
        <Input
          key="new-project"
          label="New project"
          placeholder="Title, Enter to create, empty to cancel"
          autoFocus
          onSubmit={act.create}
        />
      ) : (
        <Box flexDirection="column" gap={1}>
          {warning && <Text color="warning">{warning}</Text>}
          <Box gap={2}>
            {switchButton(ui, true, act)}
            {Input && (
              <Button
                key="new"
                plain
                hotkey="n"
                label="new"
                onPress={() => act.openField('project')}
              />
            )}
            {active && (
              <Button
                key="archive"
                plain
                hotkey="c"
                label={isArchiving ? 'confirm' : 'archive'}
                onPress={() => act.archive(active)}
              />
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}

const drawItems = (ui: Ui, view: View, act: Actions) => {
  const { Box, Button, Text } = ui
  const Input = inputOf(ui)
  const { todos } = view

  if (todos === null) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>No todo list in .todo/ yet.</Text>
        <Box gap={2}>{switchButton(ui, false, act)}</Box>
      </Box>
    )
  }

  const { path, title, items } = todos
  const index = view.selected !== null && view.selected < items.length ? view.selected : null
  const item = index === null ? undefined : items[index]
  const isAsking = view.pending === 'delete' && item !== undefined
  const warning = isAsking ? `Delete "${item.title}" and its summary? Press d again.` : view.notice
  const isAdding = view.mode === 'add'
  const isEditing = view.mode === 'edit' && item !== undefined
  const lineIndex = view.mode === 'line' ? view.line : null
  const hasField = (isAdding || isEditing || lineIndex !== null) && Input !== undefined

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{title ?? path.split('/').pop()}</Text>

      <Box flexDirection="column">
        {items.length === 0 && <Text dimColor>No items yet.</Text>}
        {items.map((one, i) => (
          <Button
            key={`item-${one.line}`}
            plain
            hotkey={i < 9 ? String(i + 1) : undefined}
            onPress={() => act.select(i)}
          >
            <Text color={COLOR[one.status]}>{GLYPH[one.status]}</Text>{' '}
            <Text
              bold={i === index}
              color={i === index ? 'claude' : undefined}
              dimColor={one.status === 'done' && i !== index}
            >
              {one.title}
            </Text>
          </Button>
        ))}
      </Box>

      {isAdding && Input ? (
        <Input
          key="new-item"
          label="New item"
          placeholder="Title, Enter to add, empty to cancel"
          autoFocus
          onSubmit={act.add}
        />
      ) : item ? (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          {isEditing && Input ? (
            <Input
              key="edit-item"
              value={item.title}
              placeholder="More lines are added to the summary, empty to cancel"
              autoFocus
              onSubmit={(value: string) => act.rename(item, value)}
            />
          ) : Input ? (
            <Button key="title" plain onPress={() => act.openField('edit')}>
              <Text bold>{item.title}</Text>
            </Button>
          ) : (
            <Text bold>{item.title}</Text>
          )}
          {item.summary.length > 0 ? (
            item.summary.map((text, j) =>
              j === lineIndex && Input ? (
                <Input
                  key="summary-line"
                  value={text}
                  placeholder="Empty removes the line, more lines are added below"
                  autoFocus
                  onSubmit={(value: string) => act.changeLine(item, j, value)}
                />
              ) : Input ? (
                <Button key={`summary-${j}`} plain onPress={() => act.openLine(j)}>
                  <Text dimColor>{text}</Text>
                </Button>
              ) : (
                <Text dimColor>{text}</Text>
              ),
            )
          ) : (
            <Text dimColor>No summary.</Text>
          )}
        </Box>
      ) : (
        items.length > 0 && <Text dimColor>Select an item: 1-9 or Enter</Text>
      )}

      {warning && <Text color="warning">{warning}</Text>}

      {!hasField && (
        <Box gap={2}>
          {item && (
            <Button
              key="done"
              plain
              hotkey="x"
              label={item.status === 'done' ? 'reopen' : 'done'}
              onPress={() => act.changeStatus(item, item.status === 'done' ? 'open' : 'done')}
            />
          )}
          {item && item.status !== 'running' && (
            <Button
              key="start"
              plain
              hotkey="s"
              label="start"
              onPress={() => act.changeStatus(item, 'running')}
            />
          )}
          {Input && (
            <Button key="add" plain hotkey="a" label="add" onPress={() => act.openField('add')} />
          )}
          {switchButton(ui, false, act)}
          {item && (
            <Button
              key="delete"
              plain
              hotkey="d"
              label={isAsking ? 'confirm' : 'delete'}
              onPress={() => act.remove(item)}
            />
          )}
        </Box>
      )}
    </Box>
  )
}
