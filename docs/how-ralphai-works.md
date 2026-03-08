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

## Learnings System

Ralphai logs mistakes to `.ralphai/LEARNINGS.md` (gitignored) during runs
and reads it each turn to avoid repeating errors.

**After runs:** review entries, merge duplicates, and promote durable
lessons to `AGENTS.md` or skill docs.
