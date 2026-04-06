/**
 * Tests for the status screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/status.tsx`:
 * - `livenessTag` — returns a human-readable liveness tag string
 * - `buildBacklogLine` — formats a backlog plan for display
 * - `buildInProgressLine` — formats an in-progress plan for display
 * - `buildCompletedLine` — formats a completed slug for display
 * - `statusSelect` — maps any selected value to a back intent
 */

import { describe, it, expect } from "bun:test";
import type { BacklogPlan, InProgressPlan } from "../../pipeline-state.ts";
import {
  livenessTag,
  buildBacklogLine,
  buildInProgressLine,
  buildCompletedLine,
  statusSelect,
} from "./status.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBacklogPlan(overrides?: Partial<BacklogPlan>): BacklogPlan {
  return {
    filename: "plan-1.md",
    scope: "",
    dependsOn: [],
    ...overrides,
  };
}

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
// livenessTag
// ---------------------------------------------------------------------------

describe("livenessTag", () => {
  it("returns running with PID for running liveness", () => {
    expect(livenessTag({ tag: "running", pid: 42 })).toBe("running PID 42");
  });

  it('returns "stalled" for stalled liveness', () => {
    expect(livenessTag({ tag: "stalled" })).toBe("stalled");
  });

  it('returns "in progress" for in_progress liveness', () => {
    expect(livenessTag({ tag: "in_progress" })).toBe("in progress");
  });

  it("returns the outcome string for outcome liveness", () => {
    expect(livenessTag({ tag: "outcome", outcome: "stuck" })).toBe("stuck");
    expect(livenessTag({ tag: "outcome", outcome: "done" })).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// buildBacklogLine
// ---------------------------------------------------------------------------

describe("buildBacklogLine", () => {
  it("returns filename and empty hint for a simple plan", () => {
    const line = buildBacklogLine(makeBacklogPlan());
    expect(line.label).toBe("plan-1.md");
    expect(line.hint).toBe("");
  });

  it("includes scope in hint when present", () => {
    const line = buildBacklogLine(makeBacklogPlan({ scope: "backend" }));
    expect(line.hint).toBe("scope: backend");
  });

  it("includes dependency info in hint when present", () => {
    const line = buildBacklogLine(makeBacklogPlan({ dependsOn: ["gh-42"] }));
    expect(line.hint).toBe("waiting on gh-42");
  });

  it("includes both scope and dependencies separated by dot", () => {
    const line = buildBacklogLine(
      makeBacklogPlan({ scope: "frontend", dependsOn: ["gh-42", "gh-43"] }),
    );
    expect(line.hint).toBe("scope: frontend · waiting on gh-42, gh-43");
  });

  it("uses filename as label", () => {
    const line = buildBacklogLine(
      makeBacklogPlan({ filename: "feat-auth.md" }),
    );
    expect(line.label).toBe("feat-auth.md");
  });
});

// ---------------------------------------------------------------------------
// buildInProgressLine
// ---------------------------------------------------------------------------

describe("buildInProgressLine", () => {
  it("includes liveness status in hint", () => {
    const line = buildInProgressLine(
      makeInProgressPlan({ liveness: { tag: "running", pid: 42 } }),
    );
    expect(line.hint).toContain("running PID 42");
  });

  it("includes scope when present", () => {
    const line = buildInProgressLine(makeInProgressPlan({ scope: "backend" }));
    expect(line.hint).toContain("scope: backend");
  });

  it("includes task progress when totalTasks is set", () => {
    const line = buildInProgressLine(
      makeInProgressPlan({ totalTasks: 10, tasksCompleted: 3 }),
    );
    expect(line.hint).toContain("3/10 tasks");
  });

  it("omits task progress when totalTasks is undefined", () => {
    const line = buildInProgressLine(
      makeInProgressPlan({ totalTasks: undefined }),
    );
    expect(line.hint).not.toContain("tasks");
  });

  it("omits task progress when totalTasks is 0", () => {
    const line = buildInProgressLine(makeInProgressPlan({ totalTasks: 0 }));
    expect(line.hint).not.toContain("tasks");
  });

  it("includes worktree info when hasWorktree is true", () => {
    const line = buildInProgressLine(
      makeInProgressPlan({ hasWorktree: true, slug: "feat-auth" }),
    );
    expect(line.hint).toContain("worktree: feat-auth");
  });

  it("omits worktree info when hasWorktree is false", () => {
    const line = buildInProgressLine(
      makeInProgressPlan({ hasWorktree: false }),
    );
    expect(line.hint).not.toContain("worktree");
  });

  it("joins all parts with dot separator", () => {
    const line = buildInProgressLine(
      makeInProgressPlan({
        scope: "backend",
        totalTasks: 5,
        tasksCompleted: 2,
        hasWorktree: true,
        slug: "feat-auth",
        liveness: { tag: "stalled" },
      }),
    );
    expect(line.hint).toBe(
      "scope: backend · 2/5 tasks · worktree: feat-auth · stalled",
    );
  });

  it("uses filename as label", () => {
    const line = buildInProgressLine(
      makeInProgressPlan({ filename: "feat-auth.md" }),
    );
    expect(line.label).toBe("feat-auth.md");
  });

  it("shows only liveness for minimal plan", () => {
    const line = buildInProgressLine(makeInProgressPlan());
    expect(line.hint).toBe("in progress");
  });
});

// ---------------------------------------------------------------------------
// buildCompletedLine
// ---------------------------------------------------------------------------

describe("buildCompletedLine", () => {
  it("appends .md to the slug", () => {
    const line = buildCompletedLine("feat-auth");
    expect(line.label).toBe("feat-auth.md");
  });

  it("returns empty hint", () => {
    const line = buildCompletedLine("feat-auth");
    expect(line.hint).toBe("");
  });
});

// ---------------------------------------------------------------------------
// statusSelect
// ---------------------------------------------------------------------------

describe("statusSelect", () => {
  it("returns back intent for __back__ sentinel", () => {
    const intent = statusSelect("__back__");
    expect(intent).toEqual({ type: "back" });
  });

  it("returns back intent for any value", () => {
    const intent = statusSelect("anything");
    expect(intent).toEqual({ type: "back" });
  });
});
