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
  - `docs/hooks.md` -- hooks, gates, prompt controls, and config reference tables. Update when adding or changing config keys, hooks, gate behavior, or prompt injection.
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

## Completeness

Don't treat a task as done until you've traced how your changes affect the rest of the codebase. A change that works in isolation but breaks adjacent code is not complete — and neither is a fix applied to one module when analogous modules have the same problem.

- **Update callers.** When you change a function signature, type, or module export, find and update every consumer.
- **Update tests.** If you change behavior, the corresponding tests must reflect the new behavior in the same change — not as a follow-up.
- **Verify the build.** Run the build and tests before declaring a task done. A green diff is not the same as a green build.
- **Check for stale references.** Renaming or removing something? Search for string references (config keys, CLI flags, error messages, docs) that still point to the old name.
- **Check analogous modules.** When applying a fix or pattern to one module, look for other modules that would benefit from the same treatment and include them unless the task was explicitly scoped to a single module.
- **Single responsibility.** Each source file should have one clear reason to change. Before adding substantial new code to a file, check whether it still has a single focus. If your changes would introduce a second responsibility, extract first.

## Dry-Run Safety

The `--dry-run` / `-n` flag must never cause side effects. When adding code that runs before the runner loop starts (in `src/runner.ts` or the CLI layer in `src/ralphai.ts`), verify it is read-only. Common violations: creating directories, writing files, running `git worktree add`, or calling external APIs like `gh issue edit`.

## Cross-Platform Tests

CI runs on both Ubuntu and Windows. Don't hardcode Unix paths or assume Linux-specific behavior in tests. Use `path.join()` for path assertions and `describe.skipIf(process.platform === "win32")` for inherently platform-specific tests.

## Testing

- **Speed tiers.** Tests fall into two tiers: fast (default) and slow. `bun run test` runs everything; `bun run test:fast` skips files in the `SLOW` array in `scripts/test.ts`. CI runs the full suite; use `test:fast` locally to keep the feedback loop under ~60s.
- **What makes a test slow.** A test is slow if it creates real sockets (`net.connect`), runs full E2E runner loops, or heavily spawns child processes. Add these files to the `SLOW` array in `scripts/test.ts`.
- **Prefer fast patterns.** Use `runCliInProcess` (from `src/test-utils.ts`) instead of `runCli` — it avoids ~300ms subprocess overhead per call. Use `useTempDir` over `useTempGitDir` when git isn't needed. Keep pure-logic tests (no I/O) separate from integration tests that touch the filesystem.
- **Isolated tests.** Files that call `mock.module()` on built-in or third-party modules must be listed in the `ISOLATED` array in `scripts/test.ts` to prevent mock leaks across files. This is a bun limitation — remove the workaround if bun adds per-file mock isolation.
- **New test files per feature.** When adding tests for a new feature, create a new `<feature>.test.ts` file rather than appending to an existing one. If an existing test file covers multiple unrelated features, split it by domain before adding more tests.

## Docker Sandbox

The sandbox container runs as the host user (non-root via `--user UID:GID`). This means every tool and directory inside the image must be accessible to an arbitrary UID.

- **World-executable binaries.** Any binary installed in the Dockerfile must end with `chmod 755` — don't rely on install scripts to set correct permissions.
- **Bind-mount shadowing.** When Docker bind-mounts a file (e.g. `auth.json`), it creates intermediate directories as root with default permissions (755). If those directories are inside `/home/agent`, the root-owned dir shadows the 1777 parent from the Dockerfile and the non-root user gets EACCES. **Fix:** pre-create the parent directory in the Dockerfile's `mkdir -p` block so it already exists with 1777 permissions before Docker's mount step. When adding new paths to `AGENT_FILE_MOUNTS` or `COMMON_FILE_MOUNTS` in `src/executor/docker.ts`, check whether the mount creates new intermediate directories under `/home/agent` and add them to `docker/Dockerfile` if so.
