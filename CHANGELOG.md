# Changelog

## 0.7.1

### Fixes

- Use repo-owner namespace for GHCR Docker images (#364)

## 0.7.0

**Breaking** — This release includes major structural changes. If upgrading from an earlier version, uninstall first:

```sh
ralphai uninstall && npm install -g ralphai@latest
```

### Breaking

- **Turns model replaced with tasks/subtasks** — the `--turns` flag and `turns` config key are removed. The runner now loops per-task until all tasks are complete, with stuck detection as the only safety stop. Plans use `#### N.M:` headings for subtasks.
- **`taskTimeout` renamed to `iterationTimeout`** — the config key, CLI flag (`--iteration-timeout`), and environment variable (`RALPHAI_ITERATION_TIMEOUT`) all use the new name.
- **Local `.ralphai/` directory removed** — config has migrated to global state (`~/.ralphai/`). Per-repo `ralphai.json` is no longer read from a local `.ralphai/` directory. (#112)
- **Managed worktrees are the only execution path** — branch mode and direct mode are removed. All runs use managed worktrees. (#128)
- **Deprecated features, shims, and migration guidance removed** — all v0.4/v0.5-era compatibility shims have been dropped. (#244)
- **GitHub label taxonomy replaced** — the unified `ralphai` label has been replaced with standalone/subissue/PRD label types, then further consolidated from 12 per-family suffixed labels to 6 shared state labels. Run `ralphai init` to recreate labels. (#299, #315)

### Features

- **Ink-based TUI dashboard** — `ralphai` (no arguments) now launches a full terminal UI with list + overlay layout, focus-highlighted panels, animated spinners, word-wrapping, agent output persistence, and keyboard navigation. Includes repo bar, elapsed time, and GitHub issue views with pull & run actions. (#115–#127, #335)
- **PRD workflow** — `ralphai prd <number>` drives a parent GitHub issue through its sub-issue task list. Auto-detects single PRD issues in `--continuous` mode. Adds `--prd=N` flag, `ralphai-prd` label, PRD-driven branch naming, and PR creation for PRD parents. (#155–#160, #237, #253)
- **Human-in-the-Loop (HITL) sub-issue support** — pause autonomous execution and request human input on specific sub-issues. (#342)
- **Docker sandboxing** — optional `--docker` flag runs the agent inside a container for isolated execution. (#351)
- **Feedback wrapper and scoped feedback** — a wrapper script captures and routes feedback per-scope, with richer iteration guidance. Two-tier feedback commands split loop-time checks from PR-time checks. (#324, #334)
- **Completion gate** — verifies agent COMPLETE claims by re-running feedback commands before accepting task completion. (#307)
- **Conventional commit branch names** — branch names and PR titles are derived from the plan's conventional commit type. (#305, #361)
- **Agent-generated PR summaries** — PR descriptions now include agent-written summaries with categorized commits and diffstat. (#106, #184)
- **Learnings in PR body** — learnings are captured in a PR body section instead of standalone files. (#193)
- **Global state module** — repo identity and config live in `~/.ralphai/` with repo registration. Adds `ralphai repos` command. (#108, #109)
- **`ralphai check`** — config/setup detection with `--capability` flag for scripting. (#153, #154)
- **`ralphai uninstall`** — clean removal of Ralphai from a repo. (#111)
- **`ralphai backlog-dir`** — prints the backlog directory path for scripting. (#110)
- **`--plan` flag** — target a specific backlog plan by name. (#107)
- **`setupCommand` config** — run a custom command (e.g., dependency install) when creating worktrees. (#158)
- **GitHub integration default** — `ralphai init` enables GitHub integration by default, with all labels configurable. (#268, #269)
- **Wizard mode for init** — guided setup with progressive disclosure. (#262)
- **Close child issues on PR merge** — adds `ralphai:done` label on issue completion. (#177)
- **TypeScript runner** — runner orchestration ported from shell to TypeScript. (#103)
- **Skills shipped with CLI** — planning and TDD skills are bundled alongside `ralphai-planning`. (#362)
- **Strict one-iteration-one-task execution** — each runner iteration works on exactly one plan task (including its subtasks). (#242)
- **.NET monorepo support** — `ralphai init` parses `.sln` files to discover `.csproj` projects; mixed-repo detection merges feedback commands from multiple ecosystems. (#97, #98)

### Fixes

- **PR body uses plan description** — PR bodies contain the plan description and commit log instead of raw plan content.
- **Nonce-stamped agent sentinels** — completion and metadata extraction require per-iteration nonces to prevent false signals.
- Prevent IPC socket path truncation on long plan slugs (#325)
- Auto-clean stale and zombie repo entries on startup (#229, #327)
- Prevent shell metacharacter corruption in PR body (#308)
- Fix auto-detect drain putting all issues on a single branch (#240)
- Pull GitHub issues before exiting when backlog is empty (#235, #236)
- Prevent PRD runner from re-pulling completed sub-issues (#228)
- Reject PRD issues with no sub-issue task list (#227)
- Initialize missing resume progress logs (#202)
- Close agent stdin to prevent hang (#105)
- Respect `--dry-run` flag before creating worktrees (#96)
- Fix TUI subprocess timeout and dashboard rendering (#133, #136, #344)
- Dry-run fails to detect GitHub issues with SSH host aliases (#145)

### Refactors

- Decompose monolithic `ralphai.ts`, `runner.ts`, and `issues.ts` into feature modules (#243)
- Migrate test suite from vitest to bun:test (#171)
- Remove external tool deps (jq, sha256sum, sed, timeout) for cross-platform portability (#93)
- Speed up test suite with DI-based exec mock, in-process CLI, and parallel isolated runs (#316, #317)

### Docs

- Document PRD workflow across all docs (#255)
- Add Testing section to AGENTS.md (#326)

## 0.6.0

### Breaking

- **Flat-only backlog plans** — plans in `pipeline/backlog/` must be flat `.md` files (for example `backlog/my-plan.md`). The slug-folder format (`backlog/<slug>/<slug>.md`) is no longer supported in the backlog. The runner creates slug folders automatically when promoting a plan to `in-progress/`. (#84)

### Features

- **Monorepo scope awareness** — plans can declare `scope: <path>` in YAML frontmatter to target a specific package. The runner derives scoped feedback commands from pnpm `--filter`, yarn `workspace`, npm `-w`, or bun `--filter`. A `workspaces` config key provides per-package overrides. (#86)
- **Monorepo init and doctor integration** — `ralphai init` detects workspace packages from `pnpm-workspace.yaml` and `package.json` workspaces. `ralphai doctor` validates workspace feedback commands. `ralphai status` shows scope for backlog and in-progress plans. (#87)
- **Auto-detect installed agent in `--yes` mode** — `ralphai init --yes` now probes for installed agents (Claude Code, OpenCode, etc.) instead of hardcoding OpenCode. Falls back to OpenCode with a helpful message when no agent is found. (#88)
- **Grouped plan artifacts** — plan artifacts (receipt, progress, worktree) are now grouped per plan for simpler lifecycle moves through the pipeline. (#83)
- **Learning candidates file and auto-pruning** — new `LEARNING_CANDIDATES.md` template queues potential learnings for curation. Learnings auto-prune to the most recent entries when exceeding `maxLearnings` (default 20, configurable via `ralphai.json` or `RALPHAI_MAX_LEARNINGS`). (#82)

### Fixes

- **Init wizard no longer asks patch-mode users about auto-commit** — patch mode now consistently means "leave changes uncommitted" during setup. Advanced users can still enable `autoCommit` later through config or CLI flags. (#81)
- **Diff-hash stuck detection in patch mode** — patch mode never creates commits, so commit-based stuck detection always triggered false aborts. Now uses working-tree diff hashing (`sha256` of `git diff HEAD`) to detect actual progress. (#88)
- Handle zero-count task progress in patch mode (#80)

### Docs

- Restructure README for faster onboarding (#79)
- Fix branch mode description, expand reset section, reorganize CLI reference (#88)

### Chores

- Switch default package manager from pnpm to bun (#89)

## 0.5.0

### Features

- **Gitignore `ralphai.json` by default** — each developer's workflow config is personal. Teams that want shared config can use `ralphai init --shared` to keep `ralphai.json` tracked. Init now adds `ralphai.json` to `.gitignore` alongside `.ralphai/`.
- **Symlink `ralphai.json` into worktrees** — `ralphai worktree` symlinks `ralphai.json` from the main repo into the worktree, so config is available without committing it. This extends the existing `.ralphai/` symlink pattern. (#67)
- **Runner config fallback for manual worktrees** — the runner resolves `ralphai.json` from the main repo when running in a manually-created worktree without the symlink.
- **`ralphai purge`** — deletes all archived pipeline artifacts in `pipeline/out/`. Supports `--yes`/`-y` to skip confirmation, consistent with reset and teardown. (#75)
- **`ralphai doctor`** — validates your setup in one shot with 9 diagnostic checks: `.ralphai/` exists, `ralphai.json` valid, git repo detected, working tree clean, base branch exists, agent command in PATH, feedback commands run, backlog has plans, and no orphaned receipts. (#71)
- **Sample plan in init wizard** — `ralphai init` now offers to create a `hello-world.md` sample plan in the backlog, reducing friction for first-time users. Included by default with `--yes`. (#70)
- **AGENTS.md setup in init wizard** — `ralphai init` now offers to create or update `AGENTS.md` with a Ralphai section, so coding agents discover Ralphai outside of autonomous runs. Skips the prompt if the section already exists. Included by default with `--yes`. (#78)
- **Deterministic plan selection** — replaced LLM-based plan selection with oldest-first ordering, eliminating token cost and non-deterministic behavior. (#71)

### Fixes

- Remove duplicate completion comment on linked GitHub issues and unlabel `ralphai:in-progress` on task completion (#68)
- Auto-clean orphaned worktree directories and improve error messages (#70)
- Eliminate temp dir collisions causing flaky CI failures by using `mkdtempSync` (#73)

### Refactors

- Rename `uninstall` command to `teardown` — clearer inverse of `init` without implying global uninstall (#74)
- Remove `issueCloseOnComplete` config — dead code path removed from shell config, CLI args, TypeScript scaffold, and docs (#68)
- Remove `maxStuck` from init wizard — still configurable via `ralphai.json`, `--max-stuck` flag, or `RALPHAI_MAX_STUCK` env var (#73)
- Remove per-plan agent override feature — speculative and undocumented (#71)
- Split monolithic test file into 8 focused test files (#72)
- Polish CLI help text and flag handling (#71)

### Removed

- Removed "ralphai.json is not committed" warning — no longer applicable since config is gitignored by default and symlinked into worktrees.

## 0.4.2

### Fixes

- Warn when `ralphai.json` is uncommitted before worktree creation (#66)

## 0.4.1

### Docs

- Streamline docs — 57% line reduction across README, how-ralphai-works, worktrees, and templates (#65)
- Add CLI reference doc (#65)

## 0.4.0

**Breaking** — This release includes structural changes. If upgrading from an earlier version, teardown first:

```sh
npx ralphai teardown && npm install -g ralphai@latest
```

### Features

- **Workflow modes** — replaced direct/pr modes with branch/pr/patch for clearer intent (#56)
- **`ralphai status`** — shows turns remaining and lists completed plan file names (#54, #58)
- **`ralphai reset`** — new command to clear pipeline state (#44)
- **`--turns` flag** — replaced positional turns argument with explicit `--turns=<n>` flag (#45)
- **`turns` config key** — promote `turns` to a top-level config key with all defaults in `ralphai.json`; expand init wizard (#53)
- **Receipt tasks tracking** — add `tasks_completed` field to receipt files and fix status task count (#49)

### Fixes

- Restrict batch task count regex to heading lines only to prevent false matches (#59)
- Parallel worktree plan selection and per-plan progress files (#55)
- Use `.ralphai` gitignore pattern to match symlinks in worktrees (#52)
- Exclude `.ralphai` from dirty-state check and force-clean on reset (#47)
- Replace git-tracked `.ralphai` dir with symlink in worktrees (#46)

### Refactors

- **JSON config** — convert config to `ralphai.json` at repo root with `autoCommit` option; gitignore `.ralphai/` dir (#48, #50)
- **Modular config.sh** — refactor `config.sh` into focused modules with shared validation helpers (#60)
- **Flexible plan naming** — remove `prd-` naming convention, use `plan_file` field in receipts (#64)
- Remove fallback agent rotation feature (#62)

### Docs

- Thorough documentation review (#57)
- Document unlimited turns, tested agents, and turn pacing (#51)
- Restructure AGENTS.md with dogfooding section and learnings (#61)

## 0.3.0

**Breaking** — This release includes structural changes. If upgrading from an earlier version, teardown first:

```sh
npx ralphai teardown && npm install -g ralphai@latest
```

### Features

- **Worktree subcommand** — `ralphai worktree` runs a plan in an isolated git worktree with `list` and `clean` management commands (#41)
- **Worktree-aware runner** — auto-detects git worktrees and adapts branch strategy, PR creation, and CLI suggestions accordingly (#39)
- **Continuous single-branch mode** — replaced group mode with a simpler continuous + PR single-branch workflow (#38)
- **~~Fallback agent rotation~~** — removed; stuck detection now aborts cleanly instead of rotating agents
- **Real-time streaming output** — runner streams agent output in real time on Unix (#36)
- **Self-update command** — `ralphai update` with background update notifications (#30)
- **Direct mode safety guard** — shows copy-pasteable `git checkout` command when direct mode blocks on main/master (#33)
- **Single-plan default** — direct mode now stops after one plan by default (#34)

### Fixes

- Resolve bundled runner path for built `run` command (#32)
- Use async spawn on Windows/MSYS to prevent swallowed output in Git Bash (#27)
- Add extra newline after git suggestions for readability

### Refactors

- Rename all internal `ralph` references to `ralphai` for consistency (#28)
- Rename `progress.txt` to `progress.md` (#37)
- Simplify CLI, bundle scripts, consolidate to single-file learnings (#29)
- Clean up templates structure, remove stale `sync-ralphai` (#31)

## 0.2.1

### Fixes

- Use inherited stdio for `run` command to show real-time output (#25)
- Grant `contents:write` permission so publish workflow can create GitHub releases (#24)

## 0.2.0

### Features

- **Group mode** — plans can now be grouped for coordinated execution with shared branch strategy, draft PR lifecycle, and failure handling (#15, #16, #17)
- **Prompt adapter layer** — agent-specific formatting so each agent receives optimally structured prompts (#12)
- **Safe by default** — PR mode is now the default instead of auto-merge (#10)
- **Default iterations-per-plan** — defaults to 5 when omitted, so plans no longer require an explicit limit (#9)
- **Modular `ralphai.sh`** — split into sourced library modules for easier maintenance and extension (#21)

### Fixes

- Allow `ralphai.sh` to run without arguments (#11)
- Fix `npx ralphai run` to work without arguments (#6)
- Add execute permission to `bin/cli.mjs` (#8)
- Add jiti for Windows build compatibility (#5)

### Refactors

- Rename `plans/` to `plan-types/` and nest lifecycle dirs under `pipeline/` (#20)
- Rename `drafts/` to `parked/` (#13)
- Add `sync-ralphai` script for dogfooding template changes (#19)
- Refactor publish workflow for version bump handling (#4)

### Docs

- README DX overhaul — scannable for dual audience (#7)
- Split plan templates and add TOC router (#18)
- Add skateboarding principle and vertical-slice task ordering (#14)
- Fix directory count and plan selection wording (#22)

## 0.1.0 — Initial Release

Put your AI coding agent on autopilot.

Ralph takes plan files from a backlog and drives any CLI-based coding agent to implement them — with branch isolation, feedback loops, and stuck detection baked in.

### Highlights

- **`npx ralphai init`** — interactive wizard scaffolds `.ralphai/` into your project, auto-detects package manager and build/test/lint scripts
- **Plan-based workflow** — write plans in `.ralphai/pipeline/backlog/`, Ralphai picks them up, creates branches, and loops your agent through build/test/lint cycles
- **8 agent presets** — OpenCode, Claude Code, Codex, Gemini CLI, Aider, Goose, Kiro, Amp
- **Branch isolation** — every plan runs on a `ralphai/<plan-name>` branch
- **Stuck detection** — aborts after N iterations with no progress (default: 3)
- **Auto-PR** — opens PRs for protected branches, merges directly otherwise
- **Resume support** — `--resume` picks up where you left off
- **Dry-run mode** — `--dry-run` previews what Ralphai would do without touching anything
- **GitHub Issues integration** — optionally pulls labeled issues when the backlog is empty
- **Plan dependencies** — `depends-on` field for ordering across a backlog
- **Learnings loop** — two-tier system for logging and curating lessons across runs
- **Update, sync & teardown** — `ralphai update` self-updates the CLI; `ralphai sync` refreshes templates; `ralphai teardown` cleans up
