# fh-claude-mods

Claude Code mods by Flo, one folder per mod under `plugins/`. Working rules: skill `code-like-flo`.

## Project rules

- Small project: work directly on `main`, no feature branches.
- Installed from GitHub (`Flo0806/fh-claude-mods`): a change reaches installs only after a `version` bump in the mod's `.claude-plugin/plugin.json`.
- Checks: `claude plugin test plugins/<mod>`, `pnpm typecheck`, `pnpm lint`, `pnpm fmt`.
