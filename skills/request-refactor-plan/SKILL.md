---
name: request-refactor-plan
description: >-
  Create a detailed refactor plan with tiny, independently-verifiable commits
  via user interview. Use when the user wants to restructure code without
  changing behavior, or requests a refactoring plan.
---

# Request Refactor Plan

Go through the steps below. You may skip steps if you don't consider them necessary.

1. Ask the user for a long, detailed description of the problem they want to solve and any potential ideas for solutions.

2. Explore the repo to verify their assertions and understand the current state of the codebase. Note specific file paths, function names, and line numbers — every concrete reference you include saves tokens the agent would otherwise spend exploring.

3. Ask whether they have considered other options, and present other options to them.

4. Interview the user about the implementation. Be extremely detailed and thorough.

5. Hammer out the exact scope of the implementation. Work out what you plan to change and what you plan not to change.

6. Look in the codebase to check for test coverage of this area of the codebase. If there is insufficient test coverage, ask the user what their plans for testing are.

7. Break the implementation into a series of small, independently-verifiable steps. Remember Martin Fowler's advice to "make each refactoring step as small as possible, so that you can always see the program working."

   Write each step as a `- [ ]` checkbox describing the observable change — not just what code to touch, but what's different when the step is done. Each checkbox becomes a task that Ralphai executes in a separate agent session, so it must be self-contained and leave the build green.

   Good:

   ```
   - [ ] `parseConfig()` accepts a `scope` option and returns scoped results; existing callers are unchanged; tests verify both scoped and unscoped paths
   ```

   Bad:

   ```
   - [ ] Move `parseConfig` to a new file
   - [ ] Update imports
   - [ ] Add tests
   ```

   Each step is a vertical slice: implementation + test updates + import fixups in one commit. Don't split "move code" / "fix imports" / "add tests" into separate steps.

8. Create a GitHub issue with the refactor plan using `gh issue create --label ralphai-prd`. Use the following template for the issue description:

<refactor-plan-template>

## Problem Statement

The problem that the developer is facing, from the developer's perspective.

Include concrete references to the current codebase: file paths, function names, and line numbers where the structural problem is visible.

## Solution

The solution to the problem, from the developer's perspective. Describe the target structure — what the codebase looks like when the refactor is done.

## Constraints

- No user-facing behavior changes
- All existing tests must pass before and after each step
- <any additional constraints from the interview>

## Background

Current state of the codebase relevant to this refactor. Name files, functions, line numbers. Explain what already exists that should NOT be rebuilt.

## Acceptance Criteria

A LONG, detailed list of steps. Each step is a `- [ ]` checkbox describing a small, independently-verifiable change that leaves the build green. Order them so each step builds on the last.

- [ ] <first step — describes the observable change and how to verify it>
- [ ] <second step — builds on the first, still leaves the build green>
- [ ] <each step is a vertical slice: implementation + tests + imports in one commit>

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Similar existing tests to use as a pattern (e.g. which test files demonstrate the conventions to follow)

## Documentation Impact

Evaluate which documentation needs to be created or updated:

- **README**: Does this change affect setup, usage, or API surface documented in README files?
- **Inline API docs**: Do public API signatures need new or updated JSDoc/TSDoc?
- **Architecture/design docs**: Do internal docs (e.g. `docs/` folder, ADRs) need updates?
- **User-facing docs**: Do external docs, help text, or CLI `--help` output need changes?
- **Changelog**: Does this warrant a changelog entry?

If no documentation changes are needed, state "None" with a brief justification.

## Out of Scope

A description of the things that are out of scope for this refactor.

## Further Notes (optional)

Any further notes about the refactor.

</refactor-plan-template>
