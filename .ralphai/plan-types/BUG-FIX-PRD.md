# Bug Fix PRD Template

Use this template when expected behavior is known and current behavior is wrong.

Global rules are defined in `.ralphai/PLANNING.md` and apply here.

```markdown
# Plan: Fix <Title>

> <What is broken and what correct behavior must be.>

## Reproduction

**Command (preferred):** `<runnable shell command>`

**Input:** <Exact input, arguments, or fixture>

**Expected:** <Expected output/behavior>

**Actual:** <Current incorrect output/behavior>

## Root Cause (hypothesis)

<Likely failure location with file/function/line references. Mark unknowns clearly.>

## Acceptance Criteria

- [ ] Failing test reproduces the bug before the fix
- [ ] Fix makes that test pass
- [ ] No regressions in existing tests
- [ ] AGENTS.md updated if work created non-obvious agent guidance
- [ ] README.md updated if documented behavior changed
- [ ] LEARNINGS flow updated if durable/recurrent lessons were discovered

## Tasks

### Task 1: Write failing test from reproduction

**File(s):** `<test file>`

**What:** <Encode the reproduction exactly>

### Task 2: Implement fix

**File(s):** `<source file>`

**What:** <Specific branch/function logic to change>

## Verification

<Re-run reproduction command and confirm expected behavior>
```

If no runnable shell reproduction exists, use a minimal function-call reproduction.