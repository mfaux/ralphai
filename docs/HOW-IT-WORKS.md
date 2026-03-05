# How ralphai Works

Ralph is a loop that drives your AI coding agent one plan at a time, on an
isolated branch, with real build/test/lint feedback every cycle. This page
explains the mechanics behind that loop.

Back to the [README](../README.md) for setup and quickstart.

## Context Rot

When you use an AI coding agent in a long session, the conversation history
grows. Every model has a fixed-size "context window" — the amount of text it
can consider at once. Once the conversation exceeds that window, the agent may
apply **context compression** by automatically summarizing or condensing
older messages to free up space for new ones. Unlike simple truncation,
compression actively rewrites your earlier conversation into shorter summaries.
Nuance gets lost. Specific decisions become vague references. Code you
discussed in detail gets reduced to a one-line note.

The result: the model forgets what it already tried, repeats mistakes, or
invents things that contradict earlier work.

This is **context rot**. The longer a session runs, the less reliable the agent
becomes — not because the model is bad, but because its view of the
conversation has been quietly rewritten underneath it.

Ralph avoids context rot by design. Each iteration starts a **fresh agent
session** with only the information that matters:

- The plan file (what to build)
- The current state of the repo (what exists right now)
- Build/test/lint output from the previous iteration (what's broken)
- A progress log (what was already done)

Iteration 50 gets exactly the same quality of context as iteration 1. No
accumulated history, no summarization artifacts, no drift.

## Feedback Loop

After every iteration, Ralph runs your project's real build, test, and lint
commands — not cached results, not model-generated guesses.

The output from these commands is fed back to the agent in the next iteration's
prompt. This means the agent always works against ground truth:

1. Agent makes changes and commits
2. Ralph runs the configured feedback commands (e.g. `npm run build`, `npm test`)
3. Any errors become part of the next iteration's prompt
4. The agent reads the errors and fixes them

This loop keeps the agent grounded. Instead of drifting based on stale
assumptions, it reacts to actual project state every cycle.

Feedback commands are auto-detected during `ralphai init` or can be configured
manually via `feedbackCommands` in `.ralph/ralph.config`. When configured, the
agent prompt includes the specific commands. When absent, the prompt uses a
generic fallback: "Run your project's build, test, and lint commands."

## Stuck Detection

Sometimes an agent gets stuck — making changes that don't compile, going in
circles, or producing empty commits. Ralph watches for this.

If **N consecutive iterations** produce no new commits, Ralph aborts the run.
The default threshold is 3, meaning: if the agent fails to commit anything
useful three times in a row, Ralph stops burning tokens and leaves the work
in `in-progress/` for you to inspect.

The threshold is configurable:

- **Config file:** `maxStuck=5` in `.ralph/ralph.config`
- **Env var:** `RALPH_MAX_STUCK=5`
- **CLI flag:** `--max-stuck=5`

When a run is aborted due to stuck detection, the plan and progress files stay
in `.ralph/in-progress/`. You can resume with `npx ralphai run` after
investigating what went wrong — or adjust the plan and try again.

## Branch Isolation

All work happens on isolated `ralph/*` branches, never directly on `main` or
your working branch.

**Branch naming:** The branch name is derived from the plan filename.
`prd-add-dark-mode.md` becomes `ralph/add-dark-mode`. The `ralph/` prefix
keeps automated work visually separate from human branches.

**Collision detection:** Before creating a branch, Ralph checks whether it
already exists locally, on the remote, or has an open PR. If a collision is
found, the plan is skipped and Ralph moves to the next one.

**On completion**, Ralph operates in one of two modes:

- **PR mode** (default): Ralph pushes the `ralph/*` branch and creates a PR
  via the `gh` CLI, with the plan content and commit log in the PR body.
  The `gh` CLI is validated at startup before any agent work begins.
- **Direct mode** (`--direct`): Ralph commits on the current branch. No
  branch creation, no PR. Refuses to run on `main`/`master` — you must
  be on a feature branch.

**Feature branch workflow:** For large features spanning multiple plans,
use direct mode on a feature branch (`git checkout -b feature/big-thing`
then `npx ralphai run -- 5 --direct`). When all plans are done, you
manually open a PR from the feature branch to `main`.

**Safety guards:**

- Ralph blocks on dirty working state by default; `--resume` auto-commits
  dirty changes only on `ralph/*` branches
- `--resume` refuses to auto-commit on `main` or `master`
- Direct mode (`--direct`) refuses to run on `main` or `master`
- Dry-run mode (`--dry-run`) is completely read-only — no file moves, branch
  creation, or agent execution

## Plan Lifecycle

Plans flow through four directories inside `.ralph/`:

```
wip/        (work in progress — Ralph ignores these)
backlog/    --> in-progress/ --> out/
```

1. **`wip/`** (work in progress) — Plans that aren't ready yet. Ralph never looks here. Use it
   for ideas that need more thought, external prerequisites, or human review.
   Move to `backlog/` when ready.

2. **`backlog/`** — The queue. Ralph picks dependency-ready plans automatically.
   When multiple plans are ready, an LLM call selects the best one based on
   dependencies, risk, and value. The chosen plan is moved to `in-progress/`.

3. **`in-progress/`** — Active work. The plan file and `progress.txt` live here
   while Ralph is working. If a run is interrupted or exhausts its iterations,
   files stay here so work can be resumed.

4. **`out/`** — Archive. Plans and progress logs are moved here only when the
   agent signals completion.

**Plan dependencies:** Plans can declare `depends-on` in their YAML
frontmatter. A plan is only runnable when all its dependencies are archived in
`out/`. Plans without `depends-on` are always considered ready.

```md
---
depends-on: [prd-a.md, prd-b.md]
---
```

**GitHub Issues integration:** When the backlog is empty and `issueSource=github`
is configured, Ralph can pull labeled GitHub issues and convert them into plan
files automatically. See the [operational docs](../.ralph/README.md) for
details.

**File tracking:** Plan files in `backlog/`, `in-progress/`, and `out/` are
gitignored (local-only state). Only `.gitkeep` files are tracked. Moving files
between lifecycle stages requires no git commits.

## Learnings System

Ralph uses a two-tier learnings flow to capture mistakes and prevent them from
recurring — without polluting your commit history.

**Tier 1: `.ralph/LEARNINGS.md`** (gitignored, local-only)

The agent writes mistakes and lessons here during autonomous runs. Ralph reads
this file at the start of each iteration so it doesn't repeat past errors.
This file is never committed — it's ephemeral, per-machine state.

**Tier 2: `LEARNINGS.md`** (repo root, tracked)

Human-curated learnings with lasting value. Ralph reads this file for context
but never writes to it. The project maintainer reviews `.ralph/LEARNINGS.md`
after runs and promotes useful entries here.

**Review workflow after runs:**

1. Check `.ralph/LEARNINGS.md` for new entries
2. Compact findings — merge duplicates, drop one-off noise
3. Promote durable guidance to the appropriate place:
   - `AGENTS.md` (or equivalent) for immediate repo-specific agent behavior
   - Skill/reusable docs for stable patterns worth reusing across tasks or repos
4. Add concise, high-signal takeaways to repo-level `LEARNINGS.md`

This separation keeps the tracked `LEARNINGS.md` clean (no agent noise) and
prevents auto-written entries from interfering with stuck detection (which
counts commits).
