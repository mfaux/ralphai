/**
 * Tests for the interactive menu module.
 *
 * Tests buildMenuItems and buildHeaderLine with various PipelineState
 * inputs. These are pure unit tests — no filesystem, no subprocess.
 */

import { describe, it, expect } from "bun:test";
import { stripAnsi } from "../utils.ts";
import type { PipelineState } from "../pipeline-state.ts";
import {
  buildHeaderLine,
  buildMenuItems,
  type MenuItem,
  type MenuContext,
} from "./menu.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal PipelineState for testing. */
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

/** Create N backlog plan stubs with optional customization. */
function makeBacklog(
  count: number,
  opts?: { scope?: string; dependsOn?: string[] },
) {
  return Array.from({ length: count }, (_, i) => ({
    filename: `plan-${i + 1}.md`,
    scope: opts?.scope ?? "",
    dependsOn: opts?.dependsOn ?? ([] as string[]),
  }));
}

/** Create N in-progress plan stubs with optional liveness tag. */
function makeInProgress(
  count: number,
  liveness?: "in_progress" | "stalled" | "running",
) {
  const tag = liveness ?? "in_progress";
  return Array.from({ length: count }, (_, i) => ({
    filename: `wip-${i + 1}.md`,
    slug: `wip-${i + 1}`,
    scope: "",
    totalTasks: 3 as number | undefined,
    tasksCompleted: 1,
    hasWorktree: false,
    liveness:
      tag === "running"
        ? { tag: "running" as const, pid: 10000 + i }
        : ({ tag } as { tag: "in_progress" } | { tag: "stalled" }),
  }));
}

const NO_GITHUB: MenuContext = { hasGitHubIssues: false };
const WITH_GITHUB: MenuContext = { hasGitHubIssues: true };

// ---------------------------------------------------------------------------
// buildHeaderLine
// ---------------------------------------------------------------------------

describe("buildHeaderLine", () => {
  it("shows 'empty' when no plans exist in any state", () => {
    const state = makeState();
    const header = stripAnsi(buildHeaderLine(state));
    expect(header).toBe("Pipeline: empty");
  });

  it("shows counts for backlog, running, and completed", () => {
    const state = makeState({
      backlog: makeBacklog(3),
      inProgress: makeInProgress(1),
      completedSlugs: ["done-a", "done-b", "done-c", "done-d", "done-e"],
    });
    const header = stripAnsi(buildHeaderLine(state));
    expect(header).toBe(
      "Pipeline: 3 backlog \u00b7 1 running \u00b7 5 completed",
    );
  });

  it("shows zero counts when some categories are empty", () => {
    const state = makeState({
      completedSlugs: ["done-a", "done-b"],
    });
    const header = stripAnsi(buildHeaderLine(state));
    expect(header).toBe(
      "Pipeline: 0 backlog \u00b7 0 running \u00b7 2 completed",
    );
  });

  it("shows counts when only backlog has plans", () => {
    const state = makeState({
      backlog: makeBacklog(5),
    });
    const header = stripAnsi(buildHeaderLine(state));
    expect(header).toBe(
      "Pipeline: 5 backlog \u00b7 0 running \u00b7 0 completed",
    );
  });

  it("shows counts when only in-progress has plans", () => {
    const state = makeState({
      inProgress: makeInProgress(2),
    });
    const header = stripAnsi(buildHeaderLine(state));
    expect(header).toBe(
      "Pipeline: 0 backlog \u00b7 2 running \u00b7 0 completed",
    );
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — structure and ordering
// ---------------------------------------------------------------------------

describe("buildMenuItems", () => {
  it("returns all expected menu items", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);

    const values = items.map((i) => i.value);
    expect(values).toContain("resume-stalled");
    expect(values).toContain("run-next");
    expect(values).toContain("pick-from-backlog");
    expect(values).toContain("pick-from-github");
    expect(values).toContain("run-with-options");
    expect(values).toContain("stop-running");
    expect(values).toContain("reset-plan");
    expect(values).toContain("view-status");
    expect(values).toContain("recent-activity");
    expect(values).toContain("doctor");
    expect(values).toContain("clean");
    expect(values).toContain("view-config");
    expect(values).toContain("edit-config");
    expect(values).toContain("quit");
  });

  it("orders items by group: run, pipeline, maintenance", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);

    const runNextIdx = items.findIndex((i) => i.value === "run-next");
    const pickIdx = items.findIndex((i) => i.value === "pick-from-backlog");
    const statusIdx = items.findIndex((i) => i.value === "view-status");
    const quitIdx = items.findIndex((i) => i.value === "quit");

    // Run group before pipeline before maintenance
    expect(runNextIdx).toBeLessThan(statusIdx);
    expect(pickIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(quitIdx);
  });

  it("always returns the same number of items", () => {
    const emptyItems = buildMenuItems(makeState(), NO_GITHUB);
    const busyItems = buildMenuItems(
      makeState({
        backlog: makeBacklog(10),
        inProgress: makeInProgress(3),
        completedSlugs: ["a", "b", "c"],
      }),
      NO_GITHUB,
    );

    expect(emptyItems.length).toBe(busyItems.length);
    expect(emptyItems.map((i) => i.value)).toEqual(
      busyItems.map((i) => i.value),
    );
  });

  it("all items have required fields", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);

    for (const item of items) {
      expect(item.value).toBeTypeOf("string");
      expect(item.value.length).toBeGreaterThan(0);
      expect(item.label).toBeTypeOf("string");
      expect(item.label.length).toBeGreaterThan(0);
      expect(["run", "pipeline", "maintenance"]).toContain(item.group);
    }
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — "Run next plan" item
// ---------------------------------------------------------------------------

describe("buildMenuItems — Run next plan", () => {
  it("shows auto-detected plan name when backlog has a ready plan", () => {
    const state = makeState({ backlog: makeBacklog(3) });
    const items = buildMenuItems(state, NO_GITHUB);
    const runNext = items.find((i) => i.value === "run-next")!;

    expect(runNext.label).toBe("Run next plan (plan-1.md)");
    expect(runNext.disabled).toBeFalsy();
  });

  it("skips blocked plans and shows first ready plan name", () => {
    const state = makeState({
      backlog: [
        { filename: "blocked.md", scope: "", dependsOn: ["dep-a.md"] },
        { filename: "ready.md", scope: "", dependsOn: [] },
      ],
    });
    const items = buildMenuItems(state, NO_GITHUB);
    const runNext = items.find((i) => i.value === "run-next")!;

    expect(runNext.label).toBe("Run next plan (ready.md)");
    expect(runNext.disabled).toBeFalsy();
  });

  it("is disabled with '(nothing queued)' when backlog is empty and no GitHub", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const runNext = items.find((i) => i.value === "run-next")!;

    expect(runNext.label).toBe("Run next plan");
    expect(runNext.hint).toBe("(nothing queued)");
    expect(runNext.disabled).toBe(true);
  });

  it("is disabled when all plans are blocked", () => {
    const state = makeState({
      backlog: [
        { filename: "a.md", scope: "", dependsOn: ["dep.md"] },
        { filename: "b.md", scope: "", dependsOn: ["other.md"] },
      ],
    });
    const items = buildMenuItems(state, NO_GITHUB);
    const runNext = items.find((i) => i.value === "run-next")!;

    expect(runNext.disabled).toBe(true);
    expect(runNext.hint).toBe("(nothing queued)");
  });

  it("is enabled with GitHub hint when backlog is empty but GitHub configured", () => {
    const state = makeState();
    const items = buildMenuItems(state, WITH_GITHUB);
    const runNext = items.find((i) => i.value === "run-next")!;

    expect(runNext.label).toBe("Run next plan");
    expect(runNext.hint).toBe("will pull from GitHub");
    expect(runNext.disabled).toBe(false);
  });

  it("is disabled with '(no GitHub issues)' when backlog empty and GitHub count is 0", () => {
    const state = makeState();
    const ctx: MenuContext = { hasGitHubIssues: true, githubIssueCount: 0 };
    const items = buildMenuItems(state, ctx);
    const runNext = items.find((i) => i.value === "run-next")!;

    expect(runNext.label).toBe("Run next plan");
    expect(runNext.hint).toBe("(no GitHub issues)");
    expect(runNext.disabled).toBe(true);
  });

  it("shows issue count in hint when backlog empty and GitHub issues available", () => {
    const state = makeState();
    const ctx: MenuContext = { hasGitHubIssues: true, githubIssueCount: 7 };
    const items = buildMenuItems(state, ctx);
    const runNext = items.find((i) => i.value === "run-next")!;

    expect(runNext.label).toBe("Run next plan");
    expect(runNext.hint).toBe("will pull oldest of 7 from GitHub");
    expect(runNext.disabled).toBe(false);
  });

  it("recognizes completed dependencies and shows plan as next", () => {
    const state = makeState({
      backlog: [
        { filename: "depends-on-done.md", scope: "", dependsOn: ["dep-a"] },
      ],
      completedSlugs: ["dep-a"],
    });
    const items = buildMenuItems(state, NO_GITHUB);
    const runNext = items.find((i) => i.value === "run-next")!;

    expect(runNext.label).toBe("Run next plan (depends-on-done.md)");
    expect(runNext.disabled).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — "Pick from backlog" item
// ---------------------------------------------------------------------------

describe("buildMenuItems — Pick from backlog", () => {
  it("shows count when backlog has plans", () => {
    const state = makeState({ backlog: makeBacklog(5) });
    const items = buildMenuItems(state, NO_GITHUB);
    const pick = items.find((i) => i.value === "pick-from-backlog")!;

    expect(pick.label).toBe("Pick from backlog (5 plans)");
    expect(pick.disabled).toBeFalsy();
  });

  it("uses singular 'plan' for count of 1", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);
    const pick = items.find((i) => i.value === "pick-from-backlog")!;

    expect(pick.label).toBe("Pick from backlog (1 plan)");
  });

  it("is disabled with '(empty)' when backlog is empty", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const pick = items.find((i) => i.value === "pick-from-backlog")!;

    expect(pick.label).toBe("Pick from backlog");
    expect(pick.hint).toBe("(empty)");
    expect(pick.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — "Pick from GitHub" item
// ---------------------------------------------------------------------------

describe("buildMenuItems — Pick from GitHub", () => {
  it("includes pick-from-github in menu items", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const values = items.map((i) => i.value);
    expect(values).toContain("pick-from-github");
  });

  it("is in the run group", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const pick = items.find((i) => i.value === "pick-from-github")!;
    expect(pick.group).toBe("run");
  });

  it("is disabled with (not configured) when GitHub is not configured", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.label).toBe("Pick from GitHub");
    expect(pick.hint).toBe("(not configured)");
    expect(pick.disabled).toBe(true);
  });

  it("is enabled when GitHub is configured", () => {
    const state = makeState();
    const items = buildMenuItems(state, WITH_GITHUB);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.disabled).toBeFalsy();
  });

  it("shows issue count when available", () => {
    const state = makeState();
    const ctx: MenuContext = { hasGitHubIssues: true, githubIssueCount: 7 };
    const items = buildMenuItems(state, ctx);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.label).toBe("Pick from GitHub (7 issues)");
    expect(pick.disabled).toBeFalsy();
  });

  it("is disabled with (no issues) when count is 0", () => {
    const state = makeState();
    const ctx: MenuContext = { hasGitHubIssues: true, githubIssueCount: 0 };
    const items = buildMenuItems(state, ctx);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.label).toBe("Pick from GitHub");
    expect(pick.hint).toBe("(no issues)");
    expect(pick.disabled).toBe(true);
  });

  it("appears before view-status in the ordering", () => {
    const state = makeState();
    const items = buildMenuItems(state, WITH_GITHUB);
    const pickIdx = items.findIndex((i) => i.value === "pick-from-github");
    const statusIdx = items.findIndex((i) => i.value === "view-status");

    expect(pickIdx).toBeLessThan(statusIdx);
  });
});

// ---------------------------------------------------------------------------
// buildHeaderLine — stalled warning
// ---------------------------------------------------------------------------

describe("buildHeaderLine — stalled warning", () => {
  it("appends singular stalled warning when 1 plan is stalled", () => {
    const state = makeState({
      inProgress: makeInProgress(1, "stalled"),
      backlog: makeBacklog(2),
    });
    const header = stripAnsi(buildHeaderLine(state));
    expect(header).toBe(
      "Pipeline: 2 backlog \u00b7 1 running \u00b7 0 completed \u00b7 \u26a0 1 plan stalled",
    );
  });

  it("appends plural stalled warning when multiple plans are stalled", () => {
    const state = makeState({
      inProgress: makeInProgress(2, "stalled"),
    });
    const header = stripAnsi(buildHeaderLine(state));
    expect(header).toContain("\u26a0 2 plans stalled");
  });

  it("does not include stalled warning when no plans are stalled", () => {
    const state = makeState({
      inProgress: makeInProgress(1),
    });
    const header = stripAnsi(buildHeaderLine(state));
    expect(header).not.toContain("\u26a0");
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — stalled promotion
// ---------------------------------------------------------------------------

describe("buildMenuItems — stalled promotion", () => {
  it("promotes resume-stalled to top of menu when stalled plans exist", () => {
    const state = makeState({
      inProgress: makeInProgress(1, "stalled"),
      backlog: makeBacklog(2),
    });
    const items = buildMenuItems(state, NO_GITHUB);

    // resume-stalled should be the first item (promoted to run group)
    expect(items[0]!.value).toBe("resume-stalled");
    expect(items[0]!.group).toBe("run");
  });

  it("resume-stalled is in pipeline group when no stalled plans", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);
    const resume = items.find((i) => i.value === "resume-stalled")!;

    expect(resume.group).toBe("pipeline");
    expect(resume.disabled).toBe(true);
  });

  it("resume-stalled appears before run-next when stalled", () => {
    const state = makeState({
      inProgress: makeInProgress(1, "stalled"),
      backlog: makeBacklog(1),
    });
    const items = buildMenuItems(state, NO_GITHUB);
    const resumeIdx = items.findIndex((i) => i.value === "resume-stalled");
    const runNextIdx = items.findIndex((i) => i.value === "run-next");

    expect(resumeIdx).toBeLessThan(runNextIdx);
  });

  it("resume-stalled appears after run group when not stalled", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);
    const resumeIdx = items.findIndex((i) => i.value === "resume-stalled");
    const runNextIdx = items.findIndex((i) => i.value === "run-next");

    expect(resumeIdx).toBeGreaterThan(runNextIdx);
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — recent activity item
// ---------------------------------------------------------------------------

describe("buildMenuItems — Recent activity", () => {
  it("is disabled with (none) when no completed plans", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const recent = items.find((i) => i.value === "recent-activity")!;

    expect(recent.label).toBe("Recent activity");
    expect(recent.hint).toBe("(none)");
    expect(recent.disabled).toBe(true);
  });

  it("shows count when completed plans exist", () => {
    const state = makeState({
      completedSlugs: ["done-a", "done-b", "done-c"],
    });
    const items = buildMenuItems(state, NO_GITHUB);
    const recent = items.find((i) => i.value === "recent-activity")!;

    expect(recent.label).toBe("Recent activity (3 completed)");
    expect(recent.disabled).toBe(false);
  });

  it("is in the pipeline group", () => {
    const state = makeState({ completedSlugs: ["done"] });
    const items = buildMenuItems(state, NO_GITHUB);
    const recent = items.find((i) => i.value === "recent-activity")!;

    expect(recent.group).toBe("pipeline");
  });

  it("appears after view-status but before quit", () => {
    const state = makeState({ completedSlugs: ["done"] });
    const items = buildMenuItems(state, NO_GITHUB);
    const statusIdx = items.findIndex((i) => i.value === "view-status");
    const recentIdx = items.findIndex((i) => i.value === "recent-activity");
    const quitIdx = items.findIndex((i) => i.value === "quit");

    expect(recentIdx).toBeGreaterThan(statusIdx);
    expect(recentIdx).toBeLessThan(quitIdx);
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — pipeline management items
// ---------------------------------------------------------------------------

describe("buildMenuItems — pipeline management items", () => {
  it("includes stop-running in pipeline group", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const stop = items.find((i) => i.value === "stop-running")!;

    expect(stop.group).toBe("pipeline");
  });

  it("includes reset-plan in pipeline group", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const reset = items.find((i) => i.value === "reset-plan")!;

    expect(reset.group).toBe("pipeline");
  });

  it("stop-running shows count when plans are running", () => {
    const state = makeState({
      inProgress: makeInProgress(2, "running"),
    });
    const items = buildMenuItems(state, NO_GITHUB);
    const stop = items.find((i) => i.value === "stop-running")!;

    expect(stop.label).toBe("Stop running plan (2 running)");
    expect(stop.disabled).toBeFalsy();
  });

  it("stop-running is disabled when nothing running", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const stop = items.find((i) => i.value === "stop-running")!;

    expect(stop.hint).toBe("(none)");
    expect(stop.disabled).toBe(true);
  });

  it("reset-plan shows count when plans are in progress", () => {
    const state = makeState({
      inProgress: makeInProgress(3),
    });
    const items = buildMenuItems(state, NO_GITHUB);
    const reset = items.find((i) => i.value === "reset-plan")!;

    expect(reset.label).toBe("Reset plan (3 in progress)");
    expect(reset.disabled).toBeFalsy();
  });

  it("reset-plan is disabled when no in-progress plans", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const reset = items.find((i) => i.value === "reset-plan")!;

    expect(reset.hint).toBe("(none)");
    expect(reset.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — maintenance items
// ---------------------------------------------------------------------------

describe("buildMenuItems — maintenance items", () => {
  it("all four maintenance items are in the maintenance group and never disabled", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);

    for (const value of ["doctor", "clean", "view-config", "edit-config"]) {
      const item = items.find((i) => i.value === value)!;
      expect(item.group).toBe("maintenance");
      expect(item.disabled).toBeFalsy();
    }
  });

  it("maintenance items appear after pipeline items, quit is last", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const statusIdx = items.findIndex((i) => i.value === "view-status");
    const doctorIdx = items.findIndex((i) => i.value === "doctor");

    expect(doctorIdx).toBeGreaterThan(statusIdx);
    expect(items[items.length - 1]!.value).toBe("quit");
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — "Run with options..." item
// ---------------------------------------------------------------------------

describe("buildMenuItems — Run with options...", () => {
  it("includes run-with-options in menu items", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const values = items.map((i) => i.value);
    expect(values).toContain("run-with-options");
  });

  it("is in the run group", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const item = items.find((i) => i.value === "run-with-options")!;
    expect(item.group).toBe("run");
  });

  it("is always enabled", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const item = items.find((i) => i.value === "run-with-options")!;
    expect(item.disabled).toBeFalsy();
  });

  it("has hint 'configure before running'", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const item = items.find((i) => i.value === "run-with-options")!;
    expect(item.hint).toBe("configure before running");
  });

  it("appears after pick-from-github in the run group", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);
    const githubIdx = items.findIndex((i) => i.value === "pick-from-github");
    const optionsIdx = items.findIndex((i) => i.value === "run-with-options");

    expect(optionsIdx).toBeGreaterThan(githubIdx);
  });

  it("appears before pipeline group items", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const optionsIdx = items.findIndex((i) => i.value === "run-with-options");
    const statusIdx = items.findIndex((i) => i.value === "view-status");

    expect(optionsIdx).toBeLessThan(statusIdx);
  });
});
