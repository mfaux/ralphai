# Architecture

Ralphai is a CLI tool that picks plan files from a backlog and drives an AI coding agent to implement them, one at a time, with branch isolation, feedback loops, and stuck detection.

## Entry points

| File             | Role                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`     | Process entry point. Parses top-level args, launches the Ink TUI (no args + TTY), or calls `runRalphai`.             |
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

## TUI subsystem (`src/tui/`)

The Ink-based interactive TUI launched by `ralphai` (no subcommand) in a TTY. Built on React/Ink with a screen-router pattern: `App` manages which screen is visible, dispatches actions, and handles transitions.

| File / Directory             | Role                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/tui/run-tui.tsx`        | TUI entry point. Mounts the Ink app, installs terminal safety handlers, returns CLI args on exit.                                    |
| `src/tui/app.tsx`            | Screen router. Wires data hooks, dispatches actions to screens, handles exit-to-runner handoff.                                      |
| `src/tui/types.ts`           | Core types: `ActionType`, `Screen`, `DispatchResult`, `RunConfig`, and confirm/options wiring helpers.                               |
| `src/tui/menu-items.ts`      | Pure data layer. Builds menu items from pipeline state with groups (START, MANAGE, TOOLS) and hotkeys.                               |
| `src/tui/terminal-safety.ts` | Crash recovery. Installs handlers for SIGINT, SIGTERM, uncaughtException, unhandledRejection to restore terminal state.              |
| `src/tui/color-support.ts`   | Bridges `NO_COLOR` env var to chalk's level system before Ink mounts.                                                                |
| `src/tui/screens/`           | Full-screen views: `menu`, `confirm`, `options`, `backlog-picker`, `issue-picker`, `stop`, `reset`, `status`, `doctor`, `clean`.     |
| `src/tui/components/`        | Reusable UI components: `selectable-list`, `checkbox-list`, `detail-pane`, `header`, `split-layout`, `text-input`.                   |
| `src/tui/hooks/`             | Data hooks: `use-pipeline-state` (async pipeline gathering), `use-github-issues` (issue count peek), `use-terminal-size` (SIGWINCH). |

## Interactive data layer (`src/interactive/`)

Pure data helpers and the `@clack/prompts`-based config wizard, shared between the TUI and CLI flows. The old interactive menu loop has been removed; what remains is data and wizard logic.

| File                                     | Role                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/interactive/run-actions.ts`         | Menu item builders for run actions (label, hint, disabled state). Consumed by `src/tui/menu-items.ts`.          |
| `src/interactive/pipeline-actions.ts`    | Menu item builders for pipeline actions, plus plan filters (`stalledPlans`, `runningPlans`, `resettablePlans`). |
| `src/interactive/github-issues.ts`       | GitHub issue fetching, display list construction, and data types for the issue picker.                          |
| `src/interactive/wizard-options.ts`      | Wizard option descriptors and `selectionsToFlags()` helper.                                                     |
| `src/interactive/run-wizard.ts`          | `@clack/prompts`-based config wizard for `ralphai run --wizard`. Used by `ralphai.ts`.                          |
| `src/interactive/maintenance-actions.ts` | `ExitIntercepted` sentinel class for test infrastructure.                                                       |

## Worktree subsystem (`src/worktree/`)

Worktree logic is split into focused sub-modules, re-exported through a barrel (`index.ts`).

| File                         | Role                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/worktree/types.ts`      | Shared interfaces: `WorktreeEntry`, `SelectedWorktreePlan`, `GitHubFallbackOptions`.                  |
| `src/worktree/parsing.ts`    | Parses `git worktree list --porcelain` output; filters ralphai-managed branches.                      |
| `src/worktree/selection.ts`  | Plan selection priority logic for worktree runs (in-progress > backlog > attended > GitHub fallback). |
| `src/worktree/management.ts` | Worktree creation, cleanup, setup commands, and `ralphai worktree` subcommand dispatch.               |

## Supporting modules

| File                       | Role                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `src/config.ts`            | Config file resolution, CLI arg merging, validation.                                     |
| `src/show-config.ts`       | `--show-config` output formatting.                                                       |
| `src/issues.ts`            | GitHub issue pulling, slug generation, label fetching, parent discovery, HITL filtering. |
| `src/issue-dispatch.ts`    | Label-driven dispatch classification and validation for issue targets.                   |
| `src/labels.ts`            | Shared state label constants (`in-progress`, `done`, `stuck`).                           |
| `src/label-lifecycle.ts`   | Centralized label transitions (pull, done, stuck, reset, PRD).                           |
| `src/prd-discovery.ts`     | PRD issue discovery and sub-issue routing.                                               |
| `src/pr-lifecycle.ts`      | PR creation after plan completion.                                                       |
| `src/pr-description.ts`    | PR body generation (summary, learnings).                                                 |
| `src/receipt.ts`           | Completion receipt parsing and source checking.                                          |
| `src/frontmatter.ts`       | YAML frontmatter extraction (`scope`, `depends-on`, etc.).                               |
| `src/pipeline-state.ts`    | Gathers backlog/in-progress/completed counts for status display.                         |
| `src/project-detection.ts` | Auto-detects project type, feedback commands, workspaces.                                |
| `src/target-detection.ts`  | Resolves run targets from CLI args (plan slug, issue number, PRD).                       |
| `src/global-state.ts`      | Pipeline directory resolution and repo registry.                                         |
| `src/git-ops.ts`           | Higher-level git operations: commit hashing, branch checks.                              |
| `src/learnings.ts`         | Learnings extraction and persistence across iterations.                                  |
| `src/sentinel.ts`          | Nonce-aware sentinel detection for agent output (completion, extraction).                |
| `src/completion-gate.ts`   | Verifies agent COMPLETE claims before accepting plan completion.                         |
| `src/feedback-wrapper.ts`  | Generates `_ralphai_feedback.sh` wrapper script for agent-side feedback.                 |
| `src/process-utils.ts`     | Child process helpers.                                                                   |
| `src/utils.ts`             | Terminal color constants and shared formatting utilities.                                |
| `src/ipc-server.ts`        | IPC server for agent communication.                                                      |
| `src/ipc-protocol.ts`      | IPC message types and socket path resolution.                                            |
| `src/self-update.ts`       | `ralphai update` self-update logic.                                                      |

## Dependency direction

```
cli.ts
  -> ralphai.ts  (dispatcher, wizard, scaffold, run orchestration)
       -> parse-options.ts, git-helpers.ts, seed.ts       (leaf utilities)
       -> doctor.ts, status.ts                            (subcommand handlers)
       -> worktree/index.ts -> parsing, selection, management
       -> runner.ts -> plan-detection.ts, prompt.ts, progress.ts, sentinel.ts
       -> config.ts, issues.ts, receipt.ts, ...           (supporting modules)
  -> tui/run-tui.tsx  (Ink TUI, launched when no subcommand + TTY)
       -> tui/app.tsx -> screens/, components/, hooks/
       -> tui/menu-items.ts -> interactive/run-actions.ts, pipeline-actions.ts
       -> tui/terminal-safety.ts, color-support.ts
```

Modules import from leaf utilities and supporting modules. `ralphai.ts` is the root dispatcher; `types.ts`, `git-helpers.ts`, and `utils.ts` are leaves with no intra-project imports. The `src/tui/` subsystem depends on `src/interactive/` for pure data helpers (menu item builders, plan filters) but not for any interactive prompts.

## Where to add new code

- **New CLI subcommand:** Add a case to the dispatcher switch in `ralphai.ts`, implement the command in a new module, and re-export the entry function.
- **New TUI screen:** Add a screen component in `src/tui/screens/`, add the screen type to `Screen` in `src/tui/types.ts`, and wire it into the screen router in `src/tui/app.tsx`.
- **New TUI menu item:** Add the item to `buildMenuItems()` in `src/tui/menu-items.ts` with a hotkey, add the action type to `ActionType` in `src/tui/types.ts`, and add routing in `resolveAction()`.
- **New worktree behavior:** Add to the appropriate `src/worktree/` sub-module, or create a new one and re-export through `index.ts`.
- **New feedback or iteration logic:** Modify `src/runner.ts`.
- **New plan selection or dependency logic:** Modify `src/plan-detection.ts`.
- **New config key:** Add to `src/config.ts` and update `docs/cli-reference.md`.

## Agent communication protocol

The runner communicates with AI agents through structured XML sentinel tags embedded in agent stdout. A per-plan cryptographic nonce (UUID) is generated by the runner and injected into the agent prompt. The agent must echo this nonce back inside sentinel tags for the runner to recognize them:

- **Completion:** `<promise nonce="UUID">COMPLETE</promise>`
- **Learnings:** `<learnings nonce="UUID">...</learnings>`
- **Progress:** `<progress nonce="UUID">...</progress>`
- **PR summary:** `<pr-summary nonce="UUID">...</pr-summary>`

Bare tags without the correct nonce are ignored. This prevents false positives from tool output (test runners, grep, cat) that happens to contain sentinel strings. The nonce generation and detection logic lives in `src/sentinel.ts`.
