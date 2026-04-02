---
name: ralphai-planning
description: >-
  Write Ralphai plan files for autonomous execution. Use when asked to
  create a plan, task, or backlog item for Ralphai.
---

# Writing Ralphai Plan Files

Plans are markdown files that Ralphai executes autonomously. Each task gets a
fresh agent session containing only the plan and a progress log, so plans must
be self-contained and specific.

## Steps

1. **Understand the request.** Read what the user wants. Ask clarifying
   questions if the goal is ambiguous.
2. **Pick a template.** Choose the one that matches the work, then read it:
   - [Feature](templates/feature.md) — new functionality
   - [Bug fix](templates/bugfix.md) — something is broken
   - [Refactor](templates/refactor.md) — structural change, no behavior change
3. **Explore the codebase.** Before writing anything, find the files,
   functions, and line numbers relevant to the work. The plan must contain
   concrete references, not guesses.
4. **Fill in the template.** Every file path, function name, and line number
   you include saves Ralphai tokens it would otherwise spend exploring.
5. **Write the plan file.** Run `ralphai backlog-dir` to get the output
   directory, then write your plan as `<slug>.md` there.

## Core Principles

1. **Define the end state, not the journey.** Specify what "done" looks like
   via acceptance criteria. Ralphai figures out how.
2. **Right-sized tasks.** Each task is a vertical slice: implementation +
   tests + doc updates in one commit. Don't split "add feature" / "test
   feature" / "document feature" into separate tasks. Don't make tasks so
   small that the per-task overhead dwarfs the work.
3. **Vertical slices first.** The first task should deliver a minimal but
   working end-to-end path. Subsequent tasks widen the slice.
4. **Risky work first.** Architectural decisions, integration points, and
   unknowns go at the top. Polish and docs go last.
5. **Explicit acceptance criteria.** Use `- [ ]` checkboxes that describe
   observable behavior. Without them, Ralphai declares victory early or
   skips edge cases.

## Writing Tips

### Be specific about locations

Bad: "Update the types file to add prompt support."

Good: "Add `'prompt'` to the `ConfigType` union in `src/types.ts` (line 106)."

### State what already works

Ralphai rebuilds things that already exist if you don't tell it. List existing
infrastructure explicitly:

```
The install pipeline (`src/installer.ts`) already handles this case —
it checks `item.type === 'foo'` at line 104. No changes needed here.
```

### Tasks are vertical slices

Each task is one logical commit with implementation, tests, and doc updates
together. The same context window that writes the code should also write
the tests and update docs.

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

### Subtasks

When a task has multiple logical steps, list them as subtasks inside the task.
The agent handles all subtasks in a single session. Subtasks are guidance, not
separate iterations.

```
Task 1: Extract parser into its own module
  - **Move functions:** relocate `parse()` and `validate()` from `src/main.ts`
    to `src/parser.ts`
  - **Update imports:** fix all import paths in files that reference the moved
    functions
  - **Verify:** run existing tests to confirm no regressions
```

Use subtasks when the steps within a task have a natural order or when listing
them helps the agent stay organized. Don't use subtasks for trivial tasks where
the steps are obvious.

## Advanced Options

### `depends-on` frontmatter

For cross-plan ordering. A plan is runnable only when all dependencies are
archived in `pipeline/out/`.

```md
---
depends-on: [foundation.md, wiring.md]
---
```

When pulling GitHub issues, blocking references in the issue body (e.g. "Blocked
by #42", "Depends on #15") are automatically translated to `depends-on` entries
using issue-based slugs like `gh-42`. These are matched by issue number prefix
against plan files in the pipeline.

### `source` frontmatter (auto-generated)

Ralphai adds this automatically when it pulls a GitHub issue into a plan. On
completion, Ralphai comments on the linked issue and removes the in-progress
label. You don't need to add this manually.

### `scope` frontmatter (monorepo)

For plans that target a specific package in a monorepo. The runner derives
scoped feedback commands automatically. For Node.js projects, this uses the
package manager's workspace filter. For .NET projects, the scope path is
appended to dotnet commands.

```md
---
scope: packages/web
---
```

When `scope` is set, Ralphai rewrites feedback commands (e.g.,
`pnpm --filter @org/web build` for Node.js, or `dotnet build src/Api` for
.NET) and adds a hint to the agent prompt to focus on the scoped directory.
Use the `workspaces` key in `config.json` for custom per-package overrides
when automatic derivation is insufficient.
