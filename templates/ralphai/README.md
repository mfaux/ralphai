# .ralphai/ — Autonomous Task Runner

Ralphai drives an AI coding agent to implement tasks from plan files.

## Quick Start

```bash
ralphai run              # run with defaults (5 turns per plan)
ralphai run --turns=3    # 3 turns per plan
ralphai run --turns=0    # unlimited turns
ralphai run --dry-run    # preview what would happen
ralphai run --resume     # recover dirty state and continue
ralphai run --pr         # create ralphai/* branch and open a PR
ralphai run --help       # show all options
```

## Lifecycle

Plans flow through four directories:

```
wip/ (parked)    backlog/  →  in-progress/  →  out/
```

1. **`wip/`** — Not ready. Ralphai ignores this directory.
2. **`backlog/`** — Queued plans. Ralphai picks dependency-ready plans automatically.
3. **`in-progress/`** — Active work. Plan + `progress.md` live here. Files stay on interruption for resumption.
4. **`out/`** — Archive. Moved here when the agent signals completion.

All pipeline files are **gitignored** (local-only state).

## How It Works

1. Loads config: `ralphai.json` → env vars → CLI flags (highest priority wins)
2. Resumes in-progress work, or picks from backlog (oldest dependency-ready plan first)
3. In PR mode, creates a `ralphai/<plan-slug>` branch. In branch mode (default), works on current branch.
4. Agent receives plan + progress log, implements next task, runs feedback commands, commits
5. Repeats until done or stuck. On completion, archives to `out/` and (in PR mode) opens a PR.

**No file arguments needed.** Ralphai auto-detects what to work on.

**Stuck detection:** Aborts after N consecutive turns with no commits (default: 3).

**Modes:**

- **Branch mode** (default): commits on current branch, refuses `main`/`master`
- **PR mode** (`--pr`): creates `ralphai/*` branch, pushes, opens PR via `gh`
- **Patch mode** (`--patch`): leaves changes uncommitted

**`--resume`:** Auto-commits dirty state on non-base branches and continues. Refuses to auto-commit on the base branch.

**`--dry-run`:** Read-only preview — no file moves, no branches, no agent execution.

## Plan Dependencies

Plans can declare `depends-on` in YAML frontmatter. A plan is runnable only when all dependencies are in `out/`.

```md
---
depends-on: [foundation.md, wiring.md]
---
```

## Issue Linking

Link a plan to a GitHub issue. On completion, Ralphai comments on the issue.

```md
---
source: github
issue: 42
issue-url: https://github.com/owner/repo/issues/42
---
```

Requires `gh` CLI. If `gh` is unavailable, hooks are silently skipped.

## Files

| File / Directory        | Purpose                             |
| ----------------------- | ----------------------------------- |
| `README.md`             | This file                           |
| `PLANNING.md`           | Guide for writing plan files        |
| `LEARNINGS.md`          | Auto-written learnings (local-only) |
| `LEARNING_CANDIDATES.md` | Candidate lessons for human review  |
| `pipeline/wip/`         | Parked plans                        |
| `pipeline/backlog/`     | Queued plans                        |
| `pipeline/in-progress/` | Active plans + progress.md          |
| `pipeline/out/`         | Completed plans archive             |

## Conventions

### Commit Messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): description`, `fix: ...`, `refactor: ...`, `test: ...`, `docs: ...`, `chore: ...`

### AGENTS.md Updates

Only update `AGENTS.md` when a task produces knowledge that future agents need and cannot easily infer from code — e.g. new CLI commands, non-obvious constraints, changed workflows.

### CHANGELOG.md

Do **not** edit `CHANGELOG.md` unless explicitly asked.

## Learnings

Ralphai maintains two local-only files:

- **`LEARNINGS.md`** — rolling anti-repeat memory. The agent reads it each turn and applies durable lessons.
- **`LEARNING_CANDIDATES.md`** — review queue for lessons that may belong in `AGENTS.md` or skill docs. The agent never edits `AGENTS.md` automatically.

After runs: review candidates, promote useful ones, and prune stale learnings entries.

## Configuration

Settings resolve: **CLI flags > env vars > `ralphai.json` > defaults**.

```json
{
  "agentCommand": "claude -p",
  "feedbackCommands": ["npm run build", "npm test", "npm run lint"],
  "baseBranch": "main",
  "maxStuck": 3
}
```

| Key                    | Default               | Description                            |
| ---------------------- | --------------------- | -------------------------------------- |
| `agentCommand`         | _(none)_              | CLI prefix for the AI agent            |
| `feedbackCommands`     | _(none)_              | Commands to run after each change      |
| `baseBranch`           | `main`                | Branch to create work branches from    |
| `mode`                 | `direct`              | `direct`, `pr`, or `patch`             |
| `autoCommit`           | `false`               | Auto-commit after each turn            |
| `turns`                | `5`                   | Turns per plan (0 = unlimited)         |
| `maxStuck`             | `3`                   | No-progress turns before aborting      |
| `turnTimeout`          | `0`                   | Seconds before killing agent (0 = off) |
| `promptMode`           | `auto`                | `auto`, `at-path`, or `inline`         |
| `continuous`           | `false`               | Keep processing after first plan       |
| `issueSource`          | `none`                | `none` or `github`                     |
| `issueLabel`           | `ralphai`             | Label to filter issues                 |
| `issueInProgressLabel` | `ralphai:in-progress` | Label when issue is picked up          |
| `issueRepo`            | _(auto-detect)_       | `owner/repo` override                  |
| `issueCommentProgress` | `true`                | Comment on issue during run            |

All keys have corresponding `RALPHAI_*` env vars and CLI flags. Run `ralphai run --help` for the full list.

### Agent Commands

| Agent       | `agentCommand`                   |
| ----------- | -------------------------------- |
| Claude Code | `claude -p`                      |
| OpenCode    | `opencode run --agent build`     |
| Codex       | `codex exec`                     |
| Gemini CLI  | `gemini -p`                      |
| Aider       | `aider --message`                |
| Goose       | `goose run -t`                   |
| Kiro        | `kiro-cli chat --no-interactive` |
| Amp         | `amp -x`                         |

> Only **Claude Code** and **OpenCode** have been validated end-to-end.
