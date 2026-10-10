# clausage

Usage and context at a glance: three compact, colored progress bars in one line above the prompt.

```
5h ▰▰▱▱▱▱▱▱ 23% ↻ 14:30  7d ▰▰▰▱▱▱▱▱ 41% ↻ Mo  ctx ▰▱▱▱▱▱▱▱ 6%
```

| Bar   | Shows                                                     |
| ----- | --------------------------------------------------------- |
| `5h`  | Current 5-hour rate-limit window, with the time it resets |
| `7d`  | 7-day rate-limit window, with the weekday it resets       |
| `ctx` | How full the context window is                            |

Colors follow your theme: green below 50 %, yellow from 50 %, red from 80 %.

## Notes

- `5h` and `7d` need a Claude subscription login; with an API key only `ctx` is shown.
- Before the first response of a session `ctx` shows a placeholder (`▱▱▱▱▱▱▱▱ –`), since nothing has been measured yet.
- While the conversation compacts the band steps aside for the engine's progress, then comes back with the context read afresh; after `/clear` `ctx` shows the placeholder again.
- A reset within the next 24 hours shows as a clock time, further out as a weekday.

## Install

```
/plugin install clausage --marketplace Flo0806/fh-claude-mods
```
