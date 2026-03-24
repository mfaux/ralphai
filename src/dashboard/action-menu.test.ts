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
// repos panel
// ---------------------------------------------------------------------------

describe("buildMenuItems — repos panel", () => {
  it('returns a single "Select repo" action', () => {
    const items = buildMenuItems("repos", null, null);
    expect(items).toHaveLength(1);
    expect(items[0]!.action).toBe("select-repo");
  });
});

// ---------------------------------------------------------------------------
// pipeline panel
// ---------------------------------------------------------------------------

describe("buildMenuItems — pipeline panel", () => {
  it("returns empty array when no plan is selected", () => {
    expect(buildMenuItems("pipeline", null, null)).toEqual([]);
  });

  it("returns run actions for backlog plans", () => {
    const plan = makePlan({ slug: "add-auth", state: "backlog" });
    const items = buildMenuItems("pipeline", plan, null);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("run");
    expect(actions).toContain("run-worktree");
    expect(actions).toContain("view-plan");
    expect(items).toHaveLength(3);
  });

  it("returns monitoring actions for in-progress plans", () => {
    const plan = makePlan({ slug: "running-task", state: "in-progress" });
    const items = buildMenuItems("pipeline", plan, null);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("view-progress");
    expect(actions).toContain("view-output");
    expect(actions).toContain("reset");
    expect(items).toHaveLength(3);
  });

  it("returns archive actions for completed plans", () => {
    const plan = makePlan({ slug: "done-task", state: "completed" });
    const items = buildMenuItems("pipeline", plan, null);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("view-summary");
    expect(actions).toContain("view-output");
    expect(actions).toContain("purge");
    expect(items).toHaveLength(3);
  });

  it("includes keyboard shortcut hints", () => {
    const plan = makePlan({ slug: "my-plan", state: "backlog" });
    const items = buildMenuItems("pipeline", plan, null);
    const runItem = items.find((i) => i.action === "run");
    expect(runItem?.shortcut).toBe("r");
  });
});

// ---------------------------------------------------------------------------
// worktrees panel
// ---------------------------------------------------------------------------

describe("buildMenuItems — worktrees panel", () => {
  it("returns empty array when no worktree is selected", () => {
    expect(buildMenuItems("worktrees", null, null)).toEqual([]);
  });

  it("returns view + remove for idle worktrees", () => {
    const wt = makeWorktree({ shortBranch: "old-feature", status: "idle" });
    const items = buildMenuItems("worktrees", null, wt);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("view-linked-plan");
    expect(actions).toContain("remove-worktree");
    expect(items).toHaveLength(2);
  });

  it("omits remove for active worktrees", () => {
    const wt = makeWorktree({ shortBranch: "busy-feature", status: "active" });
    const items = buildMenuItems("worktrees", null, wt);

    const actions = items.map((i) => i.action);
    expect(actions).toContain("view-linked-plan");
    expect(actions).not.toContain("remove-worktree");
    expect(items).toHaveLength(1);
  });
});
