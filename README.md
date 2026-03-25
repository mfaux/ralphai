# ralphai

Put your AI coding agent on autopilot.

Ralphai takes plans (markdown files) from a backlog and drives any CLI-based coding agent to implement them, with branch isolation, feedback loops, and stuck detection built in. You write the plans, or have your agent write them. Ralphai does the rest.

Requires Node.js 18+ (or Bun/Deno) and a [supported CLI agent](#supported-agents).

## Try It Now

```bash
npx ralphai init --yes           # configure agent and feedback commands
npx ralphai run                  # start running plans from the backlog
```

`init --yes` auto-detects installed agents, checking **Claude Code** and **OpenCode** first, then other supported agents. Falls back to OpenCode if none are found. Use `--agent-command=<cmd>` to override (e.g. `--agent-command='claude -p'`).

## Why Ralphai?

AI coding agents get worse the longer they run. As the conversation grows, the model drops older context: it forgets what it tried, repeats mistakes, and drifts.

Ralphai avoids this by starting each iteration with a **fresh agent session**: just the plan and a progress log. No conversation history to lose. No drift.

- **No context rot** — iteration 10 is as sharp as iteration 1
- **Fresh feedback** — real build output every cycle, never recalled from memory
- **Stuck detection** — stops burning tokens when progress stalls

[How it works →](docs/how-ralphai-works.md)

## Install

```bash
npm install -g ralphai                          # install the CLI
npx skills add mfaux/ralphai -g                 # install the planning skill
```

The planning skill teaches your coding agent how to write Ralphai plan files. Once installed, ask your agent to "create a Ralphai plan" and it knows the format, principles, and where to put the file.

## Get Started

In your project repository:

```bash
ralphai init                 # configure agent and feedback commands
```

Ralphai detects your project ecosystem and build scripts automatically. Supported ecosystems: **Node.js/TypeScript** and **C# / .NET** (full support, including monorepo workspace scoping), **Go**, **Rust**, **Python**, and **Java/Kotlin** (basic detection with auto-suggested build/test commands). When multiple ecosystems coexist (e.g., a .NET backend with a Node.js frontend), Ralphai detects all of them and merges their feedback commands. Use `--yes` to skip prompts and auto-detect your installed agent.

Configuration and pipeline state are stored in `~/.ralphai/` (global state, not in your repo). See [Workflows](docs/workflows.md) for details.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in the Ralphai backlog. If you installed the planning skill, the agent already knows the format and output directory.

```
Create a Ralphai plan for adding dark mode support.
```

### 2. Run

Ralphai always creates or reuses a managed worktree on **`ralphai/<plan-slug>`**, so there is no need to create a feature branch yourself.

```bash
ralphai run
```

Each run creates or reuses an isolated worktree, works on a `ralphai/<plan-slug>` branch, runs build/test/lint, commits, pushes, and opens a draft PR when `gh` is available.

```bash
ralphai run              # create or reuse a worktree and open a draft PR
ralphai run --continuous # keep processing backlog plans after the first
ralphai run --resume     # auto-commit dirty state and continue
ralphai run --dry-run    # preview without changing anything
```

Ralphai already uses [git worktrees](docs/worktrees.md) for every run. These commands help you inspect and clean them up:

```bash
ralphai worktree list               # show active worktrees
ralphai worktree clean              # remove completed worktrees
```

### 3. Steer

Plans flow through the pipeline:

```
parked/    backlog/  →  in-progress/  →  out/
```

Park unready plans in `parked/`. Ralphai ignores that folder.
Plans are flat `.md` files in `backlog/` (for example `backlog/my-plan.md`). The runner creates a slug folder automatically when moving a plan to `in-progress/`.

### 4. Pause and resume

Stop mid-run any time. Work stays in `in-progress/<slug>/`. Resume with `ralphai run`, which auto-detects in-progress work. Use `--resume` to auto-commit any dirty working tree state before continuing.

```bash
ralphai status           # see what's queued, in progress, and any problems
ralphai doctor           # validate your setup (agent, feedback commands, config)
ralphai reset            # move in-progress plans back to backlog
ralphai purge            # delete archived artifacts from pipeline/out/
```

### 5. Close the learnings loop

Ralphai logs mistakes to `LEARNINGS.md` (in global state) and flags durable lessons in `LEARNING_CANDIDATES.md` for human review. After a run, review candidates and promote useful ones to `AGENTS.md` or skill docs. [More on learnings ->](docs/how-ralphai-works.md#learnings-system)

## GitHub Issues Integration

Ralphai can pull plans from GitHub issues when the backlog is empty. Label issues with `ralphai` (configurable), and Ralphai converts them into plan files, runs them, and comments progress back on the issue.

```bash
ralphai run --issue-source=github              # pull labeled issues
ralphai run --issue-label=ai-task              # custom label filter
```

Requires the `gh` CLI. Configure via `issueSource`, `issueLabel`, and related keys in `config.json`. See the [CLI Reference](docs/cli-reference.md#issue-tracking) for all options.

## Multi-Repo Management

Ralphai tracks every initialized repo automatically. Run `ralphai repos` from anywhere to see all known repos with pipeline summaries, or use `--repo` to target a specific repo without `cd`-ing into it.

```bash
ralphai repos                           # list all known repos with plan counts
ralphai repos --clean                   # remove stale entries (dead paths, no plans)
ralphai status --repo=my-app            # check status of a different repo
ralphai backlog-dir --repo=~/work/api   # get backlog path by repo path
```

The `--repo` flag works with `status`, `reset`, `purge`, `teardown`, `backlog-dir`, and `doctor`. It is blocked for `run`, `worktree`, and `init`, which must be run inside the target repo.

## Interactive Dashboard

Running bare `ralphai` in a terminal launches an interactive two-pane dashboard. The left pane lists plans grouped by state (active, queued, done); the right pane shows detail tabs for the selected plan: summary, plan content, progress log, and live agent output.

```bash
ralphai                  # launches the dashboard (TTY only)
```

Press **Tab** to toggle focus between panes, **s/p/g/o** to switch detail tabs, and **r/R/P** to run, reset, or purge plans. The dashboard auto-refreshes every 3 seconds and filters out stale repos with no plans. If you run `ralphai` in an un-initialized repo, it offers to run `ralphai init` first.

This is a convenience layer. The headless `ralphai run`, `ralphai worktree list`, and `ralphai worktree clean` commands remain the primary workflow.

## Manage Your Installation

```bash
ralphai update           # update to the latest version
ralphai teardown         # remove Ralphai from your project
ralphai uninstall        # remove all global state and uninstall the CLI
```

## Monorepo Support

`ralphai init` automatically detects workspace packages from `pnpm-workspace.yaml`, the `workspaces` field in `package.json`, or `.sln` files (for .NET projects). In mixed repos (e.g., Node.js + .NET), workspaces from both ecosystems are merged. Both `--yes` and interactive modes display detected workspaces and rely on automatic scope filtering at runtime.

Plans can target a specific package by adding `scope` to the frontmatter:

```md
---
scope: packages/web
---
```

When a plan has a scope, Ralphai rewrites feedback commands to target the scoped package. For Node.js, this uses the package manager's workspace filter (e.g., `pnpm --filter @org/web build`). For .NET, the project path is appended to dotnet commands (e.g., `dotnet build src/Api`).

`ralphai status` annotates each plan with its scope when declared, and `ralphai doctor` validates per-workspace feedback commands when a `workspaces` config exists (failures produce warnings, not hard errors).

For custom per-package overrides, add a `workspaces` key to `config.json`:

```json
{
  "workspaces": {
    "packages/web": {
      "feedbackCommands": ["pnpm --filter web build", "pnpm --filter web test"]
    }
  }
}
```

## Supported Agents

Ralphai works with any CLI agent that accepts a prompt argument. **Claude Code** and **OpenCode** are actively tested.

<details>
<summary>Agent commands</summary>

| Agent       | Command                          | Status   |
| ----------- | -------------------------------- | -------- |
| Claude Code | `claude -p`                      | Tested   |
| OpenCode    | `opencode run --agent build`     | Tested   |
| Codex       | `codex exec`                     | Untested |
| Gemini CLI  | `gemini -p`                      | Untested |
| Aider       | `aider --message`                | Untested |
| Goose       | `goose run -t`                   | Untested |
| Kiro        | `kiro-cli chat --no-interactive` | Untested |
| Amp         | `amp -x`                         | Untested |

</details>

## Reference

- [CLI Reference](docs/cli-reference.md) — all commands, flags, and configuration
- [How Ralphai Works](docs/how-ralphai-works.md) — context rot, feedback loops, stuck detection
- [Worktrees](docs/worktrees.md) — parallel runs in isolated directories
- [Workflows](docs/workflows.md) — common patterns and recipes
- [Troubleshooting](docs/troubleshooting.md) — common issues and fixes

## Acknowledgements

- [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley — creator of the technique behind the loop
- [Getting Started With Ralph](https://www.aihero.dev/getting-started-with-ralph) by Matt Pocock
- [Vercel CLI](https://github.com/vercel/vercel) for CLI DX inspiration

## License

MIT
