# Writing Ralphai Plan Files

Guide for writing plan files that Ralphai consumes. Plans go in `.ralphai/pipeline/backlog/`.

Plans not ready for execution go in `.ralphai/pipeline/wip/` — Ralphai ignores that directory.

## Core Principles

1. **Define the end state, not the journey.** Specify what "done" looks like via acceptance criteria. Ralphai figures out how.
2. **Small steps.** Each task should be one logical commit. If a task feels too large, break it down.
3. **Vertical slices first.** The first task should deliver a minimal but working end-to-end path — the "skateboard." Subsequent tasks widen the slice.
4. **Risky work first.** Architectural decisions, integration points, and unknowns go at the top. Polish and docs go last.
5. **Explicit acceptance criteria.** Use `- [ ]` checkboxes. Without them, Ralphai declares victory early or skips edge cases.
6. **Feedback loops are guardrails.** Every task must pass build, test, and lint before committing. The prompt enforces this.

## Plan Template

```md
# Plan: <Title>

> <TL;DR — what this adds, what pattern it follows, why it matters. 2-4 sentences.>

## Background

<Current state of the codebase. What exists, what doesn't. Link to existing
files, line numbers, prior plans. Be specific — every pointer saves tokens.>

## References

- <Link to specs, prior plans, upstream patterns>

## Acceptance Criteria

- [ ] <Observable behavior that proves the feature works>
- [ ] <Another observable behavior>
- [ ] All existing tests continue to pass
- [ ] New tests cover the new functionality
- [ ] AGENTS.md updated if work created knowledge future agents need
- [ ] README.md updated if user-facing behavior changed

## Implementation Tasks

List tasks in dependency order — each task should leave a green build.

### Task 1: <Title>

**File:** `src/<file>.ts`

**What:** <Describe the change. Name specific functions, interfaces, line
numbers. The more precise, the fewer tokens spent exploring.>

**Key insight:** <Non-obvious things — existing code that handles part of this,
functions that need renaming, integration points.>

### Task 2: <Title>

...

## Verification

- Build, test, lint all pass
- <End-to-end command that exercises the new feature>
- <Specific behavioral checks>
```

### Adapting the template

- **Bug fixes:** Task 1 should always be "write failing test." Include reproduction case (input, expected, actual) so Ralphai can translate it directly into a test.
- **Refactors:** Add a Constraints section noting "no user-facing behavior changes" and rely on existing tests as the safety net.
- **Wiring work:** Background should explicitly list what's already built vs what's missing, with file paths and line numbers, to prevent rebuilding existing infrastructure.

## Writing Guidelines

### Be specific about locations

Bad: "Update the types file to add prompt support."

Good: "Add `'prompt'` to the `ConfigType` union in `src/types.ts` (line 106)."

### State what already works

Ralphai rebuilds things that already exist if you don't tell it. List existing infrastructure explicitly:

```
The install pipeline (`src/installer.ts`) already handles this case —
it checks `item.type === 'foo'` at line 104. No changes needed here.
```

### One task = one commit

Each task should result in exactly one commit. Multiple file changes are fine — but it should be one logical unit.

### Order tasks for a green build

1. Thin vertical slice first — types + function + wiring + test for one path
2. Widen — additional cases, inputs, error handling
3. Harden — edge cases, validation
4. Docs last

### Optional `depends-on` frontmatter

For cross-plan ordering:

```md
---
depends-on: [foundation.md, wiring.md]
---
```

A plan is runnable only when all dependencies are archived in `out/`.

### Optional `source` frontmatter (issue linking)

```md
---
source: github
issue: 42
issue-url: https://github.com/owner/repo/issues/42
---
```

On completion, Ralphai comments on and closes the linked GitHub issue.

## Turn Sizing

| Plan complexity                        | Recommended turns |
| -------------------------------------- | ----------------- |
| 3-5 small tasks                        | 5                 |
| 6-10 tasks with wiring                 | 10-15             |
| Large feature (10+ tasks, new modules) | 15-25             |
| Structural refactor                    | 10-15             |

Pass `--turns=0` for unlimited turns.
