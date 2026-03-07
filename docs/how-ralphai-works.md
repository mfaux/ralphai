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

By default, Ralphai stops after one plan. With `--continuous`, it keeps
draining the backlog — picking the next dependency-ready plan after each
completion.

In **PR mode** (`--continuous --pr`), a single draft PR is created after the
first plan. Each subsequent plan updates the PR body. The PR is marked ready
for review when the backlog is drained. If a plan fails mid-session, Ralphai
pushes partial work and exits.

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
  (LLM-selected when multiple are ready).
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

## Learnings System

Ralphai logs mistakes to `.ralphai/LEARNINGS.md` (gitignored) during runs
and reads it each turn to avoid repeating errors.

**After runs:** review entries, merge duplicates, and promote durable
lessons to `AGENTS.md` or skill docs.
