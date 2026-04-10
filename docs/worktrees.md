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
ralphai status                            # show active worktrees and pipeline state
ralphai clean --worktrees                 # remove completed worktrees
```

The lifecycle: `ralphai run` creates or reuses a worktree → runs the plan there → pushes a branch → opens or updates a draft PR → `ralphai clean --worktrees` removes completed worktrees.

Run `ralphai run` from the **main repository**, not from inside a worktree.

## How it works

1. `ralphai run` creates a git worktree with a conventional-commit-style branch
   (e.g. `feat/add-dark-mode`, `fix/broken-login`), branching from the
   configured `baseBranch` (default: `main`).
   It reuses existing worktrees for in-progress plans.
2. If a `setupCommand` is configured, it runs in the worktree directory
   immediately after creation (e.g. `bun install`). This ensures
   dependencies are available before the agent starts.
3. Ralphai runs the agent inside that worktree and keeps the main checkout clean.

Plan selection checks runner liveness (via PID files) before resuming
in-progress plans, so multiple `ralphai run` processes on the same repo
will not conflict — each process only picks up plans that have no active
runner.

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

## Docker sandbox mode

When `sandbox` is `"docker"`, Ralphai automatically mounts the main
repository's `.git` directory into the container so that git operations
(commit, diff, status, etc.) work correctly inside worktrees. No extra
configuration is needed — the mount is added whenever the agent's working
directory is a git worktree.

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
- When `sandbox` is `"docker"`, the setup command runs **inside the Docker
  container** (not on the host). This ensures platform-specific binaries
  (e.g., native npm modules) are compiled for the container's OS and
  architecture. The container uses the same image, env vars, and credential
  mounts as agent execution.
- When `sandbox` is `"none"` (default), the setup command runs on the host
  via `execSync`.
- On failure, Ralphai exits with code 1 and prints the failing command.
- In `--dry-run` mode, the setup command is not executed.

## Docker sandbox and worktrees

When `sandbox` is `"docker"`, Ralphai automatically detects whether the
working directory is a git worktree and mounts the main repository's `.git`
directory into the container. This is necessary because a worktree's `.git`
file is a pointer back to the main repo's `.git/worktrees/<name>` directory
— without this mount, git operations inside the container would fail.

The mount is read-write so agents can create commits. No manual
`dockerMounts` configuration is needed for worktree git operations.

## Base branch

By default, worktrees branch from `main` (or whatever `baseBranch` is set
to in your config). You can override this per-run:

```bash
ralphai run --base-branch=develop
```

Resolution order (highest priority first):

1. `--base-branch=<branch>` CLI flag
2. `RALPHAI_BASE_BRANCH` env var
3. `baseBranch` in config file (`~/.ralphai/repos/<id>/config.json`)
4. Default: `main` (auto-detected during `ralphai init`)

### Stacking work across PRDs

If you have an in-progress PRD on a feature branch and want a second PRD
to build on top of it, set `--base-branch` to the first PRD's branch:

```bash
# First PRD is in progress on feat/user-auth
ralphai run 200 --base-branch=feat/user-auth
```

This creates the new worktree forked from `feat/user-auth` instead of
`main`, so all the first PRD's commits are included. The resulting PR
will target `feat/user-auth` as its base.

When the first PRD merges to `main`, you can rebase or merge `main` into
the second PRD's branch to update its base.
