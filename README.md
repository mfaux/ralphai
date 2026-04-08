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
npx skills add mfaux/ralphai -g                 # install skills for your coding agent
```

Ralphai ships skills that teach your coding agent how to plan and execute work:

- **write-a-prd** — create a product requirements document through interactive interview
- **improve-codebase-architecture** — find and propose module-deepening refactors
- **request-refactor-plan** — plan structural changes with tiny, verifiable commits
- **triage-issue** — investigate bugs and create TDD fix plans
- **prd-to-issues** — decompose a PRD into vertical-slice GitHub sub-issues
- **tdd** — test-driven development with red-green-refactor loops
- **ralphai-planning** — write Ralphai plan files for autonomous execution

The recommended workflow: plan with a skill (write-a-prd, triage-issue, etc.), decompose PRDs with prd-to-issues, then let Ralphai run the issues autonomously.

## Get Started

In your project repository:

```bash
ralphai init                 # configure agent and feedback commands
```

Ralphai detects your project ecosystem and build scripts automatically. Supported ecosystems: **Node.js/TypeScript** and **C# / .NET** (full support, including monorepo workspace scoping), **Go**, **Rust**, **Python**, and **Java/Kotlin** (basic detection with auto-suggested build/test commands). When multiple ecosystems coexist (e.g., a .NET backend with a Node.js frontend), Ralphai detects all of them and merges their feedback commands. Use `--yes` to skip prompts and auto-detect your installed agent.

Configuration and pipeline state are stored in `~/.ralphai/` (global state, not in your repo). See [Workflows](docs/workflows.md) for details.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in the Ralphai backlog. If you installed the skills, the agent already knows the format and output directory.

```
Create a Ralphai plan for adding dark mode support.
```

### 2. Use the TUI

For day-to-day use, start with the interactive menu:

```bash
ralphai
```

This shows a pipeline summary header and an interactive menu. From here you can run the next queued plan, pick a specific plan from the backlog, or view pipeline status.

`ralphai` is the primary workflow for humans. Use it to browse the pipeline, inspect progress, and launch actions without remembering subcommands.

### 3. Run headlessly

Ralphai always creates or reuses a managed worktree on a **`<type>/<slug>`** branch (e.g. `feat/add-dark-mode`, `fix/broken-login`), so there is no need to create a feature branch yourself.

```bash
ralphai run
```

Each run creates or reuses an isolated worktree, works on a `<type>/<slug>` branch (conventional commit style), runs build/test/lint, commits, pushes, and opens a draft PR when `gh` is available.

```bash
ralphai run              # drain the backlog: one branch/PR per plan
ralphai run 42           # run GitHub issue #42 (PRD or standalone)
ralphai run --once       # process a single plan then exit
ralphai run --resume     # auto-commit dirty state and continue
ralphai run --dry-run    # preview without changing anything
```

Ralphai already uses [git worktrees](docs/worktrees.md) for every run. Use `ralphai clean --worktrees` to remove completed or orphaned worktrees.

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
ralphai clean            # remove archived plans and orphaned worktrees
ralphai clean --archive  # clean only archived plans
ralphai clean --worktrees # clean only orphaned worktrees
```

### 6. Close the learnings loop

Ralphai extracts learnings from the agent's output during each run and surfaces them in the **Learnings** section of the draft PR. Review them when reviewing the PR and promote useful lessons to `AGENTS.md` or skill docs. [More on learnings ->](docs/how-ralphai-works.md#learnings-system)

## GitHub Issues & PRDs

For multi-step features, **PRDs (Product Requirements Documents)** are the recommended way to work. Create a GitHub issue, label it with the PRD label (`ralphai-prd` by default, configurable via `prdLabel`), and add sub-issues for each piece of work. Then point Ralphai at it:

```bash
ralphai run 42           # run PRD #42: all sub-issues on one branch
```

Ralphai processes sub-issues sequentially on a single `feat/<prd-slug>` branch, skips any that get stuck, and opens one aggregate draft PR when done. Sub-issues support dependencies via GitHub's native blocking relationships.

For **standalone issues** — one-off bugs, small tasks — label them with `ralphai-standalone` (configurable via `standaloneLabel`) and either target them directly or let the drain loop pick them up:

```bash
ralphai run 57           # run standalone issue #57
ralphai run              # auto-pulls from GitHub when the backlog is empty
```

Each standalone issue gets its own branch and PR, the same as a local plan file.

Both workflows require the `gh` CLI and `issueSource: "github"` in config. Ralphai creates 6 GitHub labels — 3 family labels (`standaloneLabel`, `subissueLabel`, `prdLabel`) plus 3 shared state labels (`in-progress`, `done`, `stuck`). Family labels are configurable via `config.json` or environment variables. See the [CLI Reference](docs/cli-reference.md#config-keys) for all options.

## Multi-Repo Management

Ralphai tracks every initialized repo automatically. Run `ralphai repos` from anywhere to see all known repos with pipeline summaries, or use `--repo` to target a specific repo without `cd`-ing into it.

```bash
ralphai repos                           # list all known repos with plan counts
ralphai repos --clean                   # remove stale entries (dead paths, no plans)
ralphai status --repo=my-app            # check status of a different repo
ralphai config backlog-dir --repo=~/work/api  # get backlog path by repo path
```

The `--repo` flag works with `status`, `reset`, `clean`, `uninstall`, `doctor`, `config`. It is blocked for `run` and `init`, which must be run inside the target repo.

## Interactive Menu

Running bare `ralphai` in a terminal launches an interactive menu with a pipeline summary header showing plan counts (backlog, running, completed). From the menu you can:

- **Run next plan** — auto-detects the next ready plan (respecting dependency ordering) and hands off to the runner. When the backlog is empty but GitHub issues are configured, it will pull from GitHub.
- **Pick from backlog** — browse all backlog plans with scope and dependency info, then select one to run.
- **View pipeline status** — display detailed pipeline status.
- **Doctor** — run health checks (agent, feedback commands, config, git).
- **Clean worktrees** — remove archived plans and orphaned worktrees.
- **View config** — display the fully resolved configuration with source tracking.
- **Edit config** — re-run the init wizard to update settings.

```bash
ralphai                  # launches the interactive menu (TTY only)
```

The menu re-gathers pipeline state before each display so data is always fresh. Selecting a run action hands off to the runner (the menu does not re-appear). Ctrl+C or selecting "Quit" exits cleanly. If you run `ralphai` in an un-initialized repo, it offers to run `ralphai init` first, then proceeds to the menu.

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
- [mattpocock/skills](https://github.com/mattpocock/skills) — inspiration for the planning and TDD skills
- [Vercel CLI](https://github.com/vercel/vercel) for CLI DX inspiration

## License

MIT
