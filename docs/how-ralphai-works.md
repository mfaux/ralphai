# How Ralphai Works

Ralphai is a loop that drives your AI coding agent one plan at a time, with real build, test, and lint feedback every cycle.

Back to the [README](../README.md) for setup and quickstart.

## Context Rot

Long AI coding sessions degrade. The model's context window fills up, older messages get compressed or dropped, and the agent forgets what it already tried, repeating mistakes and drifting from the goal.

Ralphai avoids this by starting each iteration with a **fresh agent session** containing only what matters:

- the plan file
- a progress log
- context notes from earlier iterations on this plan
- durable learnings from past mistakes

Iteration 10 gets the same quality of context as iteration 1.

## Feedback Loop

Each iteration, the agent runs your project's real build, test, and lint commands. The retry loop is agent-internal: Ralphai provides the feedback commands in the prompt, and the agent runs them, fixes errors, and iterates within a single session.

When a feedback wrapper script (`_ralphai_feedback.sh`) exists in the pipeline state directory, the prompt tells the agent to run the wrapper instead of listing raw commands. The wrapper provides concise output on success and full diagnostics on failure (see [Feedback Wrapper Script](#feedback-wrapper-script) below). When the wrapper is absent (e.g. on Windows), the prompt falls back to listing raw commands directly.

```
    ┌──────────────────────────────────────────────┐
    │              Fresh session                   │
    │   plan + progress log + context + learnings  │
    └──────────────────────┬───────────────────────┘
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

| Tier          | Config key         | When it runs                                    |
| ------------- | ------------------ | ----------------------------------------------- |
| **Loop-tier** | `hooks.feedback`   | Every agent iteration (build, unit tests, lint) |
| **PR-tier**   | `hooks.prFeedback` | Only at the completion gate, before PR creation |

**Loop-tier commands** (`hooks.feedback`) are included in the agent prompt and run every iteration. These should be fast — build, unit tests, and lint. The agent sees their output and fixes failures inline.

**PR-tier commands** (`hooks.prFeedback`) are slower checks like E2E tests or integration suites. They are _not_ included in the agent prompt and do not run during normal iterations. They only execute when the agent signals completion, at which point the completion gate runs both tiers. This avoids burning time on expensive checks every iteration while still ensuring they pass before a PR is created.

Feedback commands are auto-detected during `ralphai init` or configured via `hooks.feedback` and `hooks.prFeedback` in `config.json`. During init, Ralphai detects PR-tier candidates from common script names like `test:e2e`, `test:integration`, `cypress`, and `playwright`.

See [Hooks, Gates, and Prompt Controls](hooks.md) for the full hooks and gate reference.

### Feedback Wrapper Script

When a worktree is created or reused, Ralphai generates a shell script called `_ralphai_feedback.sh` in the WIP slug directory (pipeline state, e.g. `~/.ralphai/repos/<id>/pipeline/in-progress/<slug>/`). This keeps the wrapper out of the user's worktree so it doesn't appear as an untracked file in `git status`. The script wraps each configured loop-tier feedback command to optimize agent output:

- **On success (exit 0):** prints a one-line summary with the command name and wall-clock duration, keeping the agent's context window lean.
- **On failure (non-zero exit):** prints the full stdout/stderr so the agent can diagnose and fix the issue.
- **On timeout:** kills the child process and prints partial output with a timeout message.

The wrapper is regenerated on every run — including resumed runs — so config changes take effect without recreating the worktree. On Windows, wrapper generation is skipped entirely (the prompt falls back to listing raw commands).

When the wrapper exists, the runner passes its absolute path to the prompt module via `wrapperPath`. The agent prompt then tells the agent to run the wrapper by its full path and explains its summary-on-pass / full-output-on-failure behavior. When the wrapper is absent, the prompt lists raw commands as before — this keeps backward compatibility with Windows and any environment where the wrapper is not generated.

The completion gate does **not** use the wrapper — it runs feedback commands directly and collects structured results. The wrapper is purely an agent-side UX optimization.

## Completion Gate

When the agent signals that all tasks are complete, Ralphai runs a **completion gate** before creating a PR. The gate checks:

1. **Task completion** — all plan tasks are marked done in `progress.md`
2. **Loop-tier feedback** — all `hooks.feedback` commands pass
3. **PR-tier feedback** — all `hooks.prFeedback` commands pass
4. **Validators** — all `gate.validators` commands pass (only run when feedback passes)

If any check fails, the gate **rejects** and Ralphai re-invokes the agent with a fresh session that includes the rejection details. PR-tier failures are labeled `[PR-tier]` in the rejection message so the agent knows which commands failed and can fix them.

The gate allows up to `gate.maxRejections` (default 2) consecutive rejections before force-accepting to prevent infinite loops. Set to `0` to never force-accept (mark stuck instead). However, if the plan has **zero tasks completed** out of a non-zero total when the rejection budget is exhausted, the plan is marked **stuck** instead of force-accepted — zero progress indicates the agent failed entirely and should not produce a PR.

Validators (`gate.validators`) are agent-invisible commands that run at the gate after all feedback passes. They are not included in the prompt, so the agent cannot game them. Validator failures are reported in the gate rejection details. See [Hooks, Gates, and Prompt Controls](hooks.md#completion-gate) for the full gate configuration reference.

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
    ┌──────────────────┐
    │   Review pass    │
    │ (if enabled and  │
    │  not yet run)    │
    └────────┬─────────┘
             ▼
       ┌──────────┐       ┌──────────────────────┐
       │ Changes? │──yes─▶│ Re-run gate; reject  │
       └────┬─────┘       │ → re-invoke agent    │
            │ no          └──────────────────────┘
            ▼
    Create/update PR
```

### Review Pass

After the completion gate passes, Ralphai optionally runs a **review pass** — a one-shot agent invocation that performs behavior-preserving simplifications on the changed files. The review pass is enabled by default and can be disabled with `--gate-no-review` or `gate.review: false` in `config.json`.

The review pass:

1. **Detects changed files** — runs `git diff --name-only <baseBranch>...HEAD` and filters out deleted files
2. **Assembles a focused prompt** — lists the changed files (capped at `gate.reviewMaxFiles`, default 25) and instructs the agent to perform behavior-preserving simplifications: dead code removal, redundant logic elimination, unused imports cleanup, and control flow simplification
3. **Invokes the agent** — runs a single agent session with the review prompt; the agent runs feedback commands to verify its changes and commits with a `refactor:` prefix if it makes any changes
4. **Re-runs the gate if changes were made** — if the agent committed simplifications, the completion gate runs again to verify nothing was broken; gate failures follow the normal rejection flow

Key properties:

- **One pass maximum** — the review pass runs at most once per plan, regardless of outcome. If the gate is rejected after review changes, the agent is re-invoked to fix the issue, but the review pass is not repeated.
- **Best-effort** — if the review pass fails (agent error or timeout), Ralphai logs a warning and proceeds to PR creation. The review pass never blocks PR creation.
- **No sentinel tags** — the review prompt is a utility prompt with no completion, learnings, context, or progress sentinels. The agent simply reviews, optionally commits, and exits.
- **Short-circuits on empty diffs** — if no files have changed between the base branch and HEAD, the review pass is skipped entirely.

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
2. Creates or reuses a worktree on a conventional-commit-style branch (`<type>/<slug>`, e.g. `feat/add-dark-mode`)
3. Runs the agent inside that worktree
4. Commits the results there
5. Pushes the branch
6. Opens or updates a **draft PR** when `gh` is available

This keeps your main checkout clean and lets multiple plans run in parallel in separate directories.

Use `ralphai run` directly when you want automation, scripting, or a non-interactive terminal flow.

## Stuck Detection

If **N consecutive iterations** produce no new commits, Ralphai aborts. The default threshold is 3. Configure it with `gate.maxStuck` in `config.json`, `RALPHAI_GATE_MAX_STUCK`, or `--gate-max-stuck`.

Separately, `gate.maxIterations` sets an absolute cap on total runner iterations regardless of progress. When exceeded, the plan is marked stuck. Default is `0` (unlimited). This is independent of `gate.maxStuck`, which only counts zero-progress iterations.

The plan stays in `in-progress/<slug>/` so you can inspect and resume it.

## Drain Mode

By default, `ralphai run` processes a single eligible work unit, then exits. Use `--drain` to keep processing plans sequentially until the queue is empty. Each completed plan gets its own worktree branch and draft PR.

1. **Each completed plan** -> pushes the branch and creates a draft PR
2. **Stuck plans** -> skipped, logged, and reported in the exit summary
3. **Backlog empty** -> Ralphai checks for PRD sub-issues, then regular GitHub issues. Sub-issues labeled with the HITL label (`ralphai-subissue-hitl` by default, configurable via `issue.hitlLabel`) are skipped during auto-drain — they require human attention.
4. **Nothing left** -> exits with a summary: "Completed N, skipped M (stuck)"

Use `--drain` to keep going until no eligible work remains.

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

PRDs (Product Requirements Documents) are the recommended way to drive multi-step features. A PRD is a GitHub issue labeled with the configured PRD label (`ralphai-prd` by default, configurable via `issue.prdLabel`) with sub-issues representing each piece of work.

```bash
ralphai run 42           # reads issue #42's labels to determine dispatch path
ralphai run              # auto-detect: PRD sub-issues are routed through the PRD flow automatically
```

When `ralphai run` (auto-detect, no target) encounters a plan with `prd: N` frontmatter — written by `pullPrdSubIssue()` when pulling GitHub issues — the drain loop detects the PRD parent and delegates to the unified PRD flow. This ensures the same behavior as explicit issue targeting: a single `feat/<prd-slug>` branch, sequential sub-issue processing, and an aggregate PR.

### How it differs from standalone plans

| Aspect         | Standalone plan / issue          | PRD                                         |
| -------------- | -------------------------------- | ------------------------------------------- |
| Branch         | `<type>/<slug>` per plan         | `<type>/<prd-slug>` for the whole PRD       |
| PR             | One draft PR per plan            | One aggregate draft PR for all sub-issues   |
| Stuck handling | Plan is skipped, drain continues | Sub-issue is skipped, PRD continues to next |

### PRD In-Progress Label

When Ralphai begins processing a PRD's sub-issues — either via an explicit `ralphai run 42` or via auto-drain — it adds the shared `in-progress` label to the parent PRD issue. This is best-effort: if the label application fails, processing continues normally.

### PRD Done Label

When all of a PRD's sub-issues have completed successfully (all have the `done` label, none have `stuck` or `in-progress` labels), Ralphai swaps the `in-progress` label for the `done` label on the PRD parent. The PRD is also not marked done while any sub-issues are labeled HITL or are blocked by HITL dependencies. This transition happens in three code paths: the explicit PRD runner after its sub-issue loop, the auto-drain path when no more eligible sub-issues remain, and the early exit path when all sub-issues are already complete on entry.

### Sequencing

Ralphai fetches sub-issues from the GitHub API and processes them in order. Sub-issues can declare dependencies on each other via GitHub's native blocking relationships — Ralphai writes these as `depends-on` frontmatter and respects them during plan selection. Sub-issues labeled with the HITL label are filtered out before sequencing begins — they require human review. Sub-issues whose `depends-on` entries reference a HITL sub-issue are also skipped as blocked.

### Aggregate PR

Per-sub-issue PRs are suppressed. When all sub-issues complete (or are skipped), Ralphai opens a single draft PR with:

- A high-level **Summary** section with agent-generated descriptions of each completed sub-issue
- A `Closes #N` block for the PRD and each completed sub-issue
- A checklist of completed sub-issues
- A checklist of stuck sub-issues (if any)
- A checklist of HITL sub-issues awaiting human review (if any)
- A checklist of sub-issues blocked by HITL dependencies (if any)
- A categorized commit log covering all changes on the branch
- A **Learnings** section with merged, deduplicated learnings from all sub-issue runs (omitted if no learnings were produced)

### Stuck sub-issues

When a sub-issue hits the stuck threshold (default 3 consecutive no-commit iterations, configurable via `gate.maxStuck`), Ralphai skips it and moves to the next sub-issue. The stuck sub-issue is listed in the aggregate PR body so you can address it manually.

### HITL sub-issues

When a sub-issue is labeled with the HITL label (`ralphai-subissue-hitl` by default, configurable via `issue.hitlLabel`), Ralphai skips it before processing begins. These sub-issues require human review — they are not attempted by the automated runner.

Sub-issues that depend on a HITL sub-issue (via `depends-on` frontmatter) are also skipped as blocked. Both HITL and blocked-by-HITL sub-issues are reported in the exit summary and aggregate PR body. The PRD is not marked done while HITL or blocked sub-issues remain.

To resume after human review: remove the HITL label from the sub-issue, then re-run the PRD with `ralphai run <prd-number>`. Already-completed sub-issues are skipped on re-run.

## Iteration Timeout

Use `--gate-iteration-timeout=<seconds>` or `gate.iterationTimeout` in `config.json` to set a per-invocation timeout. If the agent exceeds the limit, Ralphai kills it and the iteration counts toward the stuck budget. The default is `0`, which means no timeout.

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
branch=feat/dark-mode
slug=dark-mode
plan_file=dark-mode.md
tasks_completed=2
```

### Field Reference

| Field             | Example                                   | Meaning                                                         |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `started_at`      | `2026-03-08T14:22:00Z`                    | ISO 8601 UTC timestamp of when the run started                  |
| `worktree_path`   | `/home/user/.ralphai-worktrees/dark-mode` | Absolute path to the managed worktree                           |
| `branch`          | `feat/dark-mode`                          | Git branch the run is on                                        |
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

When a feedback scope is resolved, the agent prompt includes a **scope hint** near the feedback step. The hint tells the agent that the plan's changes are focused in a specific directory and suggests running targeted test commands (e.g. `bun test src/components/`) for faster iteration during development. The hint also advises running the full feedback suite before signaling COMPLETE to ensure nothing outside the scope is broken. This guidance is advisory — the agent still runs the full feedback suite as configured, but can optionally use scoped commands for quicker intermediate checks.

When no feedback scope is available, the scope hint is omitted entirely and prompt behavior is unchanged.

### Doctor Validation

`ralphai doctor` validates per-workspace feedback commands when a `workspaces` config key exists. Failures produce warnings, not hard errors.

### Status Display

`ralphai status` shows the scope of each plan when declared.

### Workspace Overrides

When automatic derivation is insufficient, use the `workspaces` key in `config.json` to provide explicit per-package overrides. Overridable fields: `feedbackCommands`, `prFeedbackCommands`, `validators`, `beforeRun`, `preamble`.

```json
{
  "hooks": {
    "feedback": "pnpm build,pnpm test"
  },
  "workspaces": {
    "packages/web": {
      "feedbackCommands": ["pnpm --filter web build", "pnpm --filter web test"]
    }
  }
}
```

Workspace overrides take precedence over automatic derivation. Plans without a scope use the root-level config unchanged. See [Hooks, Gates, and Prompt Controls](hooks.md#workspace-overrides) for the full workspace reference.

### Independent Sub-Projects

Some repos contain sub-projects that are not connected to the root by workspace configuration. Those plans need manual `workspaces` overrides with commands that run from the repo root:

```json
{
  "hooks": {
    "feedback": "dotnet build,dotnet test"
  },
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

## Context and Learnings (Two-Tier Memory)

Ralphai uses a two-tier memory system to carry information across iterations without polluting the agent's context window.

### Context (session-scoped)

Context captures ephemeral, session-scoped notes: code locations, API surfaces, navigation breadcrumbs, and decisions made during the current plan. The agent includes a `<context>` block in its output each iteration, and Ralphai extracts and re-injects those notes into the next iteration's prompt.

Key properties:

- **Per-plan scope** — context is accumulated only within a single plan's run. When the plan completes or is skipped, the accumulated context is discarded.
- **Not aggregated across sub-issues** — for PRD runs, each sub-issue starts with a blank context slate. Context does not flow from one sub-issue to the next.
- **PR rendering** — context notes appear in per-plan PR bodies as a collapsed `<details>` block, keeping them available for debugging without cluttering the description. Context is omitted from PRD aggregate PR bodies.
- **Config** — controlled by `prompt.context` (default: `true`). Set to `false` to disable context extraction, the `<context>` mandate in the prompt, and PR body rendering.

### Learnings (durable)

Learnings capture durable behavioral lessons: architectural constraints, recurring failure modes, project conventions, and patterns that apply beyond the current plan. The agent includes a `<learnings>` block in its output, and Ralphai extracts and persists entries into subsequent iterations and the PR body.

Key properties:

- **Cross-plan scope** — learnings accumulate across all plans within a runner session. They survive plan boundaries.
- **Aggregated at PRD level** — for PRD runs, learnings from all sub-issue runs are merged and deduplicated into a single `## Learnings` section in the aggregate PR body.
- **PR rendering** — learnings appear as a `## Learnings` heading with bullet points in both per-plan and PRD aggregate PR bodies.
- **Config** — controlled by `prompt.learnings` (default: `true`). Set to `false` to disable learnings extraction, the `<learnings>` mandate in the prompt, and PR body rendering.

### Two-tier comparison

| Aspect          | Context                       | Learnings                    |
| --------------- | ----------------------------- | ---------------------------- |
| Scope           | Per-plan (ephemeral)          | Cross-plan (durable)         |
| Purpose         | Session notes, code locations | Behavioral lessons, patterns |
| PRD aggregation | Not aggregated                | Merged across sub-issues     |
| PR body format  | Collapsed `<details>` block   | `## Learnings` heading       |
| Config key      | `prompt.context`              | `prompt.learnings`           |
| Sentinel tag    | `<context>`                   | `<learnings>`                |

The prompt asks agents to report specific categories of information in their learnings — architectural constraints or patterns observed, error messages encountered with how they were resolved, and behavioral lessons worth applying to future iterations. Context notes should capture session-specific details — file paths discovered, API surfaces explored, and decisions made. The format for both is free-form prose; the categories are guidance, not schema enforcement.

## Docker Sandbox

Ralphai can run agents inside ephemeral Docker containers instead of spawning them as local child processes. The runner's feedback loop, progress extraction, and completion gate work identically — only the process execution layer changes. See [Docker Sandbox](docker.md) for the full execution flow, credential forwarding, and image reference.

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
