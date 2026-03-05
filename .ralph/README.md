# .ralph/ — Autonomous Task Runner

Ralph is a set of shell scripts that drive an AI coding agent to autonomously implement tasks from plan files.

## Quick Start

Primary (recommended): run through `npx`:

```bash
npx ralphai run -- --dry-run
npx ralphai run -- 5
npx ralphai run -- 5 --resume
npx ralphai run -- --help

# Direct mode: commit on current branch, no PR (must be on a feature branch)
npx ralphai run -- 5 --direct
```

In initialized repos, `ralphai run` forwards arguments to `.ralph/ralph.sh`; direct invocation (`./.ralph/ralph.sh ...`) and package scripts are optional alternatives if you prefer.

```bash
npx ralphai run -- --dry-run
npx ralphai run -- 5
npx ralphai run -- 5 --resume
```

## Lifecycle

Plans flow through three directories:

```
wip/ (work in progress)  backlog/  -->  in-progress/  -->  out/
```

1. **`wip/`** (work in progress) — Parked plans not ready for execution. `ralph.sh` does **not** scan this directory. Use it for plans that need further thought, external prerequisites, or human review before they're queued. Move to `backlog/` when ready.
2. **`backlog/`** — Queue incoming plans here. `ralph.sh` picks dependency-ready plans automatically (LLM-selected when multiple are ready) and moves them to `in-progress/`.
3. **`in-progress/`** — Active work. Plan files and `progress.txt` live here while ralph is working. If a run is interrupted or exhausts its iterations, files stay here so work can be resumed.
4. **`out/`** — Archive. Plans and progress logs are moved here only when the agent signals `COMPLETE`.

Plan files in `wip/`, `backlog/`, `in-progress/`, and `out/` are **gitignored** (local-only state). Only directory structure (`.gitkeep` files) is tracked. This means moving files between lifecycle stages requires no git commits.

## Scripts

### `ralph.sh [iterations-per-plan] [options]`

Looped autonomous runner. Auto-detects what to work on, runs up to N iterations per plan, with stuck detection.

```bash
npx ralphai run -- 5

# Preview selection and readiness without moving files or creating branches
npx ralphai run -- --dry-run

# Recover dirty state and continue on current ralph/* branch
npx ralphai run -- 5 --resume

# Override agent command, base branch, or stuck threshold
npx ralphai run -- 5 --agent-command='claude -p' --base-branch=develop --max-stuck=5

# Override via env vars
RALPH_AGENT_COMMAND='codex exec' npx ralphai run -- 5

# Direct mode: commit on current branch, no PR
npx ralphai run -- 5 --direct
```

No file arguments needed. The script auto-detects:

1. **In-progress work** — If `.ralph/pipeline/in-progress/` has plan files, resumes on the current `ralph/*` branch.
2. **Backlog selection** — If no in-progress work, picks from dependency-ready plans in `.ralph/pipeline/backlog/`. When multiple ready plans exist, an LLM call selects the best one based on dependencies, risk, and value. The chosen plan is moved to `in-progress/` and a new branch is created.
3. **Nothing to do** — If both are empty and no GitHub issues are available, exits.

The iteration budget (N) resets for each new plan. After completing one plan, the script automatically picks the next one from the backlog and continues until the backlog is empty.

Aborts if N consecutive iterations produce no commits (stuck detection). The threshold defaults to 3 and can be configured via `maxStuck` in `.ralph/ralph.config`, `RALPH_MAX_STUCK` env var, or `--max-stuck=<n>` CLI flag.

`--dry-run` mode previews:

- whether there is runnable work
- which plan would be selected
- whether run would resume or create a branch
- the current mode (PR or direct)

Dry run makes no mutations (no file moves, branch creation, or agent execution).

`--resume` mode:

- auto-commits dirty tracked/untracked changes on any non-base branch
- then continues normal execution
- refuses to auto-commit on the configured base branch (defaults to `main`)

**Two modes:**

- **PR mode** (default): On completion, pushes the `ralph/*` branch and creates a PR via `gh` CLI (with plan content + commit log in the PR body). Then loops back to pick the next backlog item.
- **Direct mode** (`--direct`): Commits on the current branch — no branch creation, no PR. Refuses to run on `main`/`master`. Use this when you're already on a feature branch.

- **On iteration exhaustion or stuck abort**: leaves files in `in-progress/` so you can resume with another run on the same branch.

## Files

| File / Directory      | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `ralph.sh`            | Looped autonomous runner (+ `--dry-run`)                 |
| `ralph.config`        | Optional repo-level config file (key=value format)       |
| `README.md`           | This file — operational docs for the `.ralph/` directory |
| `PLANNING.md`         | Guide for writing plan files                             |
| `.gitignore`          | Keeps plan files local-only (not tracked by git)         |
| `.ralph/LEARNINGS.md` | Ralph-specific learnings — gitignored, local-only        |
| `wip/`                | Work-in-progress plans — not scanned by ralph            |
| `backlog/`            | Incoming plans queued for ralph to pick up               |
| `in-progress/`        | Active plans and progress.txt — work in flight           |
| `out/`                | Archived PRD files and progress logs from completed runs |

## How It Works

1. `ralph.sh` loads `.ralph/ralph.config` (if present), applies env var overrides, then CLI flag overrides to resolve settings (agent command, feedback commands, base branch, mode, stuck threshold)
2. It scans `in-progress/` for existing plan files; if found, it resumes. Otherwise it picks from `backlog/` (LLM-selected when multiple ready plans exist) and moves the chosen plan to `in-progress/`, initializing `progress.txt`
3. A `ralph/<plan-slug>` branch is created from the base branch (e.g. `ralph/add-dark-mode` from `prd-add-dark-mode.md`; current branch reused on resume). If the branch already exists (local, remote, or has an open PR), the plan is skipped and the next one is tried.
4. The agent receives a prompt with `@file` references to the plan files + `progress.txt`
5. The agent reads the plan, picks the next task, implements it, runs the configured feedback commands, and commits
6. `progress.txt` is updated with what was done
7. On completion (`COMPLETE` signal): plan + progress archived to `pipeline/out/`, then in PR mode the branch is pushed and a PR is created via `gh`. In direct mode, work is simply committed on the current branch. The script then loops back to pick the next backlog item.
8. On incomplete run: files stay in `pipeline/in-progress/` for resumption

## Optional plan dependencies (`depends-on`)

`ralph.sh` supports optional `depends-on` metadata in plan frontmatter. A plan is runnable only when **all** dependencies are archived in `.ralph/pipeline/out/`.

Supported forms:

```md
---
depends-on: [prd-a.md, prd-b.md]
---
```

```md
---
depends-on:
	- prd-a.md
	- prd-b.md
---
```

Notes:

- Dependencies are referenced by plan basename (e.g. `prd-foo.md`).
- Missing or still-pending dependencies block the plan.
- Plans with no `depends-on` are treated as ready (backward compatible).

## Issue Linking (`source` frontmatter)

Plans can link to a GitHub issue via `source` frontmatter. When a linked plan completes, Ralph automatically comments on and closes the originating issue.

```md
---
source: github
issue: 42
issue-url: https://github.com/owner/repo/issues/42
---
```

- `source` — tracker type (currently only `github`)
- `issue` — issue number
- `issue-url` — full URL to the issue (used for repo detection and human reference)

**What happens on completion:**

1. **`archive_run()`** — posts a "completed" comment on the linked issue
2. **`create_pr()`** — closes the issue with a comment referencing the branch and PR

**Requirements:**

- `gh` CLI must be installed and authenticated (`gh auth login`). If `gh` is not available, hooks are silently skipped — no error.
- To disable automatic issue closing while keeping completion comments, set `issueCloseOnComplete=false` in `.ralph/ralph.config`.

Plans without `source` frontmatter behave exactly as before.

## Conventions

### Branch Naming

Branches are derived from the plan filename: `prd-add-dark-mode.md` → `ralph/add-dark-mode`. If the branch already exists (locally, on the remote, or has an open PR), the plan is **skipped** and Ralph tries the next dependency-ready plan. The `ralph/` prefix is always used for isolation.

### Commit Messages

All commits use [Conventional Commits](https://www.conventionalcommits.org/). The agent prompt enforces this. Examples:

- `feat(transpiler): add Windsurf prompt support`
- `fix(parser): handle empty frontmatter gracefully`
- `refactor: extract shared validation logic`
- `test: add coverage for collision detection`
- `docs: update AGENTS.md with new CLI command`
- `chore(ralph): archive completed run`

### AGENTS.md Updates

Only update `AGENTS.md` when a task produces knowledge that future coding agents need and cannot easily infer from the code itself — e.g. new CLI commands, non-obvious architectural constraints, or changed development workflows. Routine code changes (bug fixes, internal refactors, new tests) do not warrant an `AGENTS.md` update.

### CHANGELOG.md

Do **not** edit `CHANGELOG.md` unless explicitly asked. Changelog entries are maintained by humans.

## Learnings (Two-Tier)

Ralph uses a two-tier learnings system:

- **`.ralph/LEARNINGS.md`** (gitignored) — Ralph writes mistakes and lessons here during autonomous runs. This file is local-only and never committed. Ralph reads it at the start of each iteration to avoid repeating past mistakes.
- **`LEARNINGS.md`** (repo-level, tracked) — Human-curated learnings. Ralph reads this file for context but never writes to it. The project maintainer promotes useful entries from `.ralph/LEARNINGS.md` to the repo-level file when they have lasting value.

Use a lightweight review loop after runs:

1. Review `.ralph/LEARNINGS.md` entries from the run.
2. Compact findings by merging duplicates and removing one-off noise.
3. Promote durable guidance:

- `AGENTS.md` (or equivalent agent-instruction docs) for immediate repo-specific behavior
- skill/reusable docs for stable patterns that should be reused across tasks/repos

4. Add concise, high-signal takeaways to repo-level `LEARNINGS.md`.

This separation keeps the repo-level `LEARNINGS.md` clean (no agent noise) and prevents auto-commit from interfering with stuck detection.

## Safety Guards

- **Dirty state**: `ralph.sh` blocks by default; `--resume` auto-commits dirty state on any non-base branch (dry-run is read-only)
- **Branch isolation**: All work happens on `ralph/*` branches (PR mode) or your current feature branch (direct mode), never directly on `main`
- **PR mode by default**: Ralph creates a branch and opens a PR via `gh` CLI. The `gh` CLI is validated at startup before any agent work begins.
- **Direct mode safety**: `--direct` refuses to run on `main`/`master` — you must be on a feature branch.
- **Collision detection**: Before creating a new branch, Ralph checks for existing local/remote branches and open PRs. If a collision is found, the plan is skipped and the next one is tried.
- **Plan files gitignored**: Plan files in `wip/`, `backlog/`, `in-progress/`, and `out/` are gitignored (local-only state). Only `.gitkeep` files are tracked.
- **Stuck detection**: `ralph.sh` aborts after N iterations with no new commits (default 3, configurable)
- **Iteration timeout**: Optional per-invocation timeout (`iterationTimeout` in seconds). When set, the agent command is killed if it exceeds the limit. Default is 0 (no timeout).
- **Completion signal**: Agent outputs `<promise>COMPLETE</promise>` when all tasks are done

## Configuration

Ralph supports an optional config file at `.ralph/ralph.config` for repo-level defaults. Settings follow a strict precedence order:

```
CLI flags  >  env vars  >  config file  >  built-in defaults
```

### Config File (`.ralph/ralph.config`)

A simple `key=value` file. Comments (`#`) and blank lines are allowed.

```txt
# .ralph/ralph.config — repo-level defaults
agentCommand=opencode run --agent build
feedbackCommands=npm run build,npm test,npm run lint
baseBranch=main
maxStuck=3
```

Supported keys:

| Key                    | Description                                                                | Default               | Validation                            |
| ---------------------- | -------------------------------------------------------------------------- | --------------------- | ------------------------------------- |
| `agentCommand`         | Full CLI invocation prefix for the AI agent                                | _(none)_              | Non-empty                             |
| `feedbackCommands`     | Shell commands to run after each change (comma-separated)                  | _(none)_              | Comma-separated, each entry non-empty |
| `baseBranch`           | Branch to create work branches from                                        | `main`                | Non-empty, single token               |
| `mode`                 | Run mode: `pr` (create branch + PR) or `direct` (commit on current branch) | `pr`                  | `pr` or `direct`                      |
| `maxStuck`             | Consecutive no-progress iterations before aborting                         | `3`                   | Positive integer                      |
| `iterationTimeout`     | Seconds before killing a hung agent invocation                             | `0` (off)             | Non-negative integer                  |
| `promptMode`           | How file refs are passed to the agent: `auto`, `at-path`, or `inline`      | `auto`                | `auto`, `at-path`, or `inline`        |
| `issueSource`          | Issue source to pull from (`none` or `github`)                             | `none`                | `none` or `github`                    |
| `issueLabel`           | Label to filter GitHub issues by                                           | `ralphai`             | Non-empty                             |
| `issueInProgressLabel` | Label applied when an issue is picked up                                   | `ralphai:in-progress` | Non-empty                             |
| `issueRepo`            | `owner/repo` override (auto-detected from remote)                          | _(auto-detect)_       | Any value                             |
| `issueCloseOnComplete` | Close the issue when the plan completes                                    | `true`                | `true` or `false`                     |
| `issueCommentProgress` | Comment on the issue during the run                                        | `true`                | `true` or `false`                     |

The `agentCommand` is the full CLI invocation prefix — Ralph appends the prompt as a quoted argument. Examples:

| Agent CLI   | `agentCommand` value             |
| ----------- | -------------------------------- |
| OpenCode    | `opencode run --agent build`     |
| Claude Code | `claude -p`                      |
| Codex       | `codex exec`                     |
| Gemini CLI  | `gemini -p`                      |
| Aider       | `aider --message`                |
| Goose       | `goose run -t`                   |
| Kiro        | `kiro-cli chat --no-interactive` |
| Amp         | `amp -x`                         |

When `feedbackCommands` is configured, the agent prompt includes the specific commands (e.g. "Run all feedback loops: npm run build, npm test, npm run lint"). When absent, the prompt uses a generic fallback: "Run your project's build, test, and lint commands."

Unknown keys are logged as a warning and ignored. Invalid values for known keys cause an immediate error with file path, line number, and a description of the problem.

The config file is optional. When absent, built-in defaults are used.

### Env Var Overrides

Environment variables override config file values:

| Env Var                         | Overrides              |
| ------------------------------- | ---------------------- |
| `RALPH_AGENT_COMMAND`           | `agentCommand`         |
| `RALPH_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPH_BASE_BRANCH`             | `baseBranch`           |
| `RALPH_MODE`                    | `mode`                 |
| `RALPH_MAX_STUCK`               | `maxStuck`             |
| `RALPH_ITERATION_TIMEOUT`       | `iterationTimeout`     |
| `RALPH_PROMPT_MODE`             | `promptMode`           |
| `RALPH_ISSUE_SOURCE`            | `issueSource`          |
| `RALPH_ISSUE_LABEL`             | `issueLabel`           |
| `RALPH_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPH_ISSUE_REPO`              | `issueRepo`            |
| `RALPH_ISSUE_CLOSE_ON_COMPLETE` | `issueCloseOnComplete` |
| `RALPH_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

```bash
RALPH_AGENT_COMMAND='claude -p' RALPH_MAX_STUCK=5 npx ralphai run -- 5
```

### CLI Flag Overrides

CLI flags have the highest priority:

| Flag                                | Overrides              |
| ----------------------------------- | ---------------------- |
| `--agent-command=<command>`         | `agentCommand`         |
| `--feedback-commands=<list>`        | `feedbackCommands`     |
| `--base-branch=<branch>`            | `baseBranch`           |
| `--direct`                          | `mode` (sets `direct`) |
| `--pr`                              | `mode` (sets `pr`)     |
| `--max-stuck=<n>`                   | `maxStuck`             |
| `--iteration-timeout=<seconds>`     | `iterationTimeout`     |
| `--prompt-mode=<mode>`              | `promptMode`           |
| `--issue-source=<source>`           | `issueSource`          |
| `--issue-label=<label>`             | `issueLabel`           |
| `--issue-in-progress-label=<label>` | `issueInProgressLabel` |
| `--issue-repo=<owner/repo>`         | `issueRepo`            |
| `--issue-close-on-complete=<bool>`  | `issueCloseOnComplete` |
| `--issue-comment-progress=<bool>`   | `issueCommentProgress` |

```bash
npx ralphai run -- 5 --agent-command='claude -p' --base-branch=develop --max-stuck=5
```

### Verifying Config (`--show-config`)

Use `--show-config` to inspect resolved settings and their sources without running anything:

```bash
npx ralphai run -- --show-config
```

Output shows each setting's resolved value and where it came from (default, config file, env var, or CLI flag). This is useful for debugging precedence issues.

```bash
# Verify env var overrides config file
RALPH_AGENT_COMMAND='codex exec' npx ralphai run -- --show-config

# Verify CLI overrides everything
RALPH_AGENT_COMMAND='codex exec' npx ralphai run -- --show-config --agent-command='claude -p'
```

### Feature Branch Workflow

Ralph supports working on a feature branch using direct mode. This is useful for large features that require multiple plans/sub-tasks before they're ready for `main`.

**Setup:**

1. Create your feature branch manually: `git checkout -b feature/big-thing main`
2. Run Ralph in direct mode on the feature branch:

```bash
npx ralphai run -- 5 --direct
```

Or via `.ralph/ralph.config`:

```txt
baseBranch=feature/big-thing
mode=direct
```

**What happens:**

1. Ralph commits directly on `feature/big-thing` (no sub-branches)
2. When all plans are done, you manually open a PR from `feature/big-thing` to `main`

Alternatively, use the default PR mode with `--base-branch=feature/big-thing` to create `ralph/*` sub-branches that open PRs against the feature branch.

### Group Mode (Multi-Plan Branches)

Group mode lets multiple plans execute sequentially on a single shared branch and produce a single PR. Add `group: <name>` to the YAML frontmatter of each plan in the group:

```yaml
---
group: user-authentication
---
```

All plans sharing the same `group:` value will:

- Run sequentially on a single `ralph/<group-name>` branch (e.g. `ralph/user-authentication`)
- Produce a single PR (created as **draft** after the first plan, marked **ready** when all plans complete)
- Respect `depends-on` ordering within the group

**PR lifecycle:**

1. **First plan completes** — branch is pushed, draft PR created via `gh pr create --draft`
2. **Each subsequent plan completes** — PR body updated with cumulative progress (completed/remaining plans, commit log)
3. **Last plan completes** — PR marked ready for review via `gh pr ready`, `.group-state` cleaned up

**Failure handling:**

- If a group plan gets stuck or exhausts its iterations, the branch is pushed and a draft PR is created/updated with a failure note
- `.group-state` is preserved so `--resume` can recover from where the group left off
- Remaining group plans are not attempted after a failure

**When to use groups:**

- Feature work that naturally splits into sequential phases
- When you want a single reviewable PR but small, focused plans for the AI agent
- When you want to AFK while multiple plans are completed

**When NOT to use groups:**

- Independent plans that don't need to be on the same branch
- Plans that can run in parallel (groups are sequential)

See [PLANNING.md](PLANNING.md) for full `group:` frontmatter documentation and examples.

### GitHub Issues Integration

Ralph can automatically pull work from GitHub Issues when the backlog is empty. Issues labeled with a configurable label are converted to plan files, executed, and then closed on completion.

**Prerequisites:** The [`gh` CLI](https://cli.github.com/) must be installed and authenticated (`gh auth login`). If `gh` is not available, Ralph silently skips issue pulling and continues normally.

**Enable it** by setting `issueSource=github` in `.ralph/ralph.config`:

```txt
issueSource=github
```

Or via env var or CLI flag:

```bash
RALPH_ISSUE_SOURCE=github npx ralphai run -- 5
npx ralphai run -- 5 --issue-source=github
```

**How it works:**

1. When `detect_plan()` finds an empty backlog and `issueSource=github`, it calls `pull_github_issues()`
2. The oldest open issue with the configured label (default: `ralphai`) is fetched via `gh issue list`
3. A plan file is created in `backlog/` named `gh-<number>-<slugified-title>.md` with YAML frontmatter linking back to the issue:
   ```yaml
   ---
   source: github
   issue: 42
   issue-url: https://github.com/owner/repo/issues/42
   ---
   ```
4. The issue's label is changed from `ralphai` to `ralphai:in-progress`
5. A progress comment is posted on the issue (if `issueCommentProgress=true`)
6. `detect_plan()` re-scans the backlog and picks up the new plan file normally
7. On completion, a comment is posted on the issue and it is closed (if `issueCloseOnComplete=true`)

**Label workflow:**

```
Issue created with label "ralphai"
  → Ralph picks it up → label changed to "ralphai:in-progress"
    → Ralph completes the plan → issue closed with summary comment
```

**Config keys:**

| Key                    | Description                                       | Default               | Validation         |
| ---------------------- | ------------------------------------------------- | --------------------- | ------------------ |
| `issueSource`          | Issue source to pull from (`none` or `github`)    | `none`                | `none` or `github` |
| `issueLabel`           | Label to filter issues by                         | `ralphai`             | Non-empty          |
| `issueInProgressLabel` | Label applied when an issue is picked up          | `ralphai:in-progress` | Non-empty          |
| `issueRepo`            | `owner/repo` override (auto-detected from remote) | _(auto-detect)_       | Any value          |
| `issueCloseOnComplete` | Close the issue when the plan completes           | `true`                | `true` or `false`  |
| `issueCommentProgress` | Comment on the issue during the run               | `true`                | `true` or `false`  |

**Env var overrides:**

| Env Var                         | Overrides              |
| ------------------------------- | ---------------------- |
| `RALPH_ISSUE_SOURCE`            | `issueSource`          |
| `RALPH_ISSUE_LABEL`             | `issueLabel`           |
| `RALPH_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPH_ISSUE_REPO`              | `issueRepo`            |
| `RALPH_ISSUE_CLOSE_ON_COMPLETE` | `issueCloseOnComplete` |
| `RALPH_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

**CLI flag overrides:**

| Flag                                | Overrides              |
| ----------------------------------- | ---------------------- |
| `--issue-source=<source>`           | `issueSource`          |
| `--issue-label=<label>`             | `issueLabel`           |
| `--issue-in-progress-label=<label>` | `issueInProgressLabel` |
| `--issue-repo=<owner/repo>`         | `issueRepo`            |
| `--issue-close-on-complete=<bool>`  | `issueCloseOnComplete` |
| `--issue-comment-progress=<bool>`   | `issueCommentProgress` |

**Repo detection:** When `issueRepo` is empty (default), Ralph auto-detects the `owner/repo` from the `origin` git remote URL. Both SSH (`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo.git`) formats are supported. Set `issueRepo` explicitly if the remote doesn't point to the correct repository.

### Smoke Checks

Use these checks to verify config behavior after changes to `ralph.sh` or `.ralph/ralph.config`:

1. **No config** — Remove or rename `.ralph/ralph.config`. Run `--show-config` and confirm all settings show `(default)`.

2. **Config file only** — Create `.ralph/ralph.config` with custom values (e.g. `agentCommand=claude -p`). Run `--show-config` and confirm settings show `(config)`.

3. **Env var override** — Set an env var (e.g. `RALPH_AGENT_COMMAND='codex exec'`) with a config file present. Run `--show-config` and confirm the env var wins over the config file value.

4. **CLI flag override** — Pass a CLI flag (e.g. `--agent-command='gemini -p'`) with both env var and config file set. Run `--show-config` and confirm the CLI flag wins.

5. **Syntax check** — Run `bash -n .ralph/ralph.sh` to verify the script has no syntax errors.
