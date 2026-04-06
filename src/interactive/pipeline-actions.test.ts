/**
 * Tests for interactive pipeline action helpers.
 *
 * Tests the pure helper functions: stalledPlans, runningPlans,
 * resettablePlans, stalledWarning, resumeStalledMenuItem,
 * stopRunningMenuItem, and resetPlanMenuItem. These are pure unit
 * tests — no filesystem, no subprocess, no clack prompts.
 */

import { describe, it, expect } from "bun:test";
import type { PipelineState, InProgressPlan } from "../pipeline-state.ts";
import {
  stalledPlans,
  runningPlans,
  resettablePlans,
  stalledWarning,
  resumeStalledMenuItem,
  stopRunningMenuItem,
  resetPlanMenuItem,
} from "./pipeline-actions.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    backlog: [],
    inProgress: [],
    completedSlugs: [],
    worktrees: [],
    problems: [],
    ...overrides,
  };
}

function makeStalledPlan(slug: string, scope = ""): InProgressPlan {
  return {
    filename: `${slug}.md`,
    slug,
    scope,
    totalTasks: 5,
    tasksCompleted: 2,
    hasWorktree: true,
    liveness: { tag: "stalled" },
  };
}

function makeRunningPlan(slug: string, pid = 12345): InProgressPlan {
  return {
    filename: `${slug}.md`,
    slug,
    scope: "",
    totalTasks: 3,
    tasksCompleted: 1,
    hasWorktree: true,
    liveness: { tag: "running", pid },
  };
}

function makeInProgressPlan(slug: string): InProgressPlan {
  return {
    filename: `${slug}.md`,
    slug,
    scope: "",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: false,
    liveness: { tag: "in_progress" },
  };
}

function makeOutcomePlan(slug: string, outcome: string): InProgressPlan {
  return {
    filename: `${slug}.md`,
    slug,
    scope: "",
    totalTasks: 3,
    tasksCompleted: 3,
    hasWorktree: false,
    liveness: { tag: "outcome", outcome },
  };
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

describe("stalledPlans", () => {
  it("returns empty when no plans are stalled", () => {
    const state = makeState({
      inProgress: [makeRunningPlan("a"), makeInProgressPlan("b")],
    });
    expect(stalledPlans(state)).toEqual([]);
  });

  it("returns only stalled plans", () => {
    const stalled = makeStalledPlan("dead");
    const state = makeState({
      inProgress: [
        makeRunningPlan("alive"),
        stalled,
        makeInProgressPlan("new"),
      ],
    });
    expect(stalledPlans(state)).toEqual([stalled]);
  });
});

describe("runningPlans", () => {
  it("returns empty when nothing is running", () => {
    const state = makeState({
      inProgress: [makeStalledPlan("a"), makeInProgressPlan("b")],
    });
    expect(runningPlans(state)).toEqual([]);
  });

  it("returns only running plans", () => {
    const running = makeRunningPlan("alive");
    const state = makeState({
      inProgress: [running, makeStalledPlan("dead")],
    });
    expect(runningPlans(state)).toEqual([running]);
  });
});

describe("resettablePlans", () => {
  it("returns empty when no in-progress plans exist", () => {
    const state = makeState();
    expect(resettablePlans(state)).toEqual([]);
  });

  it("excludes outcome-based plans", () => {
    const running = makeRunningPlan("a");
    const stalled = makeStalledPlan("b");
    const inProg = makeInProgressPlan("c");
    const state = makeState({
      inProgress: [running, stalled, inProg, makeOutcomePlan("d", "done")],
    });
    expect(resettablePlans(state)).toEqual([running, stalled, inProg]);
  });
});

// ---------------------------------------------------------------------------
// stalledWarning
// ---------------------------------------------------------------------------

describe("stalledWarning", () => {
  it("returns undefined when no plans are stalled", () => {
    const state = makeState();
    expect(stalledWarning(state)).toBeUndefined();
  });

  it("returns singular warning for 1 stalled plan", () => {
    const state = makeState({
      inProgress: [makeStalledPlan("dead")],
    });
    expect(stalledWarning(state)).toBe("⚠ 1 plan stalled");
  });

  it("returns plural warning for multiple stalled plans", () => {
    const state = makeState({
      inProgress: [makeStalledPlan("a"), makeStalledPlan("b")],
    });
    expect(stalledWarning(state)).toBe("⚠ 2 plans stalled");
  });

  it("only counts stalled plans, not running or in_progress", () => {
    const state = makeState({
      inProgress: [
        makeStalledPlan("stalled"),
        makeRunningPlan("running"),
        makeInProgressPlan("new"),
      ],
    });
    expect(stalledWarning(state)).toBe("⚠ 1 plan stalled");
  });
});

// ---------------------------------------------------------------------------
// resumeStalledMenuItem
// ---------------------------------------------------------------------------

describe("resumeStalledMenuItem", () => {
  it("is disabled with (none) when no stalled plans", () => {
    const state = makeState();
    const item = resumeStalledMenuItem(state);

    expect(item.label).toBe("Resume stalled plan");
    expect(item.hint).toBe("(none)");
    expect(item.disabled).toBe(true);
  });

  it("shows count for stalled plans", () => {
    const state = makeState({
      inProgress: [makeStalledPlan("a"), makeStalledPlan("b")],
    });
    const item = resumeStalledMenuItem(state);

    expect(item.label).toBe("Resume stalled plan (2 stalled)");
    expect(item.disabled).toBe(false);
  });

  it("shows singular count for 1 stalled plan", () => {
    const state = makeState({
      inProgress: [makeStalledPlan("only")],
    });
    const item = resumeStalledMenuItem(state);

    expect(item.label).toBe("Resume stalled plan (1 stalled)");
    expect(item.disabled).toBe(false);
  });

  it("ignores running and in_progress plans", () => {
    const state = makeState({
      inProgress: [makeRunningPlan("a"), makeInProgressPlan("b")],
    });
    const item = resumeStalledMenuItem(state);

    expect(item.disabled).toBe(true);
    expect(item.hint).toBe("(none)");
  });
});

// ---------------------------------------------------------------------------
// stopRunningMenuItem
// ---------------------------------------------------------------------------

describe("stopRunningMenuItem", () => {
  it("is disabled with (none) when nothing running", () => {
    const state = makeState();
    const item = stopRunningMenuItem(state);

    expect(item.label).toBe("Stop running plan");
    expect(item.hint).toBe("(none)");
    expect(item.disabled).toBe(true);
  });

  it("shows count for running plans", () => {
    const state = makeState({
      inProgress: [makeRunningPlan("a"), makeRunningPlan("b")],
    });
    const item = stopRunningMenuItem(state);

    expect(item.label).toBe("Stop running plan (2 running)");
    expect(item.disabled).toBe(false);
  });

  it("shows singular count for 1 running plan", () => {
    const state = makeState({
      inProgress: [makeRunningPlan("only")],
    });
    const item = stopRunningMenuItem(state);

    expect(item.label).toBe("Stop running plan (1 running)");
    expect(item.disabled).toBe(false);
  });

  it("ignores stalled and in_progress plans", () => {
    const state = makeState({
      inProgress: [makeStalledPlan("dead"), makeInProgressPlan("new")],
    });
    const item = stopRunningMenuItem(state);

    expect(item.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetPlanMenuItem
// ---------------------------------------------------------------------------

describe("resetPlanMenuItem", () => {
  it("is disabled with (none) when no in-progress plans", () => {
    const state = makeState();
    const item = resetPlanMenuItem(state);

    expect(item.label).toBe("Reset plan");
    expect(item.hint).toBe("(none)");
    expect(item.disabled).toBe(true);
  });

  it("shows count for resettable plans", () => {
    const state = makeState({
      inProgress: [makeRunningPlan("a"), makeStalledPlan("b")],
    });
    const item = resetPlanMenuItem(state);

    expect(item.label).toBe("Reset plan (2 in progress)");
    expect(item.disabled).toBe(false);
  });

  it("excludes outcome-based plans from count", () => {
    const state = makeState({
      inProgress: [makeRunningPlan("a"), makeOutcomePlan("done", "done")],
    });
    const item = resetPlanMenuItem(state);

    expect(item.label).toBe("Reset plan (1 in progress)");
    expect(item.disabled).toBe(false);
  });

  it("is disabled when only outcome plans exist", () => {
    const state = makeState({
      inProgress: [makeOutcomePlan("done", "done")],
    });
    const item = resetPlanMenuItem(state);

    expect(item.disabled).toBe(true);
    expect(item.hint).toBe("(none)");
  });
});
