# clauguard

A usage budget per run and a clean handoff before the context fills. Made for long, unattended runs
such as `/goal`.

```
/guard start 30
```

Remembers the current 7-day usage (say 10 %) and stops the run at 40 %. The prompt hint shows
`guard ≤40%`.

## What it does

| When                 | What happens                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget reached       | The next tool call is refused with "wrap up the current step, write a handoff". 10 more calls are allowed, then every tool call is refused, the turn ends and a toast says `Limit erreicht`. `/guard start` begins a new run. |
| Context at 85 %      | The main agent is asked once to finish its step, update its memory and run `/remember`. Once `/remember` has run, clauguard ends the turn, compacts the conversation and sends "carry on".                                    |
| Any other compaction | A pending handoff is dropped, the next fill asks again.                                                                                                                                                                       |

## Commands

| Command             | Effect                                                   |
| ------------------- | -------------------------------------------------------- |
| `/guard start [n]`  | New run with a budget of `n` percent points (default 30) |
| `/guard stop`       | Budget off                                               |
| `/guard` / `status` | Shows the current state                                  |

## Notes

- The budget needs a Claude subscription login, it reads the 7-day rate limit. The handoff works everywhere.
- The weekly figure updates with each response, so a run can overshoot by one step.
- Subagents are stopped by the budget too, but only the main agent does the handoff.
- The handoff relies on the `remember` plugin.

## Install

```
/plugin install clauguard --marketplace Flo0806/fh-claude-mods
```
