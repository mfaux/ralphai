/**
 * Tests for the stop screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/stop.tsx`:
 * - `buildStopItems` — converts running plans to ListItem[] with PID hints
 * - `stopSelect` — maps a selected value to a StopIntent
 * - `buildConfirmItems` — builds Y/N confirmation items for a single plan
 * - `confirmSelect` — maps a confirmation value to a StopIntent
 */

import { describe, it, expect } from "bun:test";
import type { InProgressPlan } from "../../pipeline-state.ts";
import {
  buildStopItems,
  stopSelect,
  buildConfirmItems,
  confirmSelect,
} from "./stop.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunningPlan(overrides?: Partial<InProgressPlan>): InProgressPlan {
  return {
    filename: "plan-1.md",
    slug: "plan-1",
    scope: "",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: false,
    liveness: { tag: "running", pid: 12345 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildStopItems
// ---------------------------------------------------------------------------

describe("buildStopItems", () => {
  it("returns only a Back item for empty plans array", () => {
    const items = buildStopItems([]);
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("__back__");
    expect(items[0]!.label).toBe("Back");
  });

  it("creates items with PID hints for running plans", () => {
    const plans = [
      makeRunningPlan({
        filename: "feat-auth.md",
        slug: "feat-auth",
        liveness: { tag: "running", pid: 42 },
      }),
    ];
    const items = buildStopItems(plans);

    // Plan item + Back item
    expect(items).toHaveLength(2);
    expect(items[0]!.value).toBe("feat-auth");
    expect(items[0]!.label).toBe("feat-auth.md");
    expect(items[0]!.hint).toBe("PID 42");
    expect(items[0]!.disabled).toBeFalsy();
  });

  it("handles multiple running plans", () => {
    const plans = [
      makeRunningPlan({
        slug: "plan-a",
        filename: "plan-a.md",
        liveness: { tag: "running", pid: 100 },
      }),
      makeRunningPlan({
        slug: "plan-b",
        filename: "plan-b.md",
        liveness: { tag: "running", pid: 200 },
      }),
    ];
    const items = buildStopItems(plans);

    expect(items).toHaveLength(3); // 2 plans + Back
    expect(items[0]!.hint).toBe("PID 100");
    expect(items[1]!.hint).toBe("PID 200");
    expect(items[2]!.value).toBe("__back__");
  });

  it("always appends a Back item as the last entry", () => {
    const plans = [makeRunningPlan()];
    const items = buildStopItems(plans);
    const last = items[items.length - 1]!;
    expect(last.value).toBe("__back__");
    expect(last.label).toBe("Back");
  });
});

// ---------------------------------------------------------------------------
// stopSelect
// ---------------------------------------------------------------------------

describe("stopSelect", () => {
  it("returns stop intent for a plan slug", () => {
    const intent = stopSelect("feat-auth");
    expect(intent).toEqual({ type: "stop", slug: "feat-auth" });
  });

  it("returns back intent for __back__ sentinel", () => {
    const intent = stopSelect("__back__");
    expect(intent).toEqual({ type: "back" });
  });

  it("treats any non-back value as a plan slug", () => {
    const intent = stopSelect("gh-42-some-plan");
    expect(intent).toEqual({ type: "stop", slug: "gh-42-some-plan" });
  });
});

// ---------------------------------------------------------------------------
// buildConfirmItems
// ---------------------------------------------------------------------------

describe("buildConfirmItems", () => {
  it("builds two items: confirm and back", () => {
    const plan = makeRunningPlan({
      slug: "my-plan",
      liveness: { tag: "running", pid: 999 },
    });
    const items = buildConfirmItems(plan);

    expect(items).toHaveLength(2);
    expect(items[0]!.value).toBe("__confirm__");
    expect(items[1]!.value).toBe("__back__");
  });

  it("includes slug and PID in the confirm label", () => {
    const plan = makeRunningPlan({
      slug: "feat-auth",
      liveness: { tag: "running", pid: 42 },
    });
    const items = buildConfirmItems(plan);

    expect(items[0]!.label).toContain("feat-auth");
    expect(items[0]!.label).toContain("PID 42");
  });

  it("omits PID when liveness is not running", () => {
    const plan = makeRunningPlan({
      slug: "feat-x",
      liveness: { tag: "stalled" },
    });
    const items = buildConfirmItems(plan);

    expect(items[0]!.label).toContain("feat-x");
    expect(items[0]!.label).not.toContain("PID");
  });

  it("back item has descriptive label", () => {
    const plan = makeRunningPlan();
    const items = buildConfirmItems(plan);

    expect(items[1]!.label).toBe("No, go back");
  });
});

// ---------------------------------------------------------------------------
// confirmSelect
// ---------------------------------------------------------------------------

describe("confirmSelect", () => {
  it("returns stop intent when __confirm__ is selected", () => {
    const intent = confirmSelect("__confirm__", "my-plan");
    expect(intent).toEqual({ type: "stop", slug: "my-plan" });
  });

  it("returns back intent when __back__ is selected", () => {
    const intent = confirmSelect("__back__", "my-plan");
    expect(intent).toEqual({ type: "back" });
  });

  it("returns back intent for any non-confirm value", () => {
    const intent = confirmSelect("unexpected", "my-plan");
    expect(intent).toEqual({ type: "back" });
  });
});
