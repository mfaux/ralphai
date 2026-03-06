# Wiring PRD Template

Use this template when infrastructure exists but is not exposed through the user flow.

Global rules are defined in `.ralphai/PLANNING.md` and apply here.

```markdown
# Plan: <Title>

> <What is already built, what is disconnected, and what this wiring unlocks.>

## Done vs Missing

### Already done

- <Concrete capability with file/function references>

### Missing wiring

- <Entry points, flags, routes, exports, or adapters to connect>

## Acceptance Criteria

- [ ] <Wiring behavior is observable from the entry point>
- [ ] Existing behavior remains unchanged outside this path
- [ ] Existing tests continue to pass
- [ ] New tests cover the newly wired flow
- [ ] AGENTS.md updated if work created non-obvious agent guidance
- [ ] README.md updated if user-facing behavior changed
- [ ] LEARNINGS flow updated if durable/recurrent lessons were discovered
- [ ] If grouped: wiring behavior remains valid when executed on the shared group branch

## Tasks

### Task 1: <Title>

...

## Verification

<Run command(s) that demonstrate the connected path>
```