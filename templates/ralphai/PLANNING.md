# Writing Ralphai Plan Files

Guide for coding agents writing plan files that Ralphai executes autonomously. Plans go in `.ralphai/pipeline/backlog/<slug>/<slug>.md`.

## How to Write a Plan

1. **Understand the request.** Read what the user wants. Ask clarifying questions if the goal is ambiguous.
2. **Pick a guide.** Choose the one that matches the work:
   - **[Feature](plans/feature.md)** — new functionality
   - **[Bug fix](plans/bugfix.md)** — something is broken
   - **[Refactor](plans/refactor.md)** — structural change, no behavior change
3. **Explore the codebase.** Before writing anything, find the files, functions, and line numbers relevant to the work. The plan must contain concrete references, not guesses.
4. **Fill in the template.** Follow the guide's template. Every file path, function name, and line number you include saves Ralphai tokens it would otherwise spend exploring.
5. **Write the plan file** to `.ralphai/pipeline/backlog/<slug>/<slug>.md`.

## Core Principles

1. **Define the end state, not the journey.** Specify what "done" looks like via acceptance criteria. Ralphai figures out how.
2. **Right-sized tasks.** Each task is a vertical slice: implementation + tests + doc updates in one commit. Don't split "add feature" / "test feature" / "document feature" into separate tasks. Don't make tasks so small that the per-turn overhead dwarfs the work.
3. **Vertical slices first.** The first task should deliver a minimal but working end-to-end path. Subsequent tasks widen the slice.
4. **Risky work first.** Architectural decisions, integration points, and unknowns go at the top. Polish and docs go last.
5. **Explicit acceptance criteria.** Use `- [ ]` checkboxes that describe observable behavior. Without them, Ralphai declares victory early or skips edge cases.

## Writing the Plan

### Be specific about locations

Bad: "Update the types file to add prompt support."

Good: "Add `'prompt'` to the `ConfigType` union in `src/types.ts` (line 106)."

### State what already works

Ralphai rebuilds things that already exist if you don't tell it. List existing infrastructure explicitly:

```
The install pipeline (`src/installer.ts`) already handles this case —
it checks `item.type === 'foo'` at line 104. No changes needed here.
```

### Tasks are vertical slices

Each task is one logical commit with implementation, tests, and doc updates together. The same context window that writes the code should also write the tests and update docs.

Bad:

```
Task 1: Add parser
Task 2: Test parser
Task 3: Document parser
```

Good:

```
Task 1: Add parser with tests and doc updates
```

### Order tasks for a green build

1. Thin vertical slice first — types + function + wiring + test for one path
2. Widen — additional cases, inputs, error handling
3. Harden — edge cases, validation

## Advanced Options

### `depends-on` frontmatter

For cross-plan ordering. A plan is runnable only when all dependencies are archived in `.ralphai/pipeline/out/`.

```md
---
depends-on: [foundation.md, wiring.md]
---
```

### `source` frontmatter (auto-generated)

Ralphai adds this automatically when it pulls a GitHub issue into a plan. On completion, Ralphai comments on the linked issue and removes the in-progress label. You don't need to add this manually.
