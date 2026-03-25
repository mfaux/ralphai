# How Ralphai Works

Ralphai is a loop that drives your AI coding agent one plan at a time, with real build, test, and lint feedback every cycle.

Back to the [README](../README.md) for setup and quickstart.

## Context Rot

Long AI coding sessions degrade. The model's context window fills up, older messages get compressed or dropped, and the agent forgets what it already tried, repeating mistakes and drifting from the goal.

Ralphai avoids this by starting each iteration with a **fresh agent session** containing only what matters:

- the plan file
- a progress log
- learnings from past mistakes

Iteration 10 gets the same quality of context as iteration 1.

## Feedback Loop

Each iteration, the agent runs your project's real build, test, and lint commands. The retry loop is agent-internal: Ralphai provides the feedback commands in the prompt, and the agent runs them, fixes errors, and iterates within a single session.

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
                 ┌────────────┐
                 │   Commit   │
                 └─────┬──────┘
                       ▼
                    Next iteration
                 (fresh session)
```

Feedback commands are auto-detected during `ralphai init` or configured via `feedbackCommands` in `config.json`.

## Plan Structure

A plan file uses Markdown headings to define tasks and optional subtasks:

```markdown
# Plan: Add user auth

## Implementation Tasks

### Task 1: Set up database schema

#### 1.1: Create users table migration

#### 1.2: Add indexes and constraints

### Task 2: Implement login endpoint

### Task 3: Add session middleware
```

**Tasks** (`### Task N:`) are the top-level work items. Each iteration, the agent picks the highest-priority incomplete task and works on it.

**Subtasks** (`#### N.M:`) are optional breakdowns within a task. They help the agent stay focused on smaller steps. The agent completes all subtasks of a task before moving on.

**One iteration, one task.** Each runner iteration starts a fresh agent session that works on exactly one task, including its subtasks.

## Worktree Execution Model

`ralphai run` is the only execution entrypoint. It always runs work inside a managed git worktree.

For a normal run, Ralphai:

1. Picks the next plan from `backlog/` or resumes one from `in-progress/`
2. Creates or reuses a worktree on branch `ralphai/<slug>`
3. Runs the agent inside that worktree
4. Commits the results there
5. Pushes the branch
6. Opens or updates a **draft PR** when `gh` is available

This keeps your main checkout clean and lets multiple plans run in parallel in separate directories.

## Stuck Detection

If **N consecutive iterations** produce no new commits, Ralphai aborts. The default threshold is 3. Configure it with `maxStuck` in `config.json`, `RALPHAI_MAX_STUCK`, or `--max-stuck`.

The plan stays in `in-progress/<slug>/` so you can inspect and resume it.

## Continuous Mode

By default, Ralphai stops after one plan. With `--continuous`, it keeps draining the backlog, picking the next dependency-ready plan after each completion.

In continuous mode, Ralphai uses one long-lived worktree branch:

1. **First completed plan** -> pushes the branch and creates a draft PR
2. **Each later plan** -> keeps working on the same branch and updates the same draft PR
3. **Backlog drained** -> refreshes the draft PR body and leaves it in draft

If the run is interrupted or gets stuck, Ralphai still pushes partial work so the branch and PR reflect the latest progress.

## Iteration Timeout

Use `--iteration-timeout=<seconds>` or `iterationTimeout` in `config.json` to set a per-invocation timeout. If the agent exceeds the limit, Ralphai kills it and the iteration counts toward the stuck budget. The default is `0`, which means no timeout.

## Plan Lifecycle

```
parked/    (ignored by Ralphai)
backlog/  ->  in-progress/  ->  out/
```

- **`backlog/`** -> queue of flat `.md` plans such as `backlog/my-plan.md`
- **`in-progress/`** -> active plan folders containing the plan, `progress.md`, `receipt.txt`, and `agent-output.log`
- **`out/`** -> archived plan folders after completion

Plans can declare `depends-on` in YAML frontmatter. A plan runs only when all dependencies are already archived in `out/`.

```md
---
depends-on: [foundation.md, wiring.md]
---
```

### Plan Selection

When Ralphai looks for work, it follows this priority:

1. **In-progress plans first** -> if `in-progress/` contains a resumable plan, Ralphai resumes it
2. **Backlog selection** -> otherwise, Ralphai scans `backlog/` for dependency-ready plans
3. **Single ready plan** -> auto-selected
4. **Multiple ready plans** -> the first plan in alphabetical order is picked

Plans are also skipped if their branch or PR already exists. That avoids collisions when multiple worktrees or continuous sessions overlap.

## Receipt Files

When a run starts, Ralphai creates a **receipt file** inside `pipeline/in-progress/<slug>/receipt.txt`. The receipt is updated after each iteration and used by `ralphai status` to show progress and diagnostics.

Receipt files are plain text, one `key=value` per line:

```
started_at=2026-03-08T14:22:00Z
worktree_path=/home/user/.ralphai-worktrees/dark-mode
branch=ralphai/dark-mode
slug=dark-mode
plan_file=dark-mode.md
tasks_completed=2
```

### Field Reference

| Field             | Example                                   | Meaning                                                         |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `started_at`      | `2026-03-08T14:22:00Z`                    | ISO 8601 UTC timestamp of when the run started                  |
| `worktree_path`   | `/home/user/.ralphai-worktrees/dark-mode` | Absolute path to the managed worktree                           |
| `branch`          | `ralphai/dark-mode`                       | Git branch the run is on                                        |
| `slug`            | `dark-mode`                               | Plan slug, filename minus `.md`                                 |
| `plan_file`       | `dark-mode.md`                            | Source plan filename                                            |
| `tasks_completed` | `2`                                       | Number of plan tasks marked complete, parsed from `progress.md` |

### When to Check Receipts

- **Worktree ownership** -> if `ralphai run` tells you a plan is already running in a worktree, the receipt shows which worktree owns it
- **Status diagnostics** -> `ralphai status` reads receipts automatically, but you can inspect them directly in `~/.ralphai/repos/<id>/pipeline/in-progress/<slug>/receipt.txt`

After a plan is archived to `out/`, the receipt moves with it.

## Monorepo Scope

In monorepo projects, plans can declare which package they target using `scope` frontmatter:

```md
---
scope: packages/web
---
```

### Workspace Detection

`ralphai init` detects workspace packages from `pnpm-workspace.yaml`, the `workspaces` field in `package.json`, and `.sln` files for .NET monorepos. In mixed repos, workspaces from all sources are merged.

### Multi-Ecosystem Detection

When a repository contains markers for multiple ecosystems, Ralphai detects all of them and merges their feedback commands into one list. A bare `package.json` with no lock file, scripts, or workspaces is treated as a tooling artifact and does not claim Node.js as the primary ecosystem.

### Scoped Feedback

When a plan has a scope, the runner rewrites feedback commands to target that scoped package.

**Node.js**

1. Reads the package name from `<scope>/package.json`
2. Detects the root package manager from lockfiles
3. Rewrites feedback commands using the package manager's workspace filter

**C# / .NET**

1. Appends the scope path to dotnet commands

**Other ecosystems**

Commands pass through unchanged.

In all cases, Ralphai adds a scope hint to the prompt so the agent focuses on files within the scoped directory.

### Doctor Validation

`ralphai doctor` validates per-workspace feedback commands when a `workspaces` config key exists. Failures produce warnings, not hard errors.

### Status Display

`ralphai status` shows the scope of each plan when declared.

### Workspace Overrides

When automatic derivation is insufficient, use the `workspaces` key in `config.json` to provide explicit per-package feedback commands:

```json
{
  "feedbackCommands": ["pnpm build", "pnpm test"],
  "workspaces": {
    "packages/web": {
      "feedbackCommands": ["pnpm --filter web build", "pnpm --filter web test"]
    }
  }
}
```

Workspace overrides take precedence over automatic derivation. Plans without a scope use the top-level feedback commands unchanged.

### Independent Sub-Projects

Some repos contain sub-projects that are not connected to the root by workspace configuration. Those plans need manual `workspaces` overrides with commands that run from the repo root:

```json
{
  "feedbackCommands": ["dotnet build", "dotnet test"],
  "workspaces": {
    "ui": {
      "feedbackCommands": ["cd ui && npm run build", "cd ui && npm test"]
    },
    "docs": {
      "feedbackCommands": ["cd docs && npm run build"]
    }
  }
}
```

Then target the sub-project from a plan's frontmatter:

```yaml
---
scope: ui
---
```

## Learnings System

Ralphai maintains two files in global state at `~/.ralphai/repos/<id>/`:

- **`LEARNINGS.md`** -> rolling anti-repeat memory read before each iteration
- **`LEARNING_CANDIDATES.md`** -> review queue for lessons that may belong in `AGENTS.md` or skill docs

Ralphai automatically prunes `LEARNINGS.md` to the most recent 20 entries by default. Configure that with `maxLearnings`, or set it to `0` for unlimited.

## Progress Extraction

After each iteration, Ralphai scans the agent's output for a `<progress>` block:

```
<progress>
### Task 2: Add validation
**Status:** Complete
Implemented input validation (2.1) and error messages (2.2).
</progress>
```

If found, the content is appended to `progress.md` in `in-progress/<slug>/` with an iteration header. This keeps the progress log updated even when the agent forgets to edit `progress.md` directly.
