# Agent Instructions

Project-specific guidance for AI coding agents working in this codebase.

## Guiding Principles

- **Great DX.** Every decision, from CLI design and defaults to error messages and docs, should minimize the time from install to "wow, that worked."

## Documentation Style

- **User-first perspective.** Write for people using Ralphai, not maintainers of this repo.
- **Active voice.** "Ralphai creates a branch" not "a branch is created by Ralphai."
- **Keep it scannable.** Short paragraphs, bullet lists, code examples. Avoid walls of text.
- **Bold for emphasis.** Use `**bold**` to highlight key terms and concepts.
- **No em dashes in prose.** Use em dashes only in list item labels (e.g., `- **Key** — explanation`). In sentences, restructure or use commas instead.

## File Size Limits

- **Test files: max ~500 lines.** When a test file approaches this limit, split it by feature domain before adding more tests. When adding tests for a new feature, create a new `<feature>.test.ts` file rather than appending to an existing one.
- **Source files: max ~300 lines.** Extract modules when a file grows beyond this. Note: `src/ralphai.ts` currently exceeds this limit and is a candidate for decomposition. Follow this guideline for new files and when refactoring.
- Before appending to any file, check its current size. If adding your changes would push it past the limit, split first.

## Dry-Run Safety

The `--dry-run` / `-n` flag must never cause side effects. When adding code that runs before the bash runner is spawned (TypeScript CLI layer) or before the `DRY_RUN` check in `ralphai.sh`, verify it is read-only. Common violations: creating directories, writing files, running `git worktree add`, or calling external APIs like `gh issue edit`.

## Conventional Commits

This repo follows [Conventional Commits](https://www.conventionalcommits.org/). Use the `type(scope): description` format for both **commit messages** and **branch names** (e.g., `feat/add-export`, `fix/null-check`). Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.

## Ralphai

This project uses [Ralphai](https://github.com/mfaux/ralphai) for autonomous task execution.
Plan files go in `.ralphai/pipeline/backlog/` as flat `.md` files (e.g., `backlog/my-plan.md`).
See `.ralphai/PLANNING.md` for the plan writing guide.
