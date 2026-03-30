# Worktrees

Git worktrees let you run plans in parallel without switching branches.
Each worktree is a separate directory with its own working tree, sharing
the same git history.

Back to the [README](../README.md) for setup and quickstart.

## When to use worktrees

- Running multiple plans concurrently
- Keeping your main checkout clean while Ralphai works
- Avoiding branch-switching interruptions

## Commands

```bash
ralphai worktree list                     # show active worktrees
ralphai worktree clean                    # remove completed worktrees
```

The lifecycle: `ralphai run` creates or reuses a worktree → runs the plan there → pushes a branch → opens or updates a draft PR → `ralphai worktree clean` removes finished worktrees.

Run `ralphai run` from the **main repository**, not from inside a worktree.

## How it works

1. `ralphai run` creates a git worktree with a `ralphai/<plan-slug>` branch.
   It reuses existing worktrees for in-progress plans.
2. If a `setupCommand` is configured, it runs in the worktree directory
   immediately after creation (e.g. `bun install`). This ensures
   dependencies are available before the agent starts.
3. Ralphai runs the agent inside that worktree and keeps the main checkout clean.

Configuration and pipeline data live in global state (`~/.ralphai/repos/<id>/`),
so they are automatically available in every worktree without symlinks.

## Agent compatibility

| Agent       | Worktree support | Notes                            |
| ----------- | ---------------- | -------------------------------- |
| Claude Code | Yes              | Tested                           |
| OpenCode    | Yes              | Tested                           |
| Codex       | No               | Container sandbox restrictions   |
| Others      | Likely           | Untested — no known restrictions |

**Workaround for unsupported agents:** Set `"promptMode": "inline"` in
`config.json` to embed pipeline file contents directly in the prompt,
bypassing the agent's need to access external paths.

## Setup command

Fresh worktrees don't have `node_modules` or other dependency artifacts.
The `setupCommand` option lets you run a command (e.g. `bun install`) in
each new worktree before the agent starts, so it doesn't waste iterations
on missing dependencies.

### Configuration

`ralphai init` auto-detects the setup command from lockfiles:

| Lockfile            | Detected command  |
| ------------------- | ----------------- |
| `bun.lock`          | `bun install`     |
| `pnpm-lock.yaml`    | `pnpm install`    |
| `yarn.lock`         | `yarn install`    |
| `package-lock.json` | `npm install`     |
| `deno.lock`         | `deno install`    |
| `.csproj` / `.sln`  | `dotnet restore`  |
| `go.mod`            | `go mod download` |

You can also set it manually:

```json
{ "setupCommand": "npm install && npm run build" }
```

Or override per-run:

```bash
ralphai run --setup-command='pnpm install'
RALPHAI_SETUP_COMMAND='yarn install' ralphai run
```

Set to `""` (empty string) to disable.

### Behavior

- Runs **only on fresh worktree creation**, not when reusing an existing one.
- On failure, Ralphai exits with code 1 and prints the failing command.
- In `--dry-run` mode, the setup command is not executed.
