# fh-claude-mods

A Claude Code plugin marketplace with small mods that change Claude Code's own interface.

## Mods

| Mod                          | What it does                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| [clausage](plugins/clausage) | Usage and context progress bars above the prompt: 5-hour limit, 7-day limit, context window |
| [clautodo](plugins/clautodo) | Project todo list in `.todo/*.md`, progress shown under the prompt                          |

## Install

In a Claude Code session:

```
/plugin install clausage --marketplace Flo0806/fh-claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

## Development

```bash
pnpm install
pnpm lint          # oxlint
pnpm fmt           # oxfmt
pnpm typecheck     # needs the mod loaded once, see below
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

Run a mod straight from its folder with hot reload:

```bash
claude --plugin-dir plugins/<mod>
```

The first load writes the API types to `plugins/<mod>/.claude-plugin/types/` (git-ignored), which the editor and `pnpm typecheck` read.

### Adding a mod

1. Create `plugins/<mod>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/register.tsx`
2. Copy `tsconfig.json` from an existing mod
3. Add an entry to `.claude-plugin/marketplace.json`
