# Changelog

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
- **Update, sync & uninstall** — `ralphai update` self-updates the CLI; `ralphai sync` refreshes templates; `ralphai uninstall` cleans up
