---
name: write-a-prd
description: >-
  Create a product requirements document (PRD) through interactive interview,
  codebase exploration, and module design. Use when the user wants to plan a
  new feature, write a PRD, or design a system before implementation.
---

# Write a PRD

Help the user create a product requirements document (PRD) through an interactive interview, codebase exploration, and module design process. You may skip steps if you don't consider them necessary.

1. Ask the user for a long, detailed description of the problem they want to solve and any potential ideas for solutions.

2. Explore the repo to verify their assertions and understand the current state of the codebase.

3. Interview the user relentlessly about every aspect of this plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

4. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Check with the user that these modules match their expectations. Check with the user which modules they want tests written for.

5. Once you have a complete understanding of the problem and solution, use the template below to write the PRD. The PRD should be submitted as a GitHub issue with the label `ralphai-prd`.

Work items are linked as native GitHub sub-issues by the `prd-to-issues` skill — the PRD body should contain only the requirements document itself.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## Scenarios

A LONG, numbered list of scenarios in Given/When/Then format, grouped by domain under subsection headers. Each header should include a brief user-facing value statement explaining why this group matters.

### <Domain Area> — <user-facing value>

1. Given <precondition>, when <action>, then <expected outcome>

<scenario-example>
### Account Dashboard — so customers can monitor their finances at a glance

1. Given a customer with two linked accounts, when they open the dashboard, then they see each account's name and current balance
2. Given a customer with no linked accounts, when they open the dashboard, then they see a prompt to link an account
3. Given a customer viewing the dashboard, when an account balance updates, then the displayed balance reflects the new amount within 30 seconds
   </scenario-example>

This list should be extremely extensive and cover all aspects of the feature, including happy paths, edge cases, and error states.

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

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>
