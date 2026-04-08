---
name: prd-to-issues
description: >-
  Break a PRD into independently-grabbable GitHub issues linked as native
  sub-issues using vertical slices. Use when the user has a PRD issue and
  wants to decompose it into implementable work items.
---

# PRD to Issues

Break a PRD into independently-grabbable GitHub issues using vertical slices (tracer bullets). Each issue is a thin end-to-end slice through every integration layer, linked to the PRD as a native GitHub sub-issue.

## Process

### 1. Locate the PRD

Ask the user for the PRD GitHub issue number or URL. Fetch it with `gh issue view <number>` if the PRD is not already in your context window.

Also fetch the PRD's node ID — you will need it to link sub-issues:

```bash
PRD_NODE_ID=$(gh issue view <number> --json id -q '.id')
```

### 2. Explore the codebase

Explore the codebase to understand the current architecture, existing patterns, integration layers, and conventions. This is not optional — you need this context to make good slicing decisions.

### 3. Identify durable architectural decisions

Before slicing, identify high-level decisions that are unlikely to change throughout implementation:

- Route structures / URL patterns
- Database schema shape
- Key data models
- Authentication / authorization approach
- Third-party service boundaries

These decisions will be referenced in every issue to keep slices consistent.

### 4. Draft vertical slices

Break the PRD into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- DO include durable decisions: route paths, schema shapes, data model names
- Do NOT include specific file names, function names, or implementation details that are likely to change as later slices are built
</vertical-slice-rules>

<refactor-slice-rules>
When the PRD describes a structural refactor (no user-facing behavior change), slicing works differently from feature PRDs. Slice along **migration steps through the codebase**, not feature paths through integration layers.

The natural slices for a refactor are:

1. **Foundation** — create the new module/interface with boundary tests. Old code is untouched. Both old and new exist simultaneously.
2. **Migration** (one slice per caller or caller group) — move callers from the old API to the new interface. Verify behavior is preserved.
3. **Cleanup** — delete old shallow modules and their now-redundant unit tests. Verify boundary tests cover everything.

Hard constraints for refactor slices:

- Every slice must leave the build green (tests pass, no broken imports)
- Old and new code coexist until cleanup — slices must not break the old path while the new path is being built
- Each migration slice is a vertical slice: implementation change + test update + import fixup in one issue
- Cleanup is always the last slice and is always AFK

Slicing granularity: group callers by coupling, not by count. If three callers share the same usage pattern, they're one slice. If two callers use the module differently, they're separate slices.

Blocking relationships for refactors: foundation blocks all migration slices. All migration slices block cleanup. Migration slices may be independent of each other (parallelizable) if they touch different callers.
</refactor-slice-rules>

For each slice, classify it:

- **AFK** — can be implemented and merged autonomously by Ralphai without human interaction
- **HITL** — requires human interaction (architectural decision, design review, external setup, etc.)

Prefer AFK over HITL where possible. Refactor slices are almost always AFK unless the dependency strategy requires human decisions (e.g., choosing a ports & adapters boundary or configuring an external service mock).

### 5. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **Scenarios covered**: which scenarios from the PRD this addresses

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?
- For refactors: does each migration step leave the build green? Is the coexistence period safe?

Iterate until the user approves the breakdown.

### 6. Create the GitHub issues as native sub-issues

Create issues in dependency order (blockers first) so you can reference real issue numbers in the "Blocked by" field. Track each issue's node ID as you go — you need them for setting blocking relationships.

For each approved slice, create a GitHub issue and link it as a sub-issue of the PRD:

```bash
# Create the issue
ISSUE_URL=$(gh issue create \
  --label ralphai-subissue \
  --title "<slice-title>" \
  --body "<issue-body>" \
  | tail -1)

# Extract the issue number from the URL
ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')

# Get the new issue's node ID
ISSUE_NODE_ID=$(gh issue view "$ISSUE_NUMBER" --json id -q '.id')

# Link as a native sub-issue of the PRD
gh api graphql -f query='
  mutation($parentId: ID!, $childId: ID!) {
    addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { number }
      subIssue { number }
    }
  }
' -f parentId="$PRD_NODE_ID" -f childId="$ISSUE_NODE_ID"
```

After each issue is created and linked, record its number and node ID for the blocking step.

Use this issue body template:

```markdown
## Parent PRD

#<prd-issue-number>

## Architectural context

<Relevant durable decisions from step 3 that apply to this slice — routes, schema, models, etc.>

## What to build

<Concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Reference specific sections of the parent PRD rather than duplicating content.>

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Scenarios addressed

Reference by number from the parent PRD:

- Scenario 3
- Scenario 7

## Documentation Impact

Which documentation is affected by this slice? Consider:

- **README**: Does this slice change setup, usage, or API surface documented in README files?
- **Inline API docs**: Do public API signatures need new or updated JSDoc/TSDoc?
- **Architecture/design docs**: Do internal docs (e.g. `docs/` folder, ADRs) need updates?
- **User-facing docs**: Do external docs, help text, or CLI `--help` output need changes?
- **Changelog**: Does this warrant a changelog entry?

If none, state "None" with a brief justification.

## Type

AFK / HITL
```

Note: the `## Parent PRD` section is kept for human readability on GitHub, but Ralphai uses the native sub-issue API for parent discovery — not body parsing.

Do NOT include a `## Blocked by` section in the body. Blocking relationships are set via the GitHub API in the next step.

### 7. Set blocking relationships via GraphQL

After all issues are created, set blocking relationships between slices using the node IDs you collected:

```bash
# For each pair where slice B is blocked by slice A:
gh api graphql -f query='
  mutation($blockedId: ID!, $blockerId: ID!) {
    addBlockedBy(input: { issueId: $blockedId, blockingIssueId: $blockerId }) {
      issue { number }
      blockingIssue { number }
    }
  }
' -f blockedId="$SLICE_B_NODE_ID" -f blockerId="$SLICE_A_NODE_ID"
```

Set all blocking relationships that were approved in step 5.

### 8. Verify

After all issues are created and linked, verify the result:

1. Print a summary table showing each slice's number, title, type (AFK/HITL), and blockers
2. Confirm the sub-issues appear on the PRD issue (GitHub renders these automatically)

Do NOT edit the PRD issue body. Do NOT append a task list or `## Slices` section. The native sub-issue list on GitHub replaces the old `- [ ] #N` pattern.

Do NOT close the parent PRD issue.
