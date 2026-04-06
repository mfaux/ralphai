Ralphai is a CLI tool that takes plans (markdown files) from a backlog and drives any CLI-based AI coding agent to implement them autonomously, with branch isolation, feedback loops, and stuck detection.

## Great DX

- **Sensible defaults.** Auto-detect what you can (agent, base branch, project type, feedback commands). Require configuration only when there's no safe default.
- **Errors guide recovery.** Every user-facing error should suggest what to do next. Don't just report what went wrong.
- **Progressive disclosure.** Simple by default, powerful when needed. `ralphai` opens the dashboard; `ralphai run` uses defaults; flags unlock advanced behavior. Don't front-load complexity.
- **Transparent config.** Users should always be able to answer "where did this value come from?" via `--show-config`. When adding new config options, include source tracking.
- **Respect the terminal.** Honor `NO_COLOR` / `--no-color`. Use color for scannability (bold for headings, dim for hints), not decoration.

## Documentation

- **Keep docs in sync.** When changing behavior, update the relevant docs in the same change. Don't leave doc updates as a follow-up.
- **Doc inventory.** Check each doc below for relevance when making changes:
  - `ARCHITECTURE.md` -- module responsibilities and source layout. Update when adding, removing, or restructuring modules.
  - `docs/cli-reference.md` -- all commands, flags, config keys, and env vars. Update when adding or changing CLI surface.
  - `docs/how-ralphai-works.md` -- technical deep-dive: feedback loops, stuck detection, context rot. Update when changing core loop behavior.
  - `docs/workflows.md` -- recipe-based user guide. Update when adding new commands or changing user-facing workflows.
  - `docs/worktrees.md` -- worktree lifecycle and parallel runs. Update when changing worktree behavior.
  - `docs/troubleshooting.md` -- common issues and recovery steps. Update when fixing user-facing bugs or changing error behavior.
  - `AGENTS.md` -- contributor guidelines (this file). Update when changing project conventions.

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

When pulling GitHub issues into plan files, native GitHub blocking relationships are queried via `Issue.blockedBy` GraphQL API (`gh api graphql`). The returned blocker issue numbers are written to `depends-on` frontmatter using issue-based slugs like `gh-42`. The GraphQL query is fail-open: if it fails, the plan proceeds with no `depends-on` entries. The dependency checker in `plan-detection.ts` supports these slugs via prefix matching: `gh-42` matches any file/directory starting with `gh-42-` in the pipeline directories.

## Testing

- **Speed tiers.** Tests fall into two tiers: fast (default) and slow. `bun run test` runs everything; `bun run test:fast` skips files in the `SLOW` array in `scripts/test.ts`. CI runs the full suite; use `test:fast` locally to keep the feedback loop under ~60s.
- **What makes a test slow.** A test is slow if it creates real sockets (`net.connect`), runs full E2E runner loops, or heavily spawns child processes. Add these files to the `SLOW` array in `scripts/test.ts`.
- **Prefer fast patterns.** Use `runCliInProcess` (from `src/test-utils.ts`) instead of `runCli` — it avoids ~300ms subprocess overhead per call. Use `useTempDir` over `useTempGitDir` when git isn't needed. Keep pure-logic tests (no I/O) separate from integration tests that touch the filesystem.
- **Isolated tests.** Files that call `mock.module()` on built-in or third-party modules must be listed in the `ISOLATED` array in `scripts/test.ts` to prevent mock leaks across files. This is a bun limitation — remove the workaround if bun adds per-file mock isolation.

## Package Manager

This project uses **bun**.
