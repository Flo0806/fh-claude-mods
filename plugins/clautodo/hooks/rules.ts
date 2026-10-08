export const RULES = `# Todo list (clautodo)

Keep the todo list in \`.todo/<project>.md\` at the project root; the most recently changed file there is the active list. The built-in todo tools (TodoWrite, TaskCreate, TaskUpdate, TaskGet, TaskList) are disabled in this session.

- When a task takes more than a few steps and no list fits it, do not create one on your own: propose the steps in chat, discuss the approach with the user, and write the file only once they agreed.
- Format: a \`# Title\` line, then one unindented item per line: \`- [ ]\` open, \`- [~]\` running, \`- [x]\` done. Indented lines under an item are its summary.
- Mark an item \`[~]\` when you start it and \`[x]\` when it is done, with a short summary indented below it.
- The user edits the list too: read it before editing and change only what your work requires.`

export const DISABLED =
  'clautodo: the built-in todo list is disabled here. Keep the todo list in .todo/<project>.md as the clautodo section of the system prompt describes.'
