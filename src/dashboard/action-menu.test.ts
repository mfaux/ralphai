import { describe, it, expect } from "vitest";
import { buildMenuItems } from "./ActionMenu.tsx";
import type { PlanInfo, WorktreeInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(
  overrides: Partial<PlanInfo> & Pick<PlanInfo, "slug" | "state">,
): PlanInfo {
  return { filename: `${overrides.slug}.md`, ...overrides };
}

function makeWorktree(
  overrides: Partial<WorktreeInfo> &
    Pick<WorktreeInfo, "shortBranch" | "status">,
): WorktreeInfo {
  return {
    path: `/worktrees/${overrides.shortBranch}`,
    branch: `ralphai/${overrides.shortBranch}`,
    head: "abc1234",
    bare: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// plan context
// ---------------------------------------------------------------------------

describe("buildMenuItems — plan context", () => {
  it("returns empty array when no plan is selected", () => {
    expect(buildMenuItems("plan", null, null)).toEqual([]);
  });

  it("returns run actions for backlog plans", () => {
    const plan = makePlan({ slug: "add-auth", state: "backlog" });
    const items = buildMenuItems("plan", plan, null);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("run");
    expect(actions).toContain("view-plan");
    expect(items).toHaveLength(2);
  });

  it("returns monitoring actions for in-progress plans", () => {
    const plan = makePlan({ slug: "running-task", state: "in-progress" });
    const items = buildMenuItems("plan", plan, null);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("view-progress");
    expect(actions).toContain("view-output");
    expect(actions).toContain("reset");
    expect(actions).not.toContain("stop-run");
    expect(items).toHaveLength(3);
  });

  it("includes 'Stop run' for in-progress plans with a runnerPid", () => {
    const plan = makePlan({
      slug: "active-task",
      state: "in-progress",
      runnerPid: 12345,
    });
    const items = buildMenuItems("plan", plan, null);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("stop-run");
    expect(actions).toContain("view-progress");
    expect(actions).toContain("view-output");
    expect(actions).toContain("reset");
    expect(items).toHaveLength(4);
  });

  it("places 'Stop run' before 'Reset plan' for in-progress plans", () => {
    const plan = makePlan({
      slug: "active-task",
      state: "in-progress",
      runnerPid: 42,
    });
    const items = buildMenuItems("plan", plan, null);

    const stopIdx = items.findIndex((i) => i.action === "stop-run");
    const resetIdx = items.findIndex((i) => i.action === "reset");
    expect(stopIdx).toBeLessThan(resetIdx);
  });

  it("returns archive actions for completed plans", () => {
    const plan = makePlan({ slug: "done-task", state: "completed" });
    const items = buildMenuItems("plan", plan, null);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("view-summary");
    expect(actions).toContain("view-output");
    expect(actions).toContain("purge");
    expect(items).toHaveLength(3);
  });

  it("does not expose keyboard shortcut hints in menu items", () => {
    const plan = makePlan({ slug: "my-plan", state: "backlog" });
    const items = buildMenuItems("plan", plan, null);
    const runItem = items.find((i) => i.action === "run");
    expect(runItem).toEqual({ label: "Run plan", action: "run" });
  });
});

// ---------------------------------------------------------------------------
// worktree context
// ---------------------------------------------------------------------------

describe("buildMenuItems — worktree context", () => {
  it("returns empty array when no worktree is selected", () => {
    expect(buildMenuItems("worktree", null, null)).toEqual([]);
  });

  it("returns view + remove for idle worktrees", () => {
    const wt = makeWorktree({ shortBranch: "old-feature", status: "idle" });
    const items = buildMenuItems("worktree", null, wt);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("view-linked-plan");
    expect(actions).toContain("remove-worktree");
    expect(items).toHaveLength(2);
  });

  it("omits remove for active worktrees", () => {
    const wt = makeWorktree({ shortBranch: "busy-feature", status: "active" });
    const items = buildMenuItems("worktree", null, wt);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("view-linked-plan");
    expect(actions).not.toContain("remove-worktree");
    expect(items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// none context
// ---------------------------------------------------------------------------

describe("buildMenuItems — none context", () => {
  it("returns empty array", () => {
    expect(buildMenuItems("none", null, null)).toEqual([]);
  });
});
