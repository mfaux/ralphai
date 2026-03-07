# ralphai

Put your AI coding agent on autopilot.

Ralphai takes [plan files](#1-write-plans) (markdown) from its backlog and drives any CLI-based coding agent to implement them, with branch isolation, feedback loops, and stuck detection built in. Each plan contains tasks — like a todo list for the agent to work through. You write the plans (or have your agent write them). Ralphai does the rest.

## Why Ralphai?

AI coding agents get worse the longer they run. Every model can only "see" a limited amount of text at once (its context window). As the conversation grows, the model quietly drops or summarizes older messages. It forgets what it already tried, repeats mistakes, or contradicts earlier work. [More on this →](docs/how-ralphai-works.md#context-rot)

Ralphai avoids this by starting each **turn** with a **fresh session**: just the plan and a progress log. No conversation history to lose, no drift.

- **No context rot** — turn 50 is as sharp as turn 1
- **Fresh feedback** — real build output every cycle, never recalled from memory
- **Stuck detection** — stops burning tokens when progress stalls
- **Unattended** — write plans, walk away

## Install

**Global** (recommended for individual use):

```bash
npm install -g ralphai
```

**Local dev dependency** (pins the version in package.json):

```bash
npm install -D ralphai
```

**npx** (no install, runs latest):

```bash
npx ralphai
```

## Get Started

In your project directory:

```bash
ralphai init
```

Ralphai scaffolds a `.ralphai/` directory into your project with docs and a plan pipeline, and creates a `ralphai.json` config file at the repo root. It detects your package manager and build scripts automatically.

> Use `ralphai init --yes` to skip prompts and accept defaults.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in `.ralphai/pipeline/backlog/`. Point it at `.ralphai/PLANNING.md` for structure and examples, or roll your own format. Ralphai just needs markdown files with clear [**acceptance criteria**](templates/ralphai/PLANNING.md).

> Plan files are **gitignored** — they're local-only state, not tracked by git.

```
Create a plan in the ralphai backlog for adding dark mode support.
Use PLANNING.md as a guide.
```

### 2. Run

Ralphai commits on your **current branch** by default. It refuses to run on `main`/`master` — create or switch to a feature branch first.

```bash
git checkout -b my-feature
ralphai run
```

Ralphai picks a plan from the backlog, hands it to your agent, and loops. Each turn, the agent works on one task, then ralphai runs build, test, and lint. When all the tasks in a plan is done, it commits the changes on your current branch.

```
    ┌─────────────────────────────────────┐
    │            Fresh session            │
    │   plan + progress log + learnings   │
    └──────────────────┬──────────────────┘
                       ▼
               ┌───────────────┐
               │  Agent works  │
               │ on next task  │
               └───────┬───────┘
                       ▼
               ┌───────────────┐
               │  Agent runs   │
               │  build/test/  │◄──┐
               │     lint      │   │
               └───────┬───────┘   │
                       ▼           │
                 ┌───────────┐     │
                 │  Errors?  │─yes─┘
                 └─────┬─────┘
                       │ no
                       ▼
                 ┌───────────┐
                 │  Commit   │
                 └─────┬─────┘
                       ▼
                   Next turn
                (fresh session)
```

Common options:

```bash
ralphai run --turns=3    # 3 turns per plan (default: 5)
ralphai run --turns=0    # unlimited turns — runs until all work is done
ralphai run --pr         # create a ralphai/* branch and open a PR instead
ralphai run --dry-run    # preview what ralphai would do without changing anything
```

> A single turn can take several minutes (agent invocation + feedback commands). Don't expect `progress.md` to update every few seconds — it updates between turns when there's something to report.

### 2b. Run in a worktree

For non-disruptive parallel work, use `ralphai worktree` to run a plan in an isolated [git worktree](https://git-scm.com/docs/git-worktree). This lets you keep working in your main checkout while Ralphai runs in a separate directory.

```bash
ralphai worktree                          # auto-pick next backlog plan
ralphai worktree --turns=3                # run with 3 turns per plan
ralphai worktree --plan=prd-dark-mode.md  # target a specific plan
```

The lifecycle: create worktree → run plan → create PR → clean up. If the agent gets stuck or times out, the worktree is preserved. Re-run `ralphai worktree` from the main repo to reuse it, or `cd` into the worktree and run `ralphai run --resume` directly.

```bash
ralphai worktree list    # show active ralphai-managed worktrees
ralphai worktree clean   # remove completed/orphaned worktrees
```

> `ralphai worktree` must be run from the **main repository**, not from inside a worktree. All runner options (`--turns`, `--agent-command`, `--feedback-commands`, etc.) are forwarded automatically.

### 3. Steer

Plans flow through three directories: `backlog/ → in-progress/ → out/`. Not ready for Ralphai to pick something up? Park it in `wip/` — Ralphai ignores that folder.

```
pipeline/backlog/       ← queued, ralphai picks from here
pipeline/in-progress/   ← ralphai is working on it
pipeline/out/           ← done, archived
pipeline/wip/           ← parked, ralphai ignores
```

### 4. Pause and resume

Stop mid-run any time. Work stays in `in-progress/`. Resume by running `ralphai run` again — it auto-detects in-progress work. For worktree runs, re-run `ralphai worktree` from the main repo to reuse the existing managed worktree, or resume inside the worktree with `ralphai run --resume`.

Use `ralphai status` to see what's in the backlog, what's in progress (with task counts), active worktrees, and any problems.

### 5. Close the learnings loop

Ralphai logs mistakes to `.ralphai/LEARNINGS.md` (gitignored) during runs. After a run, review those entries and promote durable lessons to `AGENTS.md` or skill docs. [How the learnings system works →](docs/how-ralphai-works.md#learnings-system)

### After you're set up

1. **Commit `ralphai.json` to git.** It's the shared config for your team.

2. **Review `ralphai.json`** and adjust settings (agent command,
   feedback commands, base branch, etc.).

<details>
<summary><strong>Advanced: Git Worktrees</strong></summary>

For worktree internals, agent compatibility, and manual worktree setup, see
[Worktrees](docs/worktrees.md).

</details>

## How Ralphai Works

- **Direct mode by default** — commits on your current branch, no branch creation or PR
- **`--pr` mode** — creates a `ralphai/<plan-name>` branch and opens a PR via `gh`
- **Feedback loops** — build, test, and lint run after each turn (auto-detected or configured)
- **Stuck detection** — if N turns produce no commits, Ralphai aborts (default: 3)
- **Plan dependencies** — plans can declare `depends-on` for ordering across a backlog
- **GitHub Issues** — Ralphai can pull labeled issues when the backlog is empty

See [How Ralphai Works](docs/how-ralphai-works.md) for the full picture.

## Docs

After `ralphai init`, pipeline docs live in `.ralphai/` (local-only, gitignored):

- `.ralphai/README.md` — full operational docs (lifecycle, config)
- `.ralphai/PLANNING.md` — guide for writing plan files (give this to your agent)
- [Worktrees](docs/worktrees.md) — worktree usage, agent compatibility, and manual setup

## Supported Agents

Ralphai works with any CLI agent that accepts a prompt argument. **Claude Code** and **OpenCode** are actively tested. The other presets are included for convenience but have not been validated end-to-end — they should work, but your mileage may vary.

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

## CLI Reference

<details>
<summary>Commands and options</summary>

```
ralphai <command> [options]

Commands:
  init        Set up Ralphai in your project
  run         Start the Ralphai task runner
  worktree    Run in an isolated git worktree
  status      Show pipeline and worktree status
  reset       Move in-progress plans back to backlog and clean up
  update      Update ralphai to the latest (or specified) version
  uninstall   Remove Ralphai from your project

Options:
  --help, -h     Show help
  --version, -v  Show version

Init:
  --yes, -y              Skip prompts, use defaults
  --force                Re-scaffold from scratch
  --agent-command=CMD    Set the agent command

Run:
  --turns=<n>                       Turns per plan (default: 5, 0 = unlimited)
  --dry-run, -n                     Preview what would happen without changing anything
  --resume, -r                      Auto-commit dirty state and continue
  --agent-command=<command>         Override agent CLI command
  --feedback-commands=<list>        Comma-separated feedback commands
  --base-branch=<branch>            Override base branch (default: main)
  --direct                          Direct mode (default): commit on current branch, no PR
  --pr                              PR mode: create branch, push, and open PR
  --continuous                      Keep processing backlog plans after the first completes
  --max-stuck=<n>                   Stuck threshold before abort (default: 3)
  --turn-timeout=<seconds>          Timeout per agent invocation (default: 0 = no timeout)
  --fallback-agents=<list>          Comma-separated fallback agent commands (tried when stuck)
  --auto-commit                     Auto-commit agent changes between turns
  --no-auto-commit                  Disable auto-commit (default)
  --prompt-mode=<mode>              Prompt format: 'auto', 'at-path', or 'inline' (default: auto)
  --show-config                     Print resolved settings and exit
  --issue-source=<source>           Issue source: 'none' or 'github' (default: none)
  --issue-label=<label>             Label to filter issues (default: ralphai)
  --issue-in-progress-label=<label> Label applied when issue is picked up
  --issue-repo=<owner/repo>         Override repo for issue operations (default: auto-detect)
  --issue-close-on-complete=<bool>  Close issue on plan completion (default: true)
  --issue-comment-progress=<bool>   Comment on issue during run (default: true)

Worktree:
  --plan=<file>     Target a specific backlog plan (default: auto-detect)
  --dir=<path>      Worktree directory (default: ../.ralphai-worktrees/<slug>)
  worktree list     Show active ralphai-managed worktrees
  worktree clean    Remove completed/orphaned worktrees

Reset:
  --yes, -y         Skip confirmation prompt
```

</details>

## Configuration

Settings resolve in this order: **CLI flags > env vars > `ralphai.json` > defaults**.

<details>
<summary>Environment variables</summary>

| Env Var                           | Config Key             |
| --------------------------------- | ---------------------- |
| `RALPHAI_AGENT_COMMAND`           | `agentCommand`         |
| `RALPHAI_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPHAI_BASE_BRANCH`             | `baseBranch`           |
| `RALPHAI_MODE`                    | `mode`                 |
| `RALPHAI_AUTO_COMMIT`             | `autoCommit`           |
| `RALPHAI_TURNS`                   | `turns`                |
| `RALPHAI_PROMPT_MODE`             | `promptMode`           |
| `RALPHAI_MAX_STUCK`               | `maxStuck`             |
| `RALPHAI_TURN_TIMEOUT`            | `turnTimeout`          |
| `RALPHAI_ISSUE_SOURCE`            | `issueSource`          |
| `RALPHAI_ISSUE_LABEL`             | `issueLabel`           |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPHAI_ISSUE_REPO`              | `issueRepo`            |
| `RALPHAI_ISSUE_CLOSE_ON_COMPLETE` | `issueCloseOnComplete` |
| `RALPHAI_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

</details>

## Acknowledgements

- [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley — the technique behind the loop
- [Vercel CLI](https://github.com/vercel/vercel) — CLI DX inspiration

## License

MIT
