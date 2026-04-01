# ralphai

Put your AI coding agent on autopilot.

Ralphai takes plans (markdown files) from a backlog and drives any CLI-based coding agent to implement them, with branch isolation, feedback loops, and stuck detection built in. You write the plans, or have your agent write them. Ralphai does the rest.

Requires Node.js 18+ (or Bun/Deno) and a [supported CLI agent](#supported-agents).

## Try It Now

```bash
npx ralphai init --yes           # configure agent and feedback commands
npx ralphai                      # open the TUI and run a plan from the backlog
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

### 2. Use the TUI

For day-to-day use, start with the interactive menu:

```bash
ralphai
```

This shows a pipeline summary header and an interactive menu. From here you can view pipeline status, and more actions will be added in future releases.

`ralphai` is the primary workflow for humans. Use it to browse the pipeline, inspect progress, and launch actions without remembering subcommands.

### 3. Run headlessly

Ralphai always creates or reuses a managed worktree on **`ralphai/<plan-slug>`**, so there is no need to create a feature branch yourself.

```bash
ralphai run
```

Each run creates or reuses an isolated worktree, works on a `ralphai/<plan-slug>` branch, runs build/test/lint, commits, pushes, and opens a draft PR when `gh` is available.

```bash
ralphai run              # drain the backlog: one branch/PR per plan
ralphai run --once       # process a single plan then exit
ralphai run --prd=42     # PRD-driven run from GitHub issue #42
ralphai prd 42           # shorthand for run --prd=42
ralphai run --resume     # auto-commit dirty state and continue
ralphai run --dry-run    # preview without changing anything
```

Ralphai already uses [git worktrees](docs/worktrees.md) for every run. These commands help you inspect and clean them up:

```bash
ralphai worktree list               # show active worktrees
ralphai worktree clean              # remove completed worktrees
```

Use `ralphai run` when you want a non-interactive command, such as automation, quick terminal execution, or resuming work directly.

### 4. Steer

Plans flow through the pipeline:

```
parked/    backlog/  →  in-progress/  →  out/
```

Park unready plans in `parked/`. Ralphai ignores that folder.
Plans are flat `.md` files in `backlog/` (for example `backlog/my-plan.md`). The runner creates a slug folder automatically when moving a plan to `in-progress/`.

### 5. Pause, stop, and resume

**Headless (`ralphai run`):** Press Ctrl-C to stop the runner. It finishes the current iteration cleanly, then exits. Work is preserved in `in-progress/<slug>/`.

**Stop a runner:** Use `ralphai stop` to send SIGTERM to running plan runners. Pass a plan slug to stop a specific runner, or use `--all` to stop all runners. Use `--dry-run` to preview which processes would be stopped.

**Resuming:** Reopen `ralphai` or run `ralphai run` to pick up where the agent left off. Ralphai auto-detects in-progress work. Use `--resume` to auto-commit any dirty working tree state before continuing.

```bash
ralphai status           # see what's queued, in progress, and any problems
ralphai stop             # stop the running plan runner (auto-selects if only one)
ralphai stop my-plan     # stop a specific plan runner by slug
ralphai stop --all       # stop all running plan runners
ralphai doctor           # validate your setup (agent, feedback commands, config)
ralphai reset            # move in-progress plans back to backlog
ralphai purge            # delete archived artifacts from pipeline/out/
ralphai clean            # remove archived plans and orphaned worktrees
ralphai clean --archive  # clean only archived plans
ralphai clean --worktrees # clean only orphaned worktrees
```

### 6. Close the learnings loop

Ralphai extracts learnings from the agent's output during each run and surfaces them in the **Learnings** section of the draft PR. Review them when reviewing the PR and promote useful lessons to `AGENTS.md` or skill docs. [More on learnings ->](docs/how-ralphai-works.md#learnings-system)

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
ralphai config backlog-dir --repo=~/work/api  # get backlog path by repo path
```

The `--repo` flag works with `status`, `reset`, `purge`, `clean`, `uninstall`, `backlog-dir`, `doctor`, `check`, and `config`. It is blocked for `run`, `prd`, `worktree`, and `init`, which must be run inside the target repo.

## Interactive Menu

Running bare `ralphai` in a terminal launches an interactive menu with a pipeline summary header showing plan counts (backlog, running, completed). Select actions from the menu to view pipeline status and more.

```bash
ralphai                  # launches the interactive menu (TTY only)
```

The menu re-gathers pipeline state before each display so data is always fresh. Ctrl+C or selecting "Quit" exits cleanly. If you run `ralphai` in an un-initialized repo, it offers to run `ralphai init` first, then proceeds to the menu.

For most people, this is the main way to use Ralphai. Reach for `ralphai run` when you want headless execution.

## Manage Your Installation

```bash
ralphai update           # update to the latest version
ralphai uninstall        # remove Ralphai from this project
ralphai uninstall --global  # remove all global state and uninstall the CLI
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
