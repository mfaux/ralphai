# Architecture

Ralphai is a CLI tool that picks plan files from a backlog and drives an AI coding agent to implement them, one at a time, with branch isolation, feedback loops, and stuck detection.

## Entry points

| File             | Role                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`     | Process entry point. Parses top-level args and calls `runRalphai`.                                                   |
| `src/ralphai.ts` | Main dispatcher. Routes subcommands, runs the interactive wizard, scaffolds `init`/`update`, and orchestrates `run`. |

## Core loop

| File                    | Role                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/runner.ts`         | The agent feedback loop. Iterates: invoke agent, check for commits, run feedback commands, detect stuck, handle completion and PR creation. |
| `src/plan-detection.ts` | Plan file discovery, frontmatter parsing, dependency resolution, and next-plan selection.                                                   |
| `src/prompt.ts`         | Builds the prompt passed to the agent each iteration.                                                                                       |
| `src/progress.ts`       | Tracks iteration progress and task completion.                                                                                              |

## Feature modules

| File                   | Role                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `src/parse-options.ts` | CLI argument parsing and option types (`RalphaiOptions`, `RalphaiSubcommand`, etc.). |
| `src/git-helpers.ts`   | Low-level git utilities: repo detection, base branch detection, stderr extraction.   |
| `src/doctor.ts`        | `ralphai doctor` -- health checks and diagnostics.                                   |
| `src/status.ts`        | `ralphai status` -- pipeline state rendering with optional auto-refresh.             |
| `src/seed.ts`          | `ralphai seed` -- sample plan management.                                            |

## Worktree subsystem (`src/worktree/`)

Worktree logic is split into focused sub-modules, re-exported through a barrel (`index.ts`).

| File                         | Role                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/worktree/types.ts`      | Shared interfaces: `WorktreeEntry`, `SelectedWorktreePlan`, `GitHubFallbackOptions`.                  |
| `src/worktree/parsing.ts`    | Parses `git worktree list --porcelain` output; filters ralphai-managed branches.                      |
| `src/worktree/selection.ts`  | Plan selection priority logic for worktree runs (in-progress > backlog > attended > GitHub fallback). |
| `src/worktree/management.ts` | Worktree creation, cleanup, setup commands, and `ralphai worktree` subcommand dispatch.               |

## Supporting modules

| File                       | Role                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `src/config.ts`            | Config file resolution, CLI arg merging, validation.               |
| `src/show-config.ts`       | `--show-config` output formatting.                                 |
| `src/issues.ts`            | GitHub issue pulling, slug generation.                             |
| `src/labels.ts`            | Label derivation from base label names (`deriveLabels()`).         |
| `src/label-lifecycle.ts`   | Centralized label transitions (pull, done, stuck, reset, PRD).     |
| `src/prd-discovery.ts`     | PRD issue discovery and sub-issue routing.                         |
| `src/pr-lifecycle.ts`      | PR creation after plan completion.                                 |
| `src/pr-description.ts`    | PR body generation (summary, learnings).                           |
| `src/receipt.ts`           | Completion receipt parsing and source checking.                    |
| `src/frontmatter.ts`       | YAML frontmatter extraction (`scope`, `depends-on`, etc.).         |
| `src/pipeline-state.ts`    | Gathers backlog/in-progress/completed counts for status display.   |
| `src/project-detection.ts` | Auto-detects project type, feedback commands, workspaces.          |
| `src/target-detection.ts`  | Resolves run targets from CLI args (plan slug, issue number, PRD). |
| `src/global-state.ts`      | Pipeline directory resolution and repo registry.                   |
| `src/git-ops.ts`           | Higher-level git operations: commit hashing, branch checks.        |
| `src/learnings.ts`         | Learnings extraction and persistence across iterations.            |
| `src/process-utils.ts`     | Child process helpers.                                             |
| `src/utils.ts`             | Terminal color constants and shared formatting utilities.          |
| `src/ipc-server.ts`        | IPC server for agent communication.                                |
| `src/ipc-protocol.ts`      | IPC message types and socket path resolution.                      |
| `src/self-update.ts`       | `ralphai update` self-update logic.                                |

## Dependency direction

```
cli.ts
  -> ralphai.ts  (dispatcher, wizard, scaffold, run orchestration)
       -> parse-options.ts, git-helpers.ts, seed.ts       (leaf utilities)
       -> doctor.ts, status.ts                            (subcommand handlers)
       -> worktree/index.ts -> parsing, selection, management
       -> runner.ts -> plan-detection.ts, prompt.ts, progress.ts
       -> config.ts, issues.ts, receipt.ts, ...           (supporting modules)
```

Modules import from leaf utilities and supporting modules. `ralphai.ts` is the root dispatcher; `types.ts`, `git-helpers.ts`, and `utils.ts` are leaves with no intra-project imports.

## Where to add new code

- **New CLI subcommand:** Add a case to the dispatcher switch in `ralphai.ts`, implement the command in a new module, and re-export the entry function.
- **New worktree behavior:** Add to the appropriate `src/worktree/` sub-module, or create a new one and re-export through `index.ts`.
- **New feedback or iteration logic:** Modify `src/runner.ts`.
- **New plan selection or dependency logic:** Modify `src/plan-detection.ts`.
- **New config key:** Add to `src/config.ts` and update `docs/cli-reference.md`.
