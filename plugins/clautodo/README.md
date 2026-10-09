# clautodo

A project todo list in `.todo/*.md`, its progress shown at the end of the dim hint line under the prompt.

```
? for shortcuts                                    ☐ 3/10 · Adapt the tests
```

## Format

```markdown
# Nuxt migration

- [x] Switch the router
      Summary of what was done.
- [~] Adapt the tests
- [ ] Update the docs
```

| Mark  | Means   |
| ----- | ------- |
| `[ ]` | open    |
| `[~]` | running |
| `[x]` | done    |

Only unindented items count; indented lines belong to the item above.

## The list

`/todo` opens the list in a pane:

| Key                              | Does                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `1-9`, `Enter`                   | select an item and show its summary, again to deselect       |
| `x`                              | check the selected item off, or reopen it                    |
| `s`                              | mark the selected item as running                            |
| `a`                              | add an item; more lines become its summary                   |
| `↑ ↓`, `Enter` on the title      | edit the title; more lines are added to its summary          |
| `↑ ↓`, `Enter` on a summary line | edit that line; empty removes it, more lines are added below |
| `Esc`                            | cancel an open field, else close                             |

A change is written straight into the file, after reading it again, so an edit made meanwhile is kept.

The pane closes by itself after two minutes without a key press, never while a field is open.

## For Claude

- A short section in the system prompt tells Claude the format and to propose a list in chat first, writing it only once you agreed.
- The built-in todo tools (`TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) are refused in the main conversation; subagents and teammates keep them.
- After Claude edits a `.todo/*.md`, broken item lines are reported back to it right away. A clean edit adds nothing.

## Notes

- The most recently changed `.todo/*.md` is the active list.
- The list is your own working note, so keep `.todo/` out of git, e.g. once in `~/.config/git/ignore`.
- Without a `.todo` folder nothing is shown.

## Install

```
/plugin install clautodo --marketplace Flo0806/fh-claude-mods
```
