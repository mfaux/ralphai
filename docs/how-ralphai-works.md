# How Ralphai Works

Ralphai is a loop that drives your AI coding agent one plan at a time, with
real build/test/lint feedback every cycle.

Back to the [README](../README.md) for setup and quickstart.

## Context Rot

Long AI coding sessions degrade. The model's context window fills up, older
messages get compressed or dropped, and the agent forgets what it already
tried — repeating mistakes and drifting from the goal.

Ralphai avoids this by starting each turn with a **fresh agent session**
containing only what matters:

- The [plan file](../templates/ralphai/PLANNING.md) (what to build)
- A progress log (what was already done)
- Learnings from past mistakes (if any)

Turn 50 gets exactly the same quality of context as turn 1.

## Feedback Loop

Each turn, the agent runs your project's real build, test, and lint
commands — not cached results, not model-generated guesses.

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

Feedback commands are auto-detected during `ralphai init` or configured
via `feedbackCommands` in `ralphai.json`.

## Stuck Detection

If **N consecutive turns** produce no new commits, Ralphai aborts. Default
threshold is 3. Configurable via `maxStuck` in `ralphai.json`,
`RALPHAI_MAX_STUCK`, or `--max-stuck`.

The plan stays in `in-progress/` so you can inspect and resume.

## Continuous Mode

By default, Ralphai stops after one plan. With `--continuous` (or
`continuous: true` in `ralphai.json`), it keeps draining the backlog —
picking the next dependency-ready plan after each completion. All plans
run sequentially on a single branch.

### Without `--pr`

Plans are processed one after another on the current branch. Each plan
gets a fresh progress file and turn budget. When the backlog is empty,
Ralphai exits. No PR is created — commits stay on the local branch.

### With `--pr` (continuous+PR)

This is the most automated workflow. Ralphai creates a branch, processes
the backlog, and manages a single PR throughout:

1. **First plan completes** — the branch is pushed and a **draft PR** is
   created via `gh`. The PR body lists completed and remaining plans as
   checkboxes, plus a commit log.
2. **Each subsequent plan** — the branch is pushed again and the PR body
   is updated (new checkboxes, updated commit log).
3. **Backlog drained** — the PR body gets a final update and the PR is
   marked **ready for review** via `gh pr ready`.

The PR body looks like:

```markdown
## Completed Plans

- [x] plan-a.md
- [x] plan-b.md

## Remaining Plans

- [ ] plan-c.md

## Commits
```

### Failure handling

- **Stuck** (N turns with no commits): Ralphai pushes partial work to the
  continuous branch and exits. The plan stays in `in-progress/` for
  inspection and resumption.
- **Turn budget exhausted** (completed all turns without the agent
  signaling completion): same behavior — partial work is pushed and
  Ralphai exits.
- **Branch collision** (branch or PR already exists): the plan is rolled
  back to `backlog/` and skipped.

## Turn Timeout

Optional per-invocation timeout (`turnTimeout` in seconds, or
`--turn-timeout`). If the agent exceeds the limit, it's killed via SIGTERM
and the turn counts toward the stuck budget. Default: 0 (no timeout).

## Branch Isolation

Two modes:

- **Branch mode** (default): commits on your current branch. No branch
  creation, no PR. Refuses to run on `main`/`master`.
- **PR mode** (`--pr`): creates a `ralphai/<plan-slug>` branch from the base
  branch, does all work there, and opens a PR on completion via `gh`.

PR mode checks for branch collisions (local, remote, open PR) before
starting — collisions skip to the next plan.

## Plan Lifecycle

```
wip/       (parked — Ralphai ignores)
backlog/  →  in-progress/  →  out/
```

- **`backlog/`** — the queue. Ralphai picks dependency-ready plans
  (oldest first when multiple are ready).
- **`in-progress/`** — active work. Plan + `progress.md` live here. Files
  stay on interruption for resumption.
- **`out/`** — archive. Moved here when the agent signals completion.

Plans can declare `depends-on` in YAML frontmatter. A plan runs only when
all dependencies are in `out/`.

```md
---
depends-on: [foundation.md, wiring.md]
---
```

### Plan Selection

When Ralphai looks for work, it follows this priority:

1. **In-progress plans first** — if `in-progress/` contains a plan file,
   Ralphai resumes it (no selection needed).
2. **Backlog selection** — otherwise, Ralphai scans `backlog/` for
   dependency-ready plans (all `depends-on` entries archived in `out/`).
   Plans with unsatisfied dependencies are skipped with a diagnostic
   message showing which dependencies are blocking.
3. **Single ready plan** — auto-selected.
4. **Multiple ready plans** — the oldest plan by filesystem order is
   picked. (Ralphai logs how many plans were ready and which one it
   chose.)

Plans are also skipped if their branch or PR already exists (branch
collision) — this prevents conflicts when multiple worktrees or
continuous-mode sessions overlap.

Use `depends-on` frontmatter to control execution order. Without it, plans
run in filesystem order (typically alphabetical).

## Receipt Files

When a run starts, Ralphai creates a **receipt file** in
`pipeline/in-progress/` that tracks run metadata. The receipt is updated
after each turn and used by `ralphai status` to show progress and
diagnostics.

Receipt files are plain text, one `key=value` per line:

```
started_at=2026-03-08T14:22:00Z
source=main
branch=ralphai/dark-mode
slug=dark-mode
plan_file=dark-mode.md
turns_budget=5
turns_completed=3
tasks_completed=2
```

### Field Reference

| Field             | Example                           | Meaning                                                          |
| ----------------- | --------------------------------- | ---------------------------------------------------------------- |
| `started_at`      | `2026-03-08T14:22:00Z`            | ISO 8601 UTC timestamp of when the run started                   |
| `source`          | `main` / `worktree`               | Whether the run started in the main repo or a worktree           |
| `worktree_path`   | `/home/user/wt/dark-mode`         | Absolute path to worktree (only present when `source=worktree`)  |
| `branch`          | `ralphai/dark-mode`               | Git branch the run is on                                         |
| `slug`            | `dark-mode`                       | Plan slug (filename minus `.md`)                                 |
| `plan_file`       | `dark-mode.md`                    | Source plan filename                                             |
| `turns_budget`    | `5`                               | Max turns configured for the run (0 = unlimited)                 |
| `turns_completed` | `3`                               | Number of agent turns executed so far                            |
| `tasks_completed` | `2`                               | Number of plan tasks marked complete (parsed from progress file) |
| `outcome`         | `completed` / `stuck` / `timeout` | How the run ended (absent while still running)                   |

### When to Check Receipts

- **Run stopped unexpectedly** — check `turns_completed` vs `turns_budget`
  to see if the turn budget was exhausted, and `outcome` for the reason.
- **Cross-source conflict** — if `ralphai run` refuses to start because a
  plan is running in a worktree (or vice versa), the receipt shows where
  the run originated (`source`, `worktree_path`, `branch`).
- **Status diagnostics** — `ralphai status` reads receipt files
  automatically. If you need more detail, inspect the receipt directly at
  `.ralphai/pipeline/in-progress/receipt-<slug>.txt`.

After a plan is archived to `out/`, the receipt moves with it.

## Learnings System

Ralphai maintains two gitignored files for learning from mistakes:

- **`.ralphai/LEARNINGS.md`** — rolling anti-repeat memory. The agent reads it before each turn and applies durable lessons, preferring general rules over narrow anecdotes. Ralphai automatically prunes old entries to keep the most recent 20 (configurable via `maxLearnings` in `ralphai.json` or `RALPHAI_MAX_LEARNINGS`; set to `0` for unlimited).
- **`.ralphai/LEARNING_CANDIDATES.md`** — review queue for lessons that may belong in `AGENTS.md` or skill docs. The agent appends candidates here but never edits `AGENTS.md` automatically.

**After runs:** review candidates, promote useful ones, and prune stale learnings entries.
