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

/** Create N in-progress plan stubs. */
function makeInProgress(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    filename: `wip-${i + 1}.md`,
    slug: `wip-${i + 1}`,
    scope: "",
    totalTasks: 3 as number | undefined,
    tasksCompleted: 1,
    hasWorktree: false,
    liveness: { tag: "in_progress" as const },
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
    expect(values).toContain("run-next");
    expect(values).toContain("pick-from-backlog");
    expect(values).toContain("view-status");
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
