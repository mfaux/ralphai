# Refactor Plan Guide

For structural changes with no user-facing behavior change. Read the
[planning skill](../SKILL.md) first for shared principles.

## Before Writing the Plan

Explore the codebase to find:

- The files and functions that need restructuring (with line numbers)
- The existing test coverage for the affected code (these tests are your safety net)
- The structural problem you're solving (file too large, unclear boundaries, duplicated logic)

## Template

```md
# Plan: Refactor <what>

> <What's changing structurally and why. What stays the same from the user's
> perspective. 2-3 sentences.>

## <!-- Optional frontmatter for plan ordering and monorepo scope:

depends-on: [prerequisite-plan.md]
scope: packages/web

---

-->

## Constraints

- No user-facing behavior changes
- All existing tests must pass before and after each task

## Background

<Current structure. Name files, functions, line numbers. Explain why the
current structure is a problem and what the target structure looks like.>

## Acceptance Criteria

- [ ] <Structural property — e.g., "no source file exceeds 300 lines">
- [ ] <Another measurable outcome>

## Implementation Tasks

### Task 1: <Title>

**Files:** `src/<file>.ts`

**What:** <Describe the structural change. Name what moves where, what gets
renamed, what gets extracted.>

**Invariant:** <What existing tests validate that behavior is preserved.>

### Task 2: <Title>

...

## Verification

- No behavior changes observable from the CLI / public API
- <Structural checks — file sizes, module boundaries>
```

## Task Sizing

Refactor tasks should be scoped to preserve a green build at each step.

**Too cautious:**

```
Task 1: Create new file
Task 2: Move function A
Task 3: Move function B
Task 4: Update imports
Task 5: Delete old file
```

**Right-sized:**

```
Task 1: Extract functions A and B into new module, update imports,
         delete old code
```

**Too aggressive:**

```
Task 1: Restructure entire src/ directory
```
