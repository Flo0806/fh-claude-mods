# clautodo

A project todo list in `.todo/*.md`, its progress shown at the end of the dim hint line under the prompt.

```
? for shortcuts                                    ☐ 3/10 · Adapt the tests
```

## Format

```text
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

Only unindented items count; indented lines are the summary of the item above.

## The list

`/todo` opens the active list in a pane. Every action shows its key on its button.

| Key                              | Does                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| `1-9`, `Enter`                   | select an item and show its summary, again to deselect                     |
| `x`                              | check the selected item off, or reopen it                                  |
| `s`                              | mark the selected item as running                                          |
| `a`                              | add an item; more lines become its summary                                 |
| `d`                              | delete the selected item with its summary; press again to confirm          |
| `p`                              | show the projects, or back to the items                                    |
| `↑ ↓`, `Enter` on the title      | edit the title; more lines are added to its summary                        |
| `↑ ↓`, `Enter` on a summary line | edit that line; empty removes it, more lines are added below               |
| `Esc`                            | step back: an open field, a pending second press, the projects; else close |

`p` switches to the projects, every `.todo/*.md` with its progress:

| Key            | Does                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| `1-9`, `Enter` | make that list the active one and show its items                            |
| `n`            | start a new list from a title: `Nuxt Migration` becomes `nuxt-migration.md` |
| `c`            | move the active list to `.todo/archive/`; press again to confirm            |
| `p`, `Esc`     | back to the items                                                           |

A change is written straight into the file, after reading it again, so an edit made meanwhile is kept; when the line moved, nothing is written and the pane says so. Nothing is overwritten: a new list or an archived one whose name exists already is refused.

The pane closes by itself after two minutes without a key press, never while a field is open. On mobile it shows the list, but has no fields to type in.

## For Claude

- A short section in the system prompt (about 200 tokens, cached) tells Claude the format, to name a new list in `.todo/.active`, and to propose a list in chat first, writing it only once you agreed.
- The built-in todo tools (`TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) are refused in the main conversation; subagents and teammates keep them.
- After Claude edits a `.todo/*.md`, broken item lines are reported back to it right away. A clean edit adds nothing.

## Notes

- The active list is the file named in `.todo/.active` (just the file name, e.g. `nuxt.md`). Without it, or when it names no list, the most recently changed `.todo/*.md` is used.
- The list is your own working note, so keep `.todo/` out of git, e.g. once in `~/.config/git/ignore`.
- Without a `.todo` folder nothing is shown under the prompt.
- Archiving runs `mv` (`cmd /c move` on Windows) in the project root, the one shell command the mod uses.

## Install

```
/plugin install clautodo --marketplace Flo0806/fh-claude-mods
```
