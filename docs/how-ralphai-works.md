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

### Two-Tier Feedback Commands

Ralphai supports two tiers of feedback commands:

| Tier          | Config key           | When it runs                                    |
| ------------- | -------------------- | ----------------------------------------------- |
| **Loop-tier** | `feedbackCommands`   | Every agent iteration (build, unit tests, lint) |
| **PR-tier**   | `prFeedbackCommands` | Only at the completion gate, before PR creation |

**Loop-tier commands** (`feedbackCommands`) are included in the agent prompt and run every iteration. These should be fast — build, unit tests, and lint. The agent sees their output and fixes failures inline.

**PR-tier commands** (`prFeedbackCommands`) are slower checks like E2E tests or integration suites. They are _not_ included in the agent prompt and do not run during normal iterations. They only execute when the agent signals completion, at which point the completion gate runs both tiers. This avoids burning time on expensive checks every iteration while still ensuring they pass before a PR is created.

Feedback commands are auto-detected during `ralphai init` or configured via `feedbackCommands` and `prFeedbackCommands` in `config.json`. During init, Ralphai detects PR-tier candidates from common script names like `test:e2e`, `test:integration`, `cypress`, and `playwright`.

### Feedback Wrapper Script

When a worktree is created or reused, Ralphai generates a shell script called `_ralphai_feedback.sh` in the worktree root. This script wraps each configured loop-tier feedback command to optimize agent output:

- **On success (exit 0):** prints a one-line summary with the command name and wall-clock duration, keeping the agent's context window lean.
- **On failure (non-zero exit):** prints the full stdout/stderr so the agent can diagnose and fix the issue.
- **On timeout:** kills the child process and prints partial output with a timeout message.

The wrapper is regenerated on every `prepareWorktree()` call — including reused worktrees — so config changes take effect without recreating the worktree. On Windows, wrapper generation is skipped entirely (the prompt slice handles the fallback).

The completion gate does **not** use the wrapper — it runs feedback commands directly and collects structured results. The wrapper is purely an agent-side UX optimization.

## Completion Gate

When the agent signals that all tasks are complete, Ralphai runs a **completion gate** before creating a PR. The gate checks:

1. **Task completion** — all plan tasks are marked done in `progress.md`
2. **Loop-tier feedback** — all `feedbackCommands` pass
3. **PR-tier feedback** — all `prFeedbackCommands` pass

If any check fails, the gate **rejects** and Ralphai re-invokes the agent with a fresh session that includes the rejection details. PR-tier failures are labeled `[PR-tier]` in the rejection message so the agent knows which commands failed and can fix them.

```
    Agent signals COMPLETE
              ▼
    ┌──────────────────┐
    │ Completion gate  │
    │  - task count    │
    │  - loop-tier     │
    │  - PR-tier       │
    └────────┬─────────┘
             ▼
       ┌──────────┐       ┌──────────────────────┐
       │ Passed?  │──no──▶│ Re-invoke agent with │
       └────┬─────┘       │ rejection details    │
            │ yes         └──────────────────────┘
            ▼
    Create/update PR
```

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

**One iteration, one task.** Each runner iteration starts a fresh agent session that works on exactly one task, including its subtasks. If the next task in the plan is trivially small, the agent may continue to it within the same iteration — this avoids burning a full context-reset cycle on minor follow-ups. The agent still signals COMPLETE normally when the next task is substantial.

## Worktree Execution Model

For most people, `ralphai` is the main entrypoint. The TUI lets you browse plans, inspect progress, and launch runs interactively.

Under the hood, `ralphai run` is the headless execution command. It always runs work inside a managed git worktree, whether you invoke it directly or trigger a run from the TUI.

For a normal run, Ralphai:

1. Picks the next plan from `backlog/` or resumes one from `in-progress/`
2. Creates or reuses a worktree on branch `ralphai/<slug>` (or `feat/<prd-slug>` for PRD-driven runs)
3. Runs the agent inside that worktree
4. Commits the results there
5. Pushes the branch
6. Opens or updates a **draft PR** when `gh` is available

This keeps your main checkout clean and lets multiple plans run in parallel in separate directories.

Use `ralphai run` directly when you want automation, scripting, or a non-interactive terminal flow.

## Stuck Detection

If **N consecutive iterations** produce no new commits, Ralphai aborts. The default threshold is 3. Configure it with `maxStuck` in `config.json`, `RALPHAI_MAX_STUCK`, or `--max-stuck`.

The plan stays in `in-progress/<slug>/` so you can inspect and resume it.

## Drain Mode

By default, `ralphai run` drains the backlog — processing plans sequentially until the queue is empty. Each plan gets its own worktree branch and draft PR.

1. **Each completed plan** -> pushes the branch and creates a draft PR
2. **Stuck plans** -> skipped, logged, and reported in the exit summary
3. **Backlog empty** -> Ralphai checks for PRD sub-issues, then regular GitHub issues
4. **Nothing left** -> exits with a summary: "Completed N, skipped M (stuck)"

Use `--once` to process a single work unit and exit instead of draining.

## Label-Driven Dispatch

When you run `ralphai run <number>`, Ralphai fetches the issue's labels from GitHub and classifies it into one of three dispatch families:

| Label family         | Dispatch behavior                                                        |
| -------------------- | ------------------------------------------------------------------------ |
| `ralphai-standalone` | Create a dedicated `feat/<slug>` branch and single-issue PR              |
| `ralphai-subissue`   | Discover parent PRD, fold into the PRD's shared `feat/<prd-slug>` branch |
| `ralphai-prd`        | Discover sub-issues, process sequentially on a shared branch             |

If no recognized label is found, Ralphai exits with an error and guidance to add the appropriate label. The old unified `ralphai` label is not recognized (hard cutover).

Both the family label (e.g. `ralphai-standalone`) and the shared `in-progress` label can be present simultaneously — classification only checks for the family label, so re-running an issue that's already in progress works correctly.

### Validation rules

Before processing, Ralphai validates the dispatch classification to catch misconfigurations early:

- **Standalone + has parent PRD** — skip with warning (suggests using the subissue label instead)
- **Sub-issue + no parent PRD** — skip with warning (orphaned sub-issue)
- **Sub-issue + parent lacks PRD label** — skip with warning (parent needs `ralphai-prd` label)

## PRD Execution Model

PRDs (Product Requirements Documents) are the recommended way to drive multi-step features. A PRD is a GitHub issue labeled with the configured PRD label (`ralphai-prd` by default, configurable via `prdLabel`) with sub-issues representing each piece of work.

```bash
ralphai run 42           # reads issue #42's labels to determine dispatch path
ralphai run              # auto-detect: PRD sub-issues are routed through the PRD flow automatically
```

When `ralphai run` (auto-detect, no target) encounters a plan with `prd: N` frontmatter — written by `pullPrdSubIssue()` when pulling GitHub issues — the drain loop detects the PRD parent and delegates to the unified PRD flow. This ensures the same behavior as explicit issue targeting: a single `feat/<prd-slug>` branch, sequential sub-issue processing, and an aggregate PR.

### How it differs from standalone plans

| Aspect         | Standalone plan / issue          | PRD                                         |
| -------------- | -------------------------------- | ------------------------------------------- |
| Branch         | `ralphai/<slug>` per plan        | `feat/<prd-slug>` for the whole PRD         |
| PR             | One draft PR per plan            | One aggregate draft PR for all sub-issues   |
| Stuck handling | Plan is skipped, drain continues | Sub-issue is skipped, PRD continues to next |

### PRD In-Progress Label

When Ralphai begins processing a PRD's sub-issues — either via an explicit `ralphai run 42` or via auto-drain — it adds the shared `in-progress` label to the parent PRD issue. This is best-effort: if the label application fails, processing continues normally.

### PRD Done Label

When all of a PRD's sub-issues have completed successfully (all have the `done` label, none have `stuck` or `in-progress` labels), Ralphai swaps the `in-progress` label for the `done` label on the PRD parent. This transition happens in three code paths: the explicit PRD runner after its sub-issue loop, the auto-drain path when no more eligible sub-issues remain, and the early exit path when all sub-issues are already complete on entry.

### Sequencing

Ralphai fetches sub-issues from the GitHub API and processes them in order. Sub-issues can declare dependencies on each other via GitHub's native blocking relationships — Ralphai writes these as `depends-on` frontmatter and respects them during plan selection.

### Aggregate PR

Per-sub-issue PRs are suppressed. When all sub-issues complete (or are skipped), Ralphai opens a single draft PR with:

- A `Closes #N` block for the PRD and each completed sub-issue
- A checklist of completed sub-issues
- A checklist of stuck sub-issues (if any)
- A categorized commit log covering all changes on the branch

### Stuck sub-issues

When a sub-issue hits the stuck threshold (default 3 consecutive no-commit iterations), Ralphai skips it and moves to the next sub-issue. The stuck sub-issue is listed in the aggregate PR body so you can address it manually.

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

When a GitHub issue has native blocking relationships (configured via GitHub's "Blocked by" feature), the generated plan file automatically includes a `depends-on` field using issue-based dependency slugs (e.g. `gh-42`). These blocking relationships are queried via the `Issue.blockedBy` GraphQL API. The slugs are matched against plan files by issue number prefix, so `gh-42` resolves to any plan file like `gh-42-add-dark-mode.md`.

### Plan Selection

When Ralphai looks for work, it follows this priority:

1. **In-progress plans first** -> if `in-progress/` contains a resumable plan, Ralphai resumes it
2. **Backlog selection** -> otherwise, Ralphai scans `backlog/` for dependency-ready plans
3. **Single ready plan** -> auto-selected
4. **Multiple ready plans** -> the first plan in alphabetical order is picked

Plans are also skipped if their branch or PR already exists. That avoids collisions when multiple worktrees or parallel sessions overlap.

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

### Feedback Scope

Feedback scope narrows the directory context for feedback hints in the agent prompt. It is resolved from two sources, with explicit frontmatter taking precedence:

1. **Frontmatter** — `feedback-scope: <path>` in the plan's YAML frontmatter.
2. **Auto-detection** — if no frontmatter is present, Ralphai parses the `## Relevant Files` markdown section, extracts file paths, and computes their longest common parent directory.

When files span unrelated directories (no common parent), or when no `## Relevant Files` section exists, no feedback scope is inferred.

```md
---
feedback-scope: src/components
---
```

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

Ralphai accumulates learnings in memory during each run. The agent includes a `<learnings>` block in its output, and Ralphai extracts and persists entries into the PR body for review. Learnings are also injected into subsequent iterations as anti-repeat memory.

The prompt asks agents to report specific categories of information in their learnings — file paths modified or discovered, exported APIs and their signatures, architecture constraints or patterns observed, and error messages encountered with how they were resolved. The format remains free-form prose; the categories are guidance, not schema enforcement. Vague or empty learnings still work — the guidance is best-effort.

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
