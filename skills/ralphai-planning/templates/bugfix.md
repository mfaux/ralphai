# Bug Fix Plan Guide

For fixing bugs. Read the [planning skill](../SKILL.md) first for shared
principles.

## Before Writing the Plan

Explore the codebase to find:

- The code path where the bug occurs (file, function, line number)
- How to reproduce it (exact input, command, or test case)
- Existing tests that cover the area (to understand what's already validated)

If you can identify the root cause, include it. If not, describe where the bug surfaces so Ralphai can trace it.

## Template

```md
# Plan: Fix <bug description>

> <What's broken, what should happen instead. 1-2 sentences.>

## <!-- Optional frontmatter for plan ordering and monorepo scope:

depends-on: [prerequisite-plan.md]
scope: packages/web

---

-->

## Reproduction

**Input:** <exact input or steps that trigger the bug>
**Expected:** <what should happen>
**Actual:** <what happens instead>

## Background

<Root cause analysis. Link to the specific code path — file, function, line
number. If root cause is unknown, describe where the bug surfaces and what
you've ruled out.>

## Acceptance Criteria

- [ ] <Observable fix — e.g., "running `cmd --flag=X` no longer throws">
- [ ] <Edge case if applicable>

## Implementation Tasks

### Task 1: Reproduce and fix

**Files:** `src/<file>.ts`, `src/<file>.test.ts`

**What:** Write a test that fails with the current behavior, then fix the
code to make it pass.

## Verification

- <Command that exercises the fix>
- The new test fails if the fix is reverted
```

## Task Sizing

Bug fixes should be 1-2 tasks. Don't over-decompose:

**Too granular** (these are subtasks, not separate tasks):

```
Task 1: Write failing test
Task 2: Fix the bug
Task 3: Verify no regressions
```

**Right-sized** (one task, with subtasks as guidance):

```
Task 1: Reproduce and fix
  - Write a failing test that reproduces the bug
  - Fix the root cause
  - Verify no regressions
```
