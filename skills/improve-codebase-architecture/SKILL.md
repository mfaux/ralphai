---
name: improve-codebase-architecture
description: >-
  Explore a codebase to find architectural improvement opportunities, focusing
  on deepening shallow modules for better testability. Use when the user wants
  to improve code structure, reduce coupling, or make modules more testable.
---

# Improve Codebase Architecture

Explore a codebase, surface architectural friction, discover opportunities for improving testability, and propose module-deepening refactors as PRDs for autonomous implementation.

A **deep module** (John Ousterhout, "A Philosophy of Software Design") has a small interface hiding a large implementation. Deep modules are more testable, more AI-navigable, and let you test at the boundary instead of inside.

## Process

### 1. Explore the codebase

Navigate the codebase naturally. Do NOT follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small files?
- Where are modules so shallow that the interface is nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called?
- Where do tightly-coupled modules create integration risk in the seams between them?
- Which parts of the codebase are untested, or hard to test?

The friction you encounter IS the signal.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate, show:

- **Cluster**: Which modules/concepts are involved
- **Why they're coupled**: Shared types, call patterns, co-ownership of a concept
- **Dependency category**: One of:
  - **In-process** — pure computation, no I/O. Just merge and test directly.
  - **Local-substitutable** — has a local test stand-in (e.g., PGLite, in-memory FS).
  - **Remote but owned** — your own services across a network boundary. Use ports & adapters.
  - **True external** — third-party services you don't control. Mock at the boundary.
- **Test impact**: What existing tests would be replaced by boundary tests

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. User picks a candidate

### 4. Frame the problem space

Before designing interfaces, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would need to rely on
- A rough illustrative code sketch to make the constraints concrete — this is not a proposal, just a way to ground the constraints

Show this to the user, then immediately proceed to Step 5. The user reads and thinks about the problem while design work happens in parallel.

### 5. Design multiple interfaces

Produce 3+ **radically different** interface designs for the deepened module. Give each a different design constraint:

- Design 1: "Minimize the interface — aim for 1-3 entry points max"
- Design 2: "Maximize flexibility — support many use cases and extension"
- Design 3: "Optimize for the most common caller — make the default case trivial"
- Design 4 (if applicable): "Design around the ports & adapters pattern for cross-boundary dependencies"

Each design should include:

1. Interface signature (types, methods, params)
2. Usage example showing how callers use it
3. What complexity it hides internally
4. Dependency strategy (how deps are handled — see dependency categories below)
5. Trade-offs

Present designs sequentially, then compare them in prose.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated — the user wants a strong read, not just a menu.

### 6. User picks an interface (or accepts recommendation)

### 7. Generate and review scenarios

After the user picks an interface, generate numbered Given/When/Then scenarios before creating the issue. These scenarios are the backbone of the PRD — they're what `prd-to-issues` decomposes into sub-issues.

Group scenarios under three categories:

**Boundary behavior** — specify the deepened module's new interface behavior. These become the boundary tests.

```
1. Given <input>, when <method> is called, then <expected output>
2. Given <error state>, when <method> is called, then <error behavior>
```

**Caller migration** — describe the journey from old structure to new. These map to vertical slices for `prd-to-issues`.

```
5. Given the new deep module exists, when callers still use the old imports,
   then both paths work (coexistence)
6. Given caller A uses the old API, when it's migrated to the new interface,
   then its behavior is preserved
7. Given all callers have migrated, when the old shallow modules are deleted,
   then the build passes
```

**Test replacement** — describe the testing transition. These ensure "replace, don't layer" is tracked as verifiable outcomes.

```
8. Given boundary tests cover <behavior>, when old unit tests for <module>
   are deleted, then behavior coverage is maintained
```

Present scenarios to the user for review. Iterate until the user approves.

### 8. Create GitHub issue

Create a refactor PRD as a GitHub issue using `gh issue create --label ralphai-prd`. Use the issue template below. Do NOT ask the user to review before creating — just create it and share the URL.

---

## Dependency Categories

When assessing a candidate for deepening, classify its dependencies:

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable — just merge the modules and test directly.

### 2. Local-substitutable

Dependencies that have local test stand-ins (e.g., PGLite for Postgres, in-memory filesystem). Deepenable if the test substitute exists. The deepened module is tested with the local stand-in running in the test suite.

### 3. Remote but owned (Ports & Adapters)

Your own services across a network boundary (microservices, internal APIs). Define a port (interface) at the module boundary. The deep module owns the logic; the transport is injected. Tests use an in-memory adapter. Production uses the real HTTP/gRPC/queue adapter.

Recommendation shape: "Define a shared interface (port), implement an HTTP adapter for production and an in-memory adapter for testing, so the logic can be tested as one deep module even though it's deployed across a network boundary."

### 4. True external (Mock)

Third-party services (Stripe, Twilio, etc.) you don't control. Mock at the boundary. The deepened module takes the external dependency as an injected port, and tests provide a mock implementation.

---

## Testing Strategy

The core principle: **replace, don't layer.**

- Old unit tests on shallow modules are waste once boundary tests exist — delete them
- Write new tests at the deepened module's interface boundary
- Tests assert on observable outcomes through the public interface, not internal state
- Tests should survive internal refactors — they describe behavior, not implementation

---

## Issue Template

```markdown
## Problem Statement

<Architectural friction from the user/maintainer perspective. Not just "modules
are shallow" — explain why the current structure makes the codebase harder to
understand, test, and change. What breaks, what's fragile, what's confusing.>

## Solution

<The deepened module — what it absorbs, what interface it exposes, and how
callers interact with it. Written for someone who will implement it, not
someone who designed it. Focus on what changes for the codebase consumer.>

## Scenarios

### Boundary behavior — so the new interface is well-specified

1. Given <input>, when <method> is called, then <expected output>
2. Given <different input>, when <method> is called, then <different output>
3. Given <error state>, when <method> is called, then <error behavior>

### Caller migration — so existing code transitions safely

4. Given the new deep module exists with <interface>, when callers still use
   the old imports, then both paths work (coexistence)
5. Given <caller A> uses the old API, when it's migrated to the new interface,
   then its behavior is preserved
6. Given all callers have migrated, when the old shallow modules are deleted,
   then the build passes

### Test replacement — so shallow tests don't accumulate

7. Given boundary tests cover <behavior>, when old unit tests for <module>
   are deleted, then behavior coverage is maintained

## Implementation Decisions

- **Module boundary**: what the module owns (responsibilities), what it hides
  (implementation details), what it exposes (the interface contract)
- **Interface contract**: types, methods, params — the chosen interface design
- **Dependency strategy**: which category applies (in-process / local-substitutable /
  ports & adapters / mock) and how dependencies are concretely handled
- **Migration path**: how callers move from the old API to the new interface,
  including any coexistence period

## Testing Decisions

- Boundary tests replace shallow unit tests (replace, don't layer)
- Tests assert on observable outcomes through the public interface, not
  internal state
- Test environment needs: any local stand-ins, adapters, or mocks required
- Existing test files to use as a pattern (if known)

## Documentation Impact

Evaluate which documentation needs to be created or updated:

- **README**: Does this change affect setup, usage, or API surface documented in README files?
- **Inline API docs**: Do public API signatures need new or updated JSDoc/TSDoc?
- **Architecture/design docs**: Do internal docs (e.g. `docs/` folder, ADRs) need updates?
- **User-facing docs**: Do external docs, help text, or CLI `--help` output need changes?
- **Changelog**: Does this warrant a changelog entry?

If no documentation changes are needed, state "None" with a brief justification.

## Out of Scope

- Adjacent modules that are NOT being deepened in this refactor
- Behavior changes — this is a structural refactor only
- Any other boundaries the user explicitly excluded
```
