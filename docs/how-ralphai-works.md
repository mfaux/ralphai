# How Ralphai Works

Ralphai is a loop that drives your AI coding agent one plan at a time, with
real build/test/lint feedback every cycle.

Back to the [README](../README.md) for setup and quickstart.

## Context Rot

Long AI coding sessions degrade. The model's context window fills up, older
messages get compressed or dropped, and the agent forgets what it already
tried — repeating mistakes and drifting from the goal.

Ralphai avoids this by starting each iteration with a **fresh agent session**
containing only what matters:

- The plan file (what to build)
- A progress log (what was already done)
- Learnings from past mistakes (if any)

Iteration 10 gets exactly the same quality of context as iteration 1.

## Feedback Loop

Each iteration, the agent runs your project's real build, test, and lint
commands — not cached results, not model-generated guesses. The retry
loop is agent-internal: the runner provides the feedback commands in the
prompt, and the agent runs them, fixes errors, and iterates within a
single session.

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
                 │  Commit *  │
                 └─────┬──────┘
                       ▼
                    Next iteration
                 (fresh session)

* In patch mode (--patch), changes are left uncommitted.
```

Feedback commands are auto-detected during `ralphai init` or configured
via `feedbackCommands` in `config.json`.

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

**Tasks** (`### Task N:`) are the top-level work items. Each iteration, the
agent picks the highest-priority incomplete task and works on it.

**Subtasks** (`#### N.M:`) are optional breakdowns within a task. They help
the agent stay focused on smaller steps. The agent completes all subtasks of
a task before moving on.

**One iteration, one task.** Each runner iteration starts a fresh agent
session that works on exactly one task (including its subtasks). This keeps
the context window focused and prevents the agent from context-switching
across unrelated work.

## Stuck Detection

If **N consecutive iterations** produce no new commits, Ralphai aborts. Default
threshold is 3. Configurable via `maxStuck` in `config.json`,
`RALPHAI_MAX_STUCK`, or `--max-stuck`.

The plan stays in `in-progress/<slug>/` so you can inspect and resume.

In **patch mode** (`--patch`), where no commits are created, stuck detection
instead checks whether the working tree changed between iterations. Ralphai
computes a hash of `git diff HEAD` after each iteration. If the diff is identical
across N consecutive iterations, Ralphai aborts. Branch and PR modes continue to
use commit-based detection.

## Continuous Mode

By default, Ralphai stops after one plan. With `--continuous` (or
`continuous: true` in `config.json`), it keeps draining the backlog —
picking the next dependency-ready plan after each completion. All plans
run sequentially on a single branch.

### Without `--pr`

Plans are processed one after another on the current branch. Each plan
gets a fresh progress file. When the backlog is empty,
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

- **Stuck** (N iterations with no commits): Ralphai pushes partial work to the
  continuous branch and exits. The plan stays in `in-progress/<slug>/` for
  inspection and resumption.
- **Branch collision** (branch or PR already exists): the plan is rolled
  back to `backlog/` and skipped.

## Iteration Timeout

Optional per-invocation timeout (`iterationTimeout` in seconds, or
`--iteration-timeout`). If the agent exceeds the limit, it's killed via SIGTERM
and the iteration counts toward the stuck budget. Default: 0 (no timeout).

## Branch Isolation

Three modes:

- **Branch mode** (default, `--branch`): creates a `ralphai/<plan-slug>` branch
  from the base branch, commits all work there. No push, no PR.
- **PR mode** (`--pr`): creates a `ralphai/<plan-slug>` branch from the base
  branch, does all work there, and opens a PR on completion via `gh`. The PR
  body contains the plan's description and a commit log.
- **Patch mode** (`--patch`): works on the current branch, leaves changes
  uncommitted. Refuses to run on `main`/`master`.

PR mode checks for branch collisions (local, remote, open PR) before
starting — collisions skip to the next plan.

## Plan Lifecycle

```
parked/    (ignored by Ralphai)
backlog/  →  in-progress/  →  out/
```

- **`backlog/`** — the queue. Plans are flat `.md` files (e.g., `backlog/my-plan.md`).
  Ralphai picks dependency-ready plans
  (oldest first when multiple are ready).
- **`in-progress/`** — active work. The plan folder contains the plan file,
  `progress.md`, `receipt.txt`, and `agent-output.log` (raw agent stdout/stderr
  with iteration headers). Files stay on interruption for resumption.
- **`out/`** — archive. Plan folders move here when the agent signals completion.

Plans can declare `depends-on` in YAML frontmatter. A plan runs only when
all dependencies are in `out/`.

```md
---
depends-on: [foundation.md, wiring.md]
---
```

### Plan Selection

When Ralphai looks for work, it follows this priority:

1. **In-progress plans first** — if `in-progress/` contains any plan folder,
   Ralphai resumes it (no selection needed).
2. **Backlog selection** — otherwise, Ralphai scans `backlog/` for
   dependency-ready plans (all `depends-on` entries archived in `out/`).
   Plans with unsatisfied dependencies are skipped with a diagnostic
   message showing which dependencies are blocking.
3. **Single ready plan** — auto-selected.
4. **Multiple ready plans** — the first plan in alphabetical order is
   picked. (Ralphai logs how many plans were ready and which one it
   chose.)

Plans are also skipped if their branch or PR already exists (branch
collision) — this prevents conflicts when multiple worktrees or
continuous-mode sessions overlap.

Use `depends-on` frontmatter to control execution order. Without it, plans
run in alphabetical order.

## Receipt Files

When a run starts, Ralphai creates a **receipt file** inside the plan
folder in `pipeline/in-progress/<slug>/`. The receipt is updated after each iteration
and used by `ralphai status` to show progress and diagnostics.

Receipt files are plain text, one `key=value` per line:

```
started_at=2026-03-08T14:22:00Z
source=main
branch=ralphai/dark-mode
slug=dark-mode
plan_file=dark-mode.md
tasks_completed=2
```

### Field Reference

| Field             | Example                   | Meaning                                                          |
| ----------------- | ------------------------- | ---------------------------------------------------------------- |
| `started_at`      | `2026-03-08T14:22:00Z`    | ISO 8601 UTC timestamp of when the run started                   |
| `source`          | `main` / `worktree`       | Whether the run started in the main repo or a worktree           |
| `worktree_path`   | `/home/user/wt/dark-mode` | Absolute path to worktree (only present when `source=worktree`)  |
| `branch`          | `ralphai/dark-mode`       | Git branch the run is on                                         |
| `slug`            | `dark-mode`               | Plan slug (filename minus `.md`)                                 |
| `plan_file`       | `dark-mode.md`            | Source plan filename                                             |
| `tasks_completed` | `2`                       | Number of plan tasks marked complete (parsed from progress file) |

### When to Check Receipts

- **Cross-source conflict** — if `ralphai run` refuses to start because a
  plan is running in a worktree (or vice versa), the receipt shows where
  the run originated (`source`, `worktree_path`, `branch`).
- **Status diagnostics** — `ralphai status` reads receipt files
  automatically. If you need more detail, inspect the receipt directly at
  `~/.ralphai/repos/<id>/pipeline/in-progress/<slug>/receipt.txt`.

After a plan is archived to `out/`, the receipt moves with it.

## Monorepo Scope

In monorepo projects, plans can declare which package they target using `scope` frontmatter:

```md
---
scope: packages/web
---
```

### Workspace Detection

`ralphai init` detects workspace packages from three sources: `pnpm-workspace.yaml` globs, the `workspaces` field in `package.json`, and `.sln` files (which list `.csproj` projects for .NET monorepos). In mixed repos, workspaces from all sources are merged (deduplicated by path). Both `--yes` and interactive modes display the detected workspaces and rely on automatic scope filtering at runtime. The `workspaces` config key is an escape hatch for custom per-package overrides; `init` does not generate it.

### Multi-Ecosystem Detection

When a repository contains markers for multiple ecosystems (e.g., a `.sln` file alongside a `package.json`), Ralphai detects all of them and merges their feedback commands into a single list. The primary ecosystem is the first detected with sufficient substance; secondary ecosystems contribute additional feedback commands.

A bare `package.json` with no lock file, no `scripts`, and no `workspaces` field is treated as a tooling artifact (e.g., used only for `npm install <tool>`) and does not claim Node.js as the primary ecosystem. This prevents stub `package.json` files from masking the real project type in .NET-primary or other non-Node repos.

### Scoped Feedback

When a plan has a scope, the runner rewrites feedback commands to target the scoped package. The mechanism varies by ecosystem:

**Node.js:**

1. **Reads the package name** from `<scope>/package.json`.
2. **Detects the root package manager** by checking for lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` / `bun.lock`, `package-lock.json`).
3. **Rewrites feedback commands** using the PM's workspace filter: `pnpm --filter <name>`, `yarn workspace <name>`, `npm -w <name>`, or `bun --filter <name>`.

**C# / .NET:**

1. **Appends the scope path** to dotnet commands: `dotnet build` becomes `dotnet build <scope>`, `dotnet test` becomes `dotnet test <scope>`.

**Other ecosystems:** Commands pass through unchanged.

**Mixed repos (e.g., Node.js + .NET):** Dotnet commands are scoped regardless of the primary ecosystem. If the scope directory contains a `package.json`, Node.js PM commands are also rewritten. This means a plan scoping to a .NET sub-project in a mixed repo gets `dotnet build <scope>` even when Node.js is the primary ecosystem.

In all cases, the runner **adds a scope hint** to the agent prompt so the agent focuses on files within the scoped directory. Commands that don't match the detected ecosystem (e.g., `make test`) also pass through unchanged.

### Doctor Validation

`ralphai doctor` validates per-workspace feedback commands when a `workspaces` config key exists. Each workspace command runs from the repo root. Failures produce warnings (not hard errors), since the workspace may not be installed yet.

### Status Display

`ralphai status` shows the scope of each plan when declared. Scoped plans display a `scope: <path>` annotation next to the plan name.

### Workspace Overrides

When automatic derivation is insufficient, use the `workspaces` config key in `config.json` to provide explicit per-package feedback commands:

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

Some repos contain Node.js (or other) sub-projects that are not connected to the root by any workspace configuration. Each sub-project has its own lock file and dependency tree. Common examples: an Nx frontend app inside a .NET monorepo, standalone documentation sites, or Playwright E2E test suites.

Automatic scope rewriting uses workspace filters (`npm -w`, `pnpm --filter`), which require the root package manager to know about the sub-project. Independent sub-projects are not discoverable this way, so plans that target them need manual `workspaces` overrides with commands that run from the repo root:

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

The runner will use the overridden feedback commands for that scope instead of the root-level ones.

## Learnings System

Ralphai maintains two files in global state (`~/.ralphai/repos/<id>/`) for learning from mistakes:

- **`LEARNINGS.md`** — rolling anti-repeat memory. The agent reads it before each iteration and applies durable lessons, preferring general rules over narrow anecdotes. Ralphai automatically prunes old entries to keep the most recent 20 (configurable via `maxLearnings` in `config.json` or `RALPHAI_MAX_LEARNINGS`; set to `0` for unlimited).
- **`LEARNING_CANDIDATES.md`** — review queue for lessons that may belong in `AGENTS.md` or skill docs. The agent appends candidates here but never edits `AGENTS.md` automatically.

**After runs:** review candidates, promote useful ones, and prune stale learnings entries.

## Progress Extraction

After each iteration, Ralphai scans the agent's output for a `<progress>` block:

```
<progress>
### Task 2: Add validation
**Status:** Complete
Implemented input validation (2.1) and error messages (2.2).
</progress>
```

If found, the content is appended to `progress.md` in the plan's
`in-progress/<slug>/` folder with an iteration header (`### Iteration N`). This
keeps the progress log up to date even when the agent forgets to edit
`progress.md` directly. The prompt instructs the agent to include a
`<progress>` block in every response.
