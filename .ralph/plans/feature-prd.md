# Feature PRD Template

Use this template for new capabilities (new command, integration, module, or other user-visible behavior).

Global rules are defined in `.ralph/PLANNING.md` and apply here.

```markdown
# Plan: <Title>

> <2-4 sentence summary of what is added, why it matters, and what pattern it follows.>

## Background

<What already exists, what is missing, and where. Include concrete file paths,
function names, and relevant line references when possible.>

## References

- <Specs, prior plans, design notes>
- <Upstream pattern this should mirror>

## Domain Context (optional)

<Canonical data formats, support matrix, edge-case constraints, etc.>

## Acceptance Criteria

- [ ] <Observable behavior proving the feature works>
- [ ] <Observable behavior for an edge or error path>
- [ ] Existing tests continue to pass
- [ ] New tests cover added behavior
- [ ] AGENTS.md updated if work created non-obvious agent guidance
- [ ] README.md updated if user-facing behavior changed
- [ ] LEARNINGS flow updated if durable/recurrent lessons were discovered
- [ ] If grouped: plan uses the correct `group` value and can run on the shared group branch

## Implementation Tasks

List tasks in dependency order. Each task must end in a green build.
Use thin vertical slices, not layer-first "build everything then wire" sequencing.

### Task 1: <Title>

**File(s):** `<path>`

**What:** <Concrete change with functions, interfaces, branches, and target lines>

**Why now:** <Risk reduced by doing this task early>

### Task 2: <Title>

...

## Verification

<End-to-end command(s) and behavioral checks proving acceptance criteria>
```