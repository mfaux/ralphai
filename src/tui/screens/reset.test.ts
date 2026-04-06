/**
 * Tests for the reset screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/reset.tsx`:
 * - `livenessHint` — returns a human-readable hint for a plan's liveness
 * - `buildResetItems` — converts resettable plans to ListItem[] with liveness hints
 * - `resetSelect` — maps a selected value to a ResetIntent
 */

import { describe, it, expect } from "bun:test";
import type { InProgressPlan, LivenessStatus } from "../../pipeline-state.ts";
import { livenessHint, buildResetItems, resetSelect } from "./reset.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInProgressPlan(
  overrides?: Partial<InProgressPlan>,
): InProgressPlan {
  return {
    filename: "plan-1.md",
    slug: "plan-1",
    scope: "",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: false,
    liveness: { tag: "in_progress" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// livenessHint
// ---------------------------------------------------------------------------

describe("livenessHint", () => {
  it('returns "running" for running liveness', () => {
    expect(livenessHint({ tag: "running", pid: 42 })).toBe("running");
  });

  it('returns "stalled" for stalled liveness', () => {
    expect(livenessHint({ tag: "stalled" })).toBe("stalled");
  });

  it('returns "in progress" for in_progress liveness', () => {
    expect(livenessHint({ tag: "in_progress" })).toBe("in progress");
  });

  it("returns the outcome string for outcome liveness", () => {
    expect(livenessHint({ tag: "outcome", outcome: "stuck" })).toBe("stuck");
    expect(livenessHint({ tag: "outcome", outcome: "done" })).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// buildResetItems
// ---------------------------------------------------------------------------

describe("buildResetItems", () => {
  it("returns only a Back item for empty plans array", () => {
    const items = buildResetItems([]);
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("__back__");
    expect(items[0]!.label).toBe("Back");
  });

  it("creates items with liveness hints", () => {
    const plans = [
      makeInProgressPlan({
        filename: "feat-auth.md",
        slug: "feat-auth",
        liveness: { tag: "running", pid: 42 },
      }),
    ];
    const items = buildResetItems(plans);

    // Plan item + Back item
    expect(items).toHaveLength(2);
    expect(items[0]!.value).toBe("feat-auth");
    expect(items[0]!.label).toBe("feat-auth.md");
    expect(items[0]!.hint).toBe("running");
    expect(items[0]!.disabled).toBeFalsy();
  });

  it("includes scope in hint when present", () => {
    const plans = [
      makeInProgressPlan({
        slug: "plan-a",
        filename: "plan-a.md",
        scope: "backend",
        liveness: { tag: "stalled" },
      }),
    ];
    const items = buildResetItems(plans);

    expect(items[0]!.hint).toBe("scope: backend · stalled");
  });

  it("handles multiple plans with different liveness states", () => {
    const plans = [
      makeInProgressPlan({
        slug: "plan-a",
        filename: "plan-a.md",
        liveness: { tag: "running", pid: 100 },
      }),
      makeInProgressPlan({
        slug: "plan-b",
        filename: "plan-b.md",
        liveness: { tag: "stalled" },
      }),
      makeInProgressPlan({
        slug: "plan-c",
        filename: "plan-c.md",
        liveness: { tag: "in_progress" },
      }),
    ];
    const items = buildResetItems(plans);

    expect(items).toHaveLength(4); // 3 plans + Back
    expect(items[0]!.hint).toBe("running");
    expect(items[1]!.hint).toBe("stalled");
    expect(items[2]!.hint).toBe("in progress");
    expect(items[3]!.value).toBe("__back__");
  });

  it("always appends a Back item as the last entry", () => {
    const plans = [makeInProgressPlan()];
    const items = buildResetItems(plans);
    const last = items[items.length - 1]!;
    expect(last.value).toBe("__back__");
    expect(last.label).toBe("Back");
  });

  it("does not include hint on the Back item", () => {
    const plans = [makeInProgressPlan()];
    const items = buildResetItems(plans);
    const last = items[items.length - 1]!;
    expect(last.hint).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resetSelect
// ---------------------------------------------------------------------------

describe("resetSelect", () => {
  it("returns reset intent for a plan slug", () => {
    const intent = resetSelect("feat-auth");
    expect(intent).toEqual({ type: "reset", slug: "feat-auth" });
  });

  it("returns back intent for __back__ sentinel", () => {
    const intent = resetSelect("__back__");
    expect(intent).toEqual({ type: "back" });
  });

  it("treats any non-back value as a plan slug", () => {
    const intent = resetSelect("gh-42-some-plan");
    expect(intent).toEqual({ type: "reset", slug: "gh-42-some-plan" });
  });
});
