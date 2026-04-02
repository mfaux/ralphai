Ralphai is a CLI tool that takes plans (markdown files) from a backlog and drives any CLI-based AI coding agent to implement them autonomously, with branch isolation, feedback loops, and stuck detection.

## Great DX

- **Sensible defaults.** Auto-detect what you can (agent, base branch, project type, feedback commands). Require configuration only when there's no safe default.
- **Errors guide recovery.** Every user-facing error should suggest what to do next. Don't just report what went wrong.
- **Progressive disclosure.** Simple by default, powerful when needed. `ralphai` opens the dashboard; `ralphai run` uses defaults; flags unlock advanced behavior. Don't front-load complexity.
- **Transparent config.** Users should always be able to answer "where did this value come from?" via `--show-config`. When adding new config options, include source tracking.
- **Respect the terminal.** Honor `NO_COLOR` / `--no-color`. Use color for scannability (bold for headings, dim for hints), not decoration.

## Documentation

- **Keep docs in sync.** When changing behavior, update the relevant docs in the same change. This includes both external docs and internal docs. Don't leave doc updates as a follow-up.

## Git & GitHub

- **Conventional commits.** Format: `<type>: <description>` (e.g., `feat: add --targets flag`, `fix: dry-run skip lock write`, `docs: update CLI reference`, `test: add list --help tests`, `refactor: extract help into per-command functions`, `chore: remove generated license file`).
- **Branch naming.** Use `<type>/<description>` with the same type prefixes as commits (e.g., `feat/add-targets-flag`, `fix/dry-run-lock-write`, `docs/update-cli-reference`).
- **Use the `gh` CLI** to create issues and pull requests. Link PRs to related issues when applicable.
- **Squash-merge PRs.** The merge commit message should follow conventional commit format.

## Module Focus

- **Single responsibility.** Each source file should have one clear reason to change. When a file accumulates unrelated concerns — even if it's only a few hundred lines — extract the distinct responsibilities into their own modules.
- **New test files per feature.** When adding tests for a new feature, create a new `<feature>.test.ts` file rather than appending to an existing one. If an existing test file covers multiple unrelated features, split it by domain before adding more tests.
- **Check before appending.** Before adding substantial new code to a file, review whether it still has a single focus. If your changes would introduce a second responsibility, extract first.

## Dry-Run Safety

The `--dry-run` / `-n` flag must never cause side effects. When adding code that runs before the runner loop starts (in `src/runner.ts` or the CLI layer in `src/ralphai.ts`), verify it is read-only. Common violations: creating directories, writing files, running `git worktree add`, or calling external APIs like `gh issue edit`.

## Cross-Platform Tests

CI runs on both Ubuntu and Windows. Don't hardcode Unix paths or assume Linux-specific behavior in tests. Use `path.join()` for path assertions and `describe.skipIf(process.platform === "win32")` for inherently platform-specific tests.

## GitHub Issue Dependencies

When pulling GitHub issues into plan files, blocking references in the issue body (e.g. "Blocked by #42", "Depends on #15") are translated to `depends-on` frontmatter using issue-based slugs like `gh-42`. The dependency checker in `plan-detection.ts` supports these slugs via prefix matching: `gh-42` matches any file/directory starting with `gh-42-` in the pipeline directories.

## Package Manager

This project uses **bun**.
