# Changelog

## 0.5.0 (WIP)

### Features

- **Gitignore `ralphai.json` by default** — each developer's workflow config is personal. Teams that want shared config can use `ralphai init --shared` to keep `ralphai.json` tracked. Init now adds `ralphai.json` to `.gitignore` alongside `.ralphai/`.
- **Symlink `ralphai.json` into worktrees** — `ralphai worktree` symlinks `ralphai.json` from the main repo into the worktree, so config is available without committing it. This extends the existing `.ralphai/` symlink pattern. (#67)
- **Runner config fallback for manual worktrees** — the runner resolves `ralphai.json` from the main repo when running in a manually-created worktree without the symlink.
- **`ralphai purge`** — deletes all archived pipeline artifacts in `pipeline/out/`. Supports `--yes`/`-y` to skip confirmation, consistent with reset and teardown. (#75)
- **`ralphai doctor`** — validates your setup in one shot with 9 diagnostic checks: `.ralphai/` exists, `ralphai.json` valid, git repo detected, working tree clean, base branch exists, agent command in PATH, feedback commands run, backlog has plans, and no orphaned receipts. (#71)
- **Sample plan in init wizard** — `ralphai init` now offers to create a `hello-ralphai.md` sample plan in the backlog, reducing friction for first-time users. Included by default with `--yes`. (#70)
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
- Rename `drafts/` to `wip/` (#13)
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
