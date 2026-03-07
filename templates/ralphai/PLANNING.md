# Writing Ralphai Plan Files

Guide for writing plan files that Ralphai consumes. Plans go in `.ralphai/pipeline/backlog/` and are picked automatically by `ralphai run`.

Plans that aren't ready for execution (waiting on external prerequisites, need human review, or are still being drafted) go in `.ralphai/pipeline/wip/`. `ralphai run` does not scan `wip/` — move plans to `pipeline/backlog/` when they're ready to be picked up.

## Core Principles

1. **Define the end state, not the journey.** Ralphai picks tasks and figures out how. You specify what "done" looks like via acceptance criteria.
2. **Small steps.** Each task should be one logical commit. If a task feels too large, break it into subtasks. Context rot degrades quality on long tasks.
3. **Vertical slices first.** Structure tasks so the first task delivers a minimal but working end-to-end slice through the user's project — the "skateboard." Subsequent tasks widen the slice: add edge cases, improve UX, harden error handling, extend to more inputs. This ensures every intermediate state is demonstrably useful and testable, not just a pile of disconnected foundations. A working thin path through the system beats a perfect layer that nothing uses yet.
4. **Risky work first.** Architectural decisions, integration points, and unknowns go at the top. Polish and docs go last. Ralphai will pick easy wins if you let it.
5. **Explicit acceptance criteria.** Use checkboxes. Without them, ralphai declares victory early or skips edge cases.
6. **Feedback loops are guardrails.** Every task must pass your configured feedback commands (build, test, lint) before committing. The ralphai prompt enforces this, but the plan should assume it.

## Plan Types

### Feature PRD (build something new)

For new capabilities that span multiple files and require design decisions.

**Use when:** Adding a new capability, a new CLI command, a new integration, a new module.

**Structure:**

```markdown
# Plan: <Title>

> <TL;DR — what this adds, what pattern it follows, why it matters. 2-4 sentences.>

## Background

<Current state of the codebase relevant to this work. What exists, what doesn't.
Link to existing files and prior plans. Be specific — ralphai explores the repo
but specific pointers save tokens and reduce wrong turns.>

## References

- <Link to specs, prior PRDs, deferred items docs>
- <Link to upstream patterns this mirrors>

## <Domain-Specific Context> (optional)

<Support matrices, canonical format specs, agent output tables — whatever
ralphai needs to make correct decisions without exploring the codebase.>

## Acceptance Criteria

- [ ] <Observable behavior that proves the feature works>
- [ ] <Another observable behavior>
- [ ] All existing tests continue to pass
- [ ] New tests cover the new functionality
- [ ] AGENTS.md updated if work created knowledge future agents need and can't easily infer
- [ ] README.md updated if user-facing behavior changed

## Implementation Tasks

List tasks in dependency order — each task should leave a green build.
Foundations first, wiring second, tests third, docs last.

### Task 1: <Title>

**File:** `src/<file>.ts`

**What:** <Describe the change. Name specific functions, interfaces, line
numbers. The more precise, the fewer tokens ralphai spends exploring.>

**Key insight:** <Call out non-obvious things — existing code that already
handles this, functions that need renaming, integration points.>

### Task 2: <Title>

...

## Verification

<Final end-to-end checks after all tasks are done.>
```

### Wiring PRD (connect existing pieces)

For work where the infrastructure exists but isn't exposed to users.

**Use when:** Adding a CLI flag for existing functionality, extending an existing command to handle a new type, connecting modules that already work independently.

**Structure:** Same as Feature PRD but with a shorter Background that emphasizes what's already built and what's missing. Tasks are typically smaller since they're wiring, not building.

**Key difference:** Background section should explicitly list what's done vs what's missing, with file paths and line numbers. This prevents ralphai from rebuilding existing infrastructure.

### Bug Fix PRD (fix broken behavior)

For fixing incorrect behavior where the expected outcome is clear.

**Use when:** A command produces wrong output, a parser crashes on valid input, an edge case is mishandled.

**Structure:**

```markdown
# Plan: Fix <Title>

> <What's broken, what the correct behavior should be. 1-2 sentences.>

## Reproduction

**Input:** <Exact command, input file, or function call that triggers the bug>

**Expected:** <What should happen>

**Actual:** <What happens instead>

## Root Cause (hypothesis)

<Best guess at why this happens. Name specific files, functions, line numbers.
If uncertain, say so — ralphai will investigate.>

## References

- <Link to issue, error log, or related code>

## Acceptance Criteria

- [ ] Failing test reproduces the bug before the fix
- [ ] Fix makes the test pass
- [ ] No regressions — all existing tests continue to pass
- [ ] AGENTS.md updated if fix created knowledge future agents need and can't easily infer
- [ ] README.md updated if the fix changes documented behavior

## Tasks

### Task 1: Write failing test

**File:** `src/<file>.test.ts` or `tests/<file>.test.ts`

**What:** <Test that asserts the expected behavior and fails with the current code.
Use the reproduction case above as the basis.>

### Task 2: Fix the bug

**File:** `src/<file>.ts`

**What:** <Describe the fix. Be specific about which function/branch to change.>

## Verification

<Run the reproduction case manually and confirm correct behavior.>
```

**Key difference from other templates:** Task 1 is always "write failing test." The ralphai prompt enforces test-first for bug fixes, and this template structure matches that expectation.

### Structural PRD (refactor, cleanup, migration)

For work that changes organization without adding features.

**Use when:** Renaming modules, extracting shared code, migrating patterns, cleaning up dead code, improving test coverage.

**Structure:**

```markdown
# Plan: <Title>

> <What's being restructured and why. What stays the same from the user's perspective.>

## Current State

<Describe the problem: duplication, inconsistency, tech debt. Link to specific
files and line numbers.>

## Target State

<Describe what the code should look like after. Be concrete about file names,
module boundaries, export surfaces.>

## Constraints

- No user-facing behavior changes (unless explicitly noted)
- All existing tests must continue to pass without modification
- <Other invariants>

## Acceptance Criteria

- [ ] <Structural outcome — e.g. "X lives in its own module">
- [ ] <Another structural outcome>
- [ ] All existing tests pass without modification
- [ ] Build, test, and lint all pass
- [ ] AGENTS.md updated if restructuring created knowledge future agents need and can't easily infer

## Tasks

### Task 1: <Title>

...

## Verification

- Build passes
- Tests pass (same count, no skips)
- Lint passes
- <Specific behavioral invariants to verify>
```

### Implementation Plan (reference doc, not a ralphai plan)

For repeatable processes that different developers (or ralphai runs) will follow multiple times. These are human reference docs, not plans ralphai consumes directly.

**Use when:** Documenting a cookbook process like adding a new module, onboarding a new integration, or any step-by-step guide.

**Not for ralphai:** If you want ralphai to execute a cookbook process, write a Feature or Wiring PRD that references the implementation plan.

**Structure:**

```markdown
# <Process Name>

<When to use this plan. Prerequisites.>

## Goal

<What success looks like.>

## Scope Decision (Step 0)

<Decisions that must be made before starting.>

## Phase 1 — <Name>

### Step 1: <Action>

<What to do, where, expected outcome.>

### Step 2: <Action>

...

## Phase 2 — <Name>

...
```

## Writing Guidelines

### Frontmatter keys that are NOT supported

`promptMode` is a global/per-run setting (configured via CLI flag `--prompt-mode`, env var `RALPHAI_PROMPT_MODE`, or config key `promptMode`). It cannot be set per-plan in frontmatter — it controls how `ralphai run` formats file references in prompts for the current agent, which applies uniformly to the entire run.

### Optional `depends-on` frontmatter

For cross-plan ordering, you can declare dependencies in plan frontmatter. `ralphai run` only considers a plan runnable when all dependencies are complete (archived in `.ralphai/pipeline/out/`).

Use basename references (not full paths):

```md
---
depends-on: [prd-foundation.md, prd-wiring.md]
---
```

or

```md
---
depends-on:
	- prd-foundation.md
	- prd-wiring.md
---
```

If omitted, the plan is treated as having no dependencies.

### Optional `source` frontmatter (issue linking)

Link a plan to an external issue tracker. When the plan completes, Ralphai automatically comments on and closes the linked issue.

```md
---
source: github
issue: 42
issue-url: https://github.com/owner/repo/issues/42
---
```

Supported sources: `github`. Requires `gh` CLI to be installed and authenticated (`gh auth login`).

Fields:

- `source` — tracker type (currently only `github`)
- `issue` — issue number
- `issue-url` — full URL to the issue (used for repo detection and human reference)

If `gh` is not available, the hooks are silently skipped. To disable automatic issue closing while keeping comments, set `"issueCloseOnComplete": false` in `ralphai.json`.

### Be specific about locations

Bad: "Update the types file to add prompt support."

Good: "Add `'prompt'` to the `ConfigType` union in `src/types.ts` (line 106)."

Ralphai spends tokens exploring. Every line number, function name, and file path you provide is tokens saved and wrong turns avoided.

### State what already works

Ralphai will rebuild things that already exist if you don't tell it they're done. List existing infrastructure explicitly:

```
The install pipeline (`src/installer.ts`) already handles this case —
it checks `item.type === 'foo'` at line 104 and routes correctly.
No changes needed here.
```

### One task = one commit

Each task should result in exactly one commit. If a task requires changes across 5 files, that's fine — but it should be one logical unit. If you need two logical units, make two tasks.

### Use conventional commits

All commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Use a scope when it adds clarity (e.g. `feat(transpiler): ...`). The ralphai prompt enforces this, but plan tasks should assume it when describing expected commits.

Examples:

- `feat(parser): add support for new config format`
- `fix(cli): handle missing arguments gracefully`
- `refactor: extract shared validation logic`
- `test(agent): add coverage for edge cases`
- `docs: update README with new CLI command`

### Testing strategy by task type

The ralphai prompt enforces different testing approaches depending on the nature of the task. Plan authors should be aware of this when writing tasks:

- **Bug fixes**: Ralphai writes a failing test first, then fixes the code. Plans should describe the buggy behavior clearly enough for ralphai to reproduce it in a test.
- **New features**: Ralphai implements first, then adds tests. Plans should include test expectations in the acceptance criteria so ralphai knows what to cover.
- **Refactoring**: Ralphai relies on existing tests as the safety net. Plans should note if coverage gaps exist that need new tests.
- **Docs/chore tasks**: No tests expected.

When writing bug fix tasks, include the reproduction case (input, expected output, actual output) so ralphai can translate it directly into a failing test. Without this, ralphai may write a test that asserts the wrong thing.

### Order tasks for a green build

Every task should leave the build and tests passing. This means:

1. **Thin vertical slice first** — types + function + wiring + test for one end-to-end path. The narrowest version that proves the architecture works.
2. **Widen the slice** — additional cases, inputs, error handling. Each task extends the working path.
3. **Harden** — edge cases, validation, error messages.
4. **Docs last** — describes the final state.

Avoid building complete layers (all types, then all functions, then all wiring). Layer-first ordering means nothing works until the last task, and you can't catch design mistakes early.

### Include acceptance criteria with checkboxes

Ralphai uses these to determine when it's done. Without them, it guesses. Use `- [ ]` checkboxes — they're both human-readable and machine-parseable.

### Always include doc updates

Every plan that changes user-facing behavior should include tasks for:

- **AGENTS.md** — only when the work created knowledge that future coding agents need and cannot easily infer from the code (e.g. new CLI commands, non-obvious architectural constraints, changed dev workflows). Routine bug fixes, internal refactors, and new tests do not warrant an AGENTS.md update.
- **README.md** — commands, options, examples, support matrices
- **Learnings** — when the work reveals recurring mistakes or durable operational patterns, review `.ralphai/LEARNINGS.md` and promote findings appropriately:
  - `AGENTS.md` for immediate repo-specific behavior
  - skill/reusable docs for stable patterns worth reusing across tasks/repos

### Standard verification block

Include at the bottom of every plan:

```markdown
## Verification

After each task:

- Build passes
- Tests pass
- Lint passes

Final verification:

- <end-to-end command that exercises the new feature>
- <specific behavioral checks>
```

## Turn Sizing

| Plan complexity                        | Recommended turns (`ralphai run`) |
| -------------------------------------- | --------------------------------- |
| 3-5 small tasks                        | 5                                 |
| 6-10 tasks with wiring                 | 10-15                             |
| Large feature (10+ tasks, new modules) | 15-25                             |
| Structural refactor                    | 10-15                             |

Pass `--turns=0` for unlimited turns — Ralphai keeps going until all tasks are complete or stuck detection triggers. This is useful when you don't want to estimate a turn budget up front.

Use `ralphai run --dry-run` to verify selection/readiness before launching long autonomous runs.

If a run is interrupted and leaves a dirty tree, use `ralphai run <turns> --resume` on the current `ralphai/*` branch to auto-commit recovery state and continue.
