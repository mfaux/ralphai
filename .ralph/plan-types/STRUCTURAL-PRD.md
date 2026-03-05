# Structural PRD Template

Use this template for refactors, migrations, and cleanup that should not change intended user-facing behavior.

Global rules are defined in `.ralph/PLANNING.md` and apply here.

```markdown
# Plan: <Title>

> <What is being restructured and why.>

## Current State

<Duplication, coupling, inconsistency, or debt with concrete references>

## Target State

<Desired module boundaries, ownership, and interfaces>

## Constraints

- No user-facing behavior changes unless explicitly listed
- Existing tests remain valid without semantic expectation changes
- Build/test/lint must remain green throughout

## Acceptance Criteria

- [ ] <Structural outcome>
- [ ] <Structural outcome>
- [ ] Existing tests pass without behavior regressions
- [ ] Build/test/lint all pass
- [ ] AGENTS.md updated if work created non-obvious agent guidance
- [ ] LEARNINGS flow updated if durable/recurrent lessons were discovered

## Tasks

### Task 1: <Title>

...

## Verification

- Build passes
- Tests pass (no skipped regressions)
- Lint passes
- <Behavioral invariant checks>
```