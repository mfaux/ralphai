# Writing Ralph Plan Files

This file is the router for Ralph plan authoring.

Use it to pick the correct plan type quickly. Detailed templates live in `.ralph/plans/`.
This follows the same principle as "agents index + focused docs": short entrypoint, specialized guidance.

## Lifecycle Quick Reference

- `.ralph/wip/`: Draft or blocked plans. Ralph does not scan this directory.
- `.ralph/backlog/`: Runnable plans. Ralph selects from here.
- `.ralph/in-progress/`: Active work during a run.
- `.ralph/out/`: Completed plans and progress logs.

Move plans from `wip/` to `backlog/` only when they are runnable.
For full lifecycle behavior, read `docs/HOW-IT-WORKS.md`.

## Plan Type Router (TOC)

- Feature PRD: `.ralph/plans/feature-prd.md`
- Wiring PRD: `.ralph/plans/wiring-prd.md`
- Bug Fix PRD: `.ralph/plans/bug-fix-prd.md`
- Structural PRD: `.ralph/plans/structural-prd.md`
- Implementation Plan (reference only): `.ralph/plans/implementation-plan.md`

## Quick Decision Tree

1. New user-visible capability? Use `feature-prd.md`.
2. Existing pieces already work but are disconnected? Use `wiring-prd.md`.
3. Behavior is wrong and expected output is known? Use `bug-fix-prd.md`.
4. Restructure/migrate/cleanup with stable behavior? Use `structural-prd.md`.
5. Human repeatable process guide (not directly runnable)? Use `implementation-plan.md`.

## Core Principles

1. **Define outcomes, not implementation stories.**
   Plans must describe observable done states via acceptance criteria.
2. **One task, one logical commit.**
   Treat this as a size rule: one coherent intent per commit.
3. **Risk-first, but always green.**
   Start with the highest-risk unknown that can still produce a compilable, testable increment.
4. **Thin vertical slices over layer-first sequencing.**
   Treat this as a shape rule: each task should deliver a small but complete path.
5. **Explicit acceptance criteria are mandatory.**
   Use machine-parseable checkboxes (`- [ ]`).
6. **Feedback loops are hard gates.**
   Every task must pass configured build/test/lint feedback before commit.

## Global Writing Rules (Apply To All Runnable PRDs)

### 1) Unsupported frontmatter

- `promptMode` must not be set per plan.
- `promptMode` is global/per-run via CLI, env var, or config.

### 2) `depends-on` frontmatter

- Use basename references only.
- A plan is runnable only when all dependencies are in `.ralph/out/`.

```md
---
depends-on: [prd-a.md, prd-b.md]
---
```

### 3) `source` frontmatter (issue linkage)

```md
---
source: github
issue: 42
issue-url: https://github.com/owner/repo/issues/42
---
```

- Supported source is `github`.
- `gh` CLI must be installed and authenticated.
- If `gh` is unavailable, issue hooks are skipped.

### 4) `group` frontmatter (multi-plan shared branch mode)

Use `group` when multiple plans should execute on one shared branch and one PR lifecycle.

```md
---
group: branch-merge-flow
---
```

- Plans with the same `group` are candidates to run on `ralph/<group-name>`.
- Grouped runs transition across multiple plans on the same branch.
- In PR mode, grouped runs use a draft PR lifecycle (create, update, finalize).
- Group members should still use `depends-on` where ordering matters.
- Keep `group` names stable and lowercase-kebab-case.

### 5) Specificity requirements

Plans must name concrete locations: files, functions, branches, and target lines when possible.

### 6) State what already works

Plans should explicitly mark existing infrastructure that must not be rebuilt.

### 7) Commit format requirements

Each task maps to one logical commit.
Commit messages must follow Conventional Commits.

### 8) Testing requirements by task type

- Bug fix plans must include reproduction + failing-test intent.
- Feature plans must specify new coverage expectations (happy path and edge/error path).
- Refactor plans must state invariants and coverage expectations.
- Docs/chore plans should explicitly state if tests are not required.

### 9) Learning capture policy

- Add a learnings task only when recurring mistakes or durable patterns were discovered.
- During runs, capture raw learnings in `.ralph/LEARNINGS.md`.
- Promote durable guidance to `LEARNINGS.md` and agent instruction docs after review.

## Anti-Patterns (Avoid)

### Critical

1. Tasks without acceptance criteria checkboxes.
2. Layer-first sequencing that postpones end-to-end validation.
3. Bug-fix plans without a concrete reproduction.

### High

4. Tasks too large to produce one logical commit.
5. Vague tasks without file/function targets.
6. Rebuilding existing code because "already works" context is missing.

### Medium

7. Omitting learnings updates when durable patterns were discovered.
8. Grouped plans with inconsistent `group` values or unresolved dependency assumptions.

## Standard Verification Block

Include this at the end of every runnable plan:

```markdown
## Verification

After each task:

- Build passes
- Tests pass
- Lint passes

Final verification:

- <end-to-end command>
- <specific behavioral assertions>

When using group mode, also verify:

- `npx ralphai run -- --dry-run` shows grouped plans on the expected shared branch
- grouped plan ordering matches dependency expectations
```

## Quick Author Checklist (Before Moving to Backlog)

- [ ] Correct plan type selected from `.ralph/plans/`
- [ ] Plan is in `.ralph/wip/` until runnable
- [ ] Dependencies are explicit (`depends-on`) or intentionally empty
- [ ] Every acceptance criterion is observable and testable
- [ ] Every task is one logical commit and leaves a green build
- [ ] Verification includes runnable commands and concrete checks
- [ ] Bug-fix plans include a minimal runnable reproduction when feasible
- [ ] If grouped: `group` value is consistent across member plans and dependency order is explicit
- [ ] Existing working infrastructure is called out explicitly
- [ ] Learnings trigger was evaluated and captured when applicable
- [ ] Stuck-risk is low (tasks are narrow enough to avoid repeated no-commit loops)

## Iteration Sizing

| Plan complexity | Recommended iterations (`ralph.sh`) |
| --- | --- |
| 3-5 small tasks | 5 |
| 6-10 tasks with wiring | 10-15 |
| Large feature (10+ tasks, new modules) | 15-25 |
| Structural refactor | 10-15 |

Use `npx ralphai run -- --dry-run` to validate readiness before long runs.
If a run stalls repeatedly, split tasks further before retrying.
Ralph may abort after consecutive non-commit iterations (`maxStuck`; see `docs/HOW-IT-WORKS.md`).
