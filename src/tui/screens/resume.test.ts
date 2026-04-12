/**
 * Tests for the resume screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/resume.tsx`:
 * - `buildResumeItems` — converts stalled plans to ListItem[] with progress hints
 * - `resumeSelect` — maps a selected value to a ResumeIntent
 * - `buildResumeConfirmItems` — builds Y/N confirmation items for a single plan
 * - `confirmResumeSelect` — maps a confirmation value to a ResumeIntent
 */

import { describe, it, expect } from "bun:test";
import type { InProgressPlan } from "../../plan-lifecycle.ts";
import {
  buildResumeItems,
  resumeSelect,
  buildResumeConfirmItems,
  confirmResumeSelect,
} from "./resume.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStalledPlan(overrides?: Partial<InProgressPlan>): InProgressPlan {
  return {
    filename: "plan-1.md",
    slug: "plan-1",
    scope: "",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: false,
    liveness: { tag: "stalled" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildResumeItems
// ---------------------------------------------------------------------------

describe("buildResumeItems", () => {
  it("returns only a Back item for empty plans array", () => {
    const items = buildResumeItems([]);
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("__back__");
    expect(items[0]!.label).toBe("Back");
  });

  it("creates items with progress hints when totalTasks is defined", () => {
    const plans = [
      makeStalledPlan({
        filename: "feat-auth.md",
        slug: "feat-auth",
        totalTasks: 5,
        tasksCompleted: 3,
      }),
    ];
    const items = buildResumeItems(plans);

    expect(items).toHaveLength(2);
    expect(items[0]!.value).toBe("feat-auth");
    expect(items[0]!.label).toBe("feat-auth.md");
    expect(items[0]!.hint).toBe("3/5 tasks");
    expect(items[0]!.disabled).toBeFalsy();
  });

  it("omits hint when totalTasks is undefined", () => {
    const plans = [
      makeStalledPlan({
        filename: "feat-auth.md",
        slug: "feat-auth",
        totalTasks: undefined,
      }),
    ];
    const items = buildResumeItems(plans);

    expect(items[0]!.hint).toBeUndefined();
  });

  it("shows progress hint with zero completed tasks", () => {
    const plans = [
      makeStalledPlan({
        totalTasks: 5,
        tasksCompleted: 0,
      }),
    ];
    const items = buildResumeItems(plans);

    expect(items[0]!.hint).toBe("0/5 tasks");
  });

  it("handles multiple stalled plans", () => {
    const plans = [
      makeStalledPlan({
        slug: "plan-a",
        filename: "plan-a.md",
        totalTasks: 3,
        tasksCompleted: 1,
      }),
      makeStalledPlan({
        slug: "plan-b",
        filename: "plan-b.md",
        totalTasks: 10,
        tasksCompleted: 7,
      }),
    ];
    const items = buildResumeItems(plans);

    expect(items).toHaveLength(3); // 2 plans + Back
    expect(items[0]!.hint).toBe("1/3 tasks");
    expect(items[1]!.hint).toBe("7/10 tasks");
    expect(items[2]!.value).toBe("__back__");
  });

  it("always appends a Back item as the last entry", () => {
    const plans = [makeStalledPlan()];
    const items = buildResumeItems(plans);
    const last = items[items.length - 1]!;
    expect(last.value).toBe("__back__");
    expect(last.label).toBe("Back");
  });
});

// ---------------------------------------------------------------------------
// resumeSelect
// ---------------------------------------------------------------------------

describe("resumeSelect", () => {
  it("returns resume intent for a plan slug", () => {
    const plans = [
      makeStalledPlan({ slug: "feat-auth", filename: "feat-auth.md" }),
    ];
    const intent = resumeSelect("feat-auth", plans);
    expect(intent).toEqual({
      type: "resume",
      slug: "feat-auth",
      filename: "feat-auth.md",
    });
  });

  it("returns back intent for __back__ sentinel", () => {
    const intent = resumeSelect("__back__", []);
    expect(intent).toEqual({ type: "back" });
  });

  it("treats any non-back value as a plan slug", () => {
    const plans = [
      makeStalledPlan({
        slug: "gh-42-some-plan",
        filename: "gh-42-some-plan.md",
      }),
    ];
    const intent = resumeSelect("gh-42-some-plan", plans);
    expect(intent).toEqual({
      type: "resume",
      slug: "gh-42-some-plan",
      filename: "gh-42-some-plan.md",
    });
  });

  it("falls back to slug-based filename when plan is not found", () => {
    const intent = resumeSelect("missing-plan", []);
    expect(intent).toEqual({
      type: "resume",
      slug: "missing-plan",
      filename: "missing-plan.md",
    });
  });
});

// ---------------------------------------------------------------------------
// buildResumeConfirmItems
// ---------------------------------------------------------------------------

describe("buildResumeConfirmItems", () => {
  it("builds two items: confirm and back", () => {
    const plan = makeStalledPlan({ slug: "my-plan", totalTasks: 5 });
    const items = buildResumeConfirmItems(plan);

    expect(items).toHaveLength(2);
    expect(items[0]!.value).toBe("__confirm__");
    expect(items[1]!.value).toBe("__back__");
  });

  it("includes slug and progress in the confirm label", () => {
    const plan = makeStalledPlan({
      slug: "feat-auth",
      totalTasks: 5,
      tasksCompleted: 3,
    });
    const items = buildResumeConfirmItems(plan);

    expect(items[0]!.label).toContain("feat-auth");
    expect(items[0]!.label).toContain("3/5 tasks");
  });

  it("omits progress when totalTasks is undefined", () => {
    const plan = makeStalledPlan({
      slug: "feat-x",
      totalTasks: undefined,
    });
    const items = buildResumeConfirmItems(plan);

    expect(items[0]!.label).toContain("feat-x");
    expect(items[0]!.label).not.toContain("tasks");
  });

  it("shows progress with zero completed tasks", () => {
    const plan = makeStalledPlan({
      slug: "feat-y",
      totalTasks: 5,
      tasksCompleted: 0,
    });
    const items = buildResumeConfirmItems(plan);

    expect(items[0]!.label).toContain("0/5 tasks");
  });

  it("back item has descriptive label", () => {
    const plan = makeStalledPlan();
    const items = buildResumeConfirmItems(plan);

    expect(items[1]!.label).toBe("No, go back");
  });
});

// ---------------------------------------------------------------------------
// confirmResumeSelect
// ---------------------------------------------------------------------------

describe("confirmResumeSelect", () => {
  it("returns resume intent when __confirm__ is selected", () => {
    const intent = confirmResumeSelect("__confirm__", "my-plan", "my-plan.md");
    expect(intent).toEqual({
      type: "resume",
      slug: "my-plan",
      filename: "my-plan.md",
    });
  });

  it("returns back intent when __back__ is selected", () => {
    const intent = confirmResumeSelect("__back__", "my-plan", "my-plan.md");
    expect(intent).toEqual({ type: "back" });
  });

  it("returns back intent for any non-confirm value", () => {
    const intent = confirmResumeSelect("unexpected", "my-plan", "my-plan.md");
    expect(intent).toEqual({ type: "back" });
  });
});
