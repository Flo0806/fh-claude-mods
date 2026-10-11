# clauinfo

Model and effort at a glance: one quiet line above the prompt, and a toast at start and on every change.

```
Opus 5.5 · medium
```

| Model  | Look                |
| ------ | ------------------- |
| Fable  | Claude orange, bold |
| Opus   | Plain text          |
| Sonnet | Blue                |
| Haiku  | Yellow              |

| Effort          | Look         |
| --------------- | ------------ |
| `low`, `medium` | Dimmed       |
| `high`          | Bright, bold |
| `xhigh`         | Yellow, bold |
| `max`           | Red, bold    |

## Notes

- clauinfo only shows; it never changes the model or the effort.
- `?` after a model switch means the effort is not known yet; the next request fills it in. A model that takes no effort (Haiku) shows none.
- While the conversation compacts the line steps aside for the engine's progress.

## Known gap

Claude Code gives mods no way to read the current effort directly: there is `$.session.model()`, but no `$.session.effort()` and no event when model or effort change. clauinfo therefore combines three sources:

- `/effort <level>` is taken from the command itself, right away.
- The `/model` and `/effort` pickers save to the settings, which clauinfo checks once a second.
- Every model request reports the effort it really sends, which settles everything else.

So an effort that holds for this session only and was picked in the menu (`max`) shows with the next prompt, not before. Once Claude Code offers a direct source, clauinfo will switch to it.

## Install

```
/plugin install clauinfo --marketplace Flo0806/fh-claude-mods
```
