# Agent Instructions

Project-specific guidance for AI coding agents working in this codebase.

## Guiding Principles

- **Great DX.** Every decision — CLI design, defaults, error messages, docs — should minimize the time from install to "wow, that worked."

## Dogfooding Ralphai

Ralphai is an autonomous task runner for AI coding agents.

Plan files go in `.ralphai/pipeline/backlog/`. See `.ralphai/PLANNING.md` for the
plan writing guide. Plans not ready for execution go in
`.ralphai/pipeline/wip/`.

## Learnings

### Plan file naming: no prefix required

Plan files can be named freely — `dark-mode.md`, `gh-42-search.md`, `prd-auth.md` all work. The slug is derived as `filename minus .md` (no prefix stripping). Branch names follow: `dark-mode.md` → `ralphai/dark-mode`. Receipt files store a `plan_file=<basename>` field for explicit plan↔receipt matching.

### Testing child process output capture

`spawnSync` with `stdio: "inherit"` sends output directly to the parent's file descriptors, bypassing any pipe that a grandparent test harness sets up via `execFileSync`. Use `stdio: ["inherit", "pipe", "pipe"]` and manually write `result.stdout`/`result.stderr` to `process.stdout`/`process.stderr` when the CLI output needs to be capturable by tests.

### Windows CI has no bash

Tests that spawn bash scripts (e.g. the task runner via `RALPHAI_RUNNER_SCRIPT`) must be skipped on Windows. Use `describe.skipIf(process.platform === "win32")` — same pattern as the existing executable-permission tests.

### Batch task counting regexes must be anchored to headings

The `update_receipt_tasks()` function in `runner/lib/receipt.sh` and `countCompletedTasks()` in `src/ralphai.ts` count batch task completions by matching `Tasks X-Y` patterns. These regexes must be anchored to `^### ` (H3 markdown headings) to avoid false matches on prose body text that references task ranges (e.g. "CLI parsing moves in Tasks 3-4").
