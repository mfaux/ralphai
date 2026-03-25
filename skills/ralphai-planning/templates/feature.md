# Feature Plan Guide

For adding new functionality. Read the [planning skill](../SKILL.md) first for
shared principles.

## Before Writing the Plan

Explore the codebase to find:

- The files and functions you'll need to modify or extend
- Existing patterns for similar features (how are other options/commands/modules structured?)
- The project's testing patterns (test file location, helper utilities, assertion style)
- Documentation files that describe the feature area

Put concrete references (file paths, function names, line numbers) in the plan. Every reference you include saves Ralphai tokens it would otherwise spend exploring.

## Template

```md
# Plan: <Title>

> <What this adds and why. 2-3 sentences.>

## <!-- Optional frontmatter for plan ordering and monorepo scope:

depends-on: [prerequisite-plan.md]
scope: packages/web

---

-->

## Background

<Current state of the codebase relevant to this feature. Name files, functions,
line numbers. Link to existing patterns this feature should follow.>

## Acceptance Criteria

- [ ] <Observable behavior — e.g., "running `cmd --flag` produces X output">
- [ ] <Another observable behavior>

## Implementation Tasks

### Task 1: <Title>

**Files:** `src/<file>.ts`, `src/<file>.test.ts`

**What:** <Describe the change. Name specific functions, interfaces, line
numbers.>

**Tests:** <What tests to add. Describe inputs, expected outputs, edge cases.>

**Docs:** <What docs to update, if any.>

**Subtasks** (optional, for multi-step tasks):

- **Step description:** what to do
- **Another step:** what to do

### Task 2: <Title>

...

## Verification

- <End-to-end command that exercises the new feature>
- <Specific behavioral checks>
```

## Task Sizing

A feature task should be a meaningful vertical slice: code + tests + docs.

**Too small** (adds unnecessary overhead):

```
Task 1: Add ConfigType union member
Task 2: Wire ConfigType into parseConfig
Task 3: Test parseConfig with new type
```

**Right-sized** (one slice, one session):

```
Task 1: Add config type support — add union member, wire into parseConfig,
         add tests for the new config path
```

**Too large** (will exhaust context window):

```
Task 1: Implement entire plugin system with loader, registry, lifecycle
         hooks, error handling, tests, and docs
```
