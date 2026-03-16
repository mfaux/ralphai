# Agent Instructions

Project-specific guidance for AI coding agents working in this codebase.

## Guiding Principles

- **Great DX.** Every decision — CLI design, defaults, error messages, docs — should minimize the time from install to "wow, that worked."

## Documentation Style

- **User-first perspective.** Write for people using Ralphai, not maintainers of this repo.
- **Active voice.** "Ralphai creates a branch" not "a branch is created by Ralphai."
- **Keep it scannable.** Short paragraphs, bullet lists, code examples. Avoid walls of text.
- **Bold for emphasis.** Use `**bold**` to highlight key terms and concepts.
- **No em dashes in prose.** Use em dashes only in list item labels (e.g., `- **Key** — explanation`). In sentences, restructure or use commas instead.

## File Size Limits

- **Test files: max ~500 lines.** When a test file approaches this limit, split it by feature domain before adding more tests. When adding tests for a new feature, create a new `<feature>.test.ts` file rather than appending to an existing one.
- **Source files: max ~300 lines.** Extract modules when a file grows beyond this.
- Before appending to any file, check its current size. If adding your changes would push it past the limit, split first.

## Ralphai

This project uses [Ralphai](https://github.com/mfaux/ralphai) for autonomous task execution.
Plan files go in per-plan folders under `.ralphai/pipeline/backlog/`. See `.ralphai/PLANNING.md` for
the plan writing guide.

## Learnings

### Plan file naming: no prefix required

Plan files can be named freely — `dark-mode.md`, `gh-42-search.md`, `prd-auth.md` all work. The slug is derived as `filename minus .md` (no prefix stripping). Branch names follow: `dark-mode.md` → `ralphai/dark-mode`. Receipt files store a `plan_file=<basename>` field for explicit plan↔receipt matching.

### Testing child process output capture

`spawnSync` with `stdio: "inherit"` sends output directly to the parent's file descriptors, bypassing any pipe that a grandparent test harness sets up via `execFileSync`. Use `stdio: ["inherit", "pipe", "pipe"]` and manually write `result.stdout`/`result.stderr` to `process.stdout`/`process.stderr` when the CLI output needs to be capturable by tests.

### Windows CI has no bash

Tests that spawn bash scripts (e.g. the task runner via `RALPHAI_RUNNER_SCRIPT`) must be skipped on Windows. Use `describe.skipIf(process.platform === "win32")` — same pattern as the existing executable-permission tests.

### Batch task counting regexes must be anchored to headings

The `update_receipt_tasks()` function in `runner/lib/receipt.sh` and `countCompletedTasks()` in `src/ralphai.ts` count batch task completions by matching `Tasks X-Y` patterns. These regexes must be anchored to `^### ` (H3 markdown headings) to avoid false matches on prose body text that references task ranges (e.g. "CLI parsing moves in Tasks 3-4").

### Test file organization

Tests are split by feature domain into separate files under `src/`. Each file has its own `describe` block and uses the `useTempGitDir()` helper from `test-utils.ts` for test isolation. When adding tests for a new feature, create a new test file rather than appending to an existing one.
