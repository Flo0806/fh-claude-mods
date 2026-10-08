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

## Notes

- The most recently changed `.todo/*.md` is the active list.
- The list is your own working note, so keep `.todo/` out of git, e.g. once in `~/.config/git/ignore`.
- Without a `.todo` folder nothing is shown.

## Install

```
/plugin install clautodo --marketplace Flo0806/fh-claude-mods
```
