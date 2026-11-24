# flo-code

A calm desktop look for the Claude Code desktop app, plus a clock above the prompt.

| Part     | What it does                                                                 |
| -------- | ---------------------------------------------------------------------------- |
| Colors   | Cool grays tinted toward blue with crisp accents, a light and a dark version |
| Backdrop | Soft color fields drifting slowly behind frosted-glass panels                |
| Messages | Rounded bubbles for your messages, softly rounded tool rows                  |
| Clock    | Current time and date in its own row above the prompt, updated every minute  |

## Notes

- The look draws in the desktop and mobile apps only. The terminal keeps its own colors and shows the clock row alone.
- With reduced motion turned on, the backdrop holds still in its resting position.
- `hooks/make-colors.js` is the color helper from Claude Code's plugin authoring guide, copied unchanged.

## Install

```
/plugin install flo-code --marketplace Flo0806/fh-claude-mods
```
