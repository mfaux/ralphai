/**
 * Tests for the interactive menu module.
 *
 * Tests buildMenuItems and buildHeaderLine with various PipelineState
 * inputs. These are pure unit tests — no filesystem, no subprocess.
 */

import { describe, it, expect } from "bun:test";
import { stripAnsi } from "../utils.ts";
import type { PipelineState } from "../pipeline-state.ts";
import { buildHeaderLine, buildMenuItems, type MenuItem } from "./menu.ts";

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

/** Create N backlog plan stubs. */
function makeBacklog(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    filename: `plan-${i + 1}.md`,
    scope: "",
    dependsOn: [] as string[],
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
// buildMenuItems
// ---------------------------------------------------------------------------

describe("buildMenuItems", () => {
  it("returns 'View pipeline status' and 'Quit' items", () => {
    const state = makeState();
    const items = buildMenuItems(state);

    expect(items.length).toBeGreaterThanOrEqual(2);

    const statusItem = items.find((i) => i.value === "view-status");
    expect(statusItem).toBeDefined();
    expect(statusItem!.label).toBe("View pipeline status");
    expect(statusItem!.group).toBe("pipeline");

    const quitItem = items.find((i) => i.value === "quit");
    expect(quitItem).toBeDefined();
    expect(quitItem!.label).toBe("Quit");
    expect(quitItem!.group).toBe("maintenance");
  });

  it("orders items by group: run, pipeline, maintenance", () => {
    const state = makeState();
    const items = buildMenuItems(state);

    // Find the indexes
    const statusIdx = items.findIndex((i) => i.value === "view-status");
    const quitIdx = items.findIndex((i) => i.value === "quit");

    // Pipeline items should come before maintenance items
    expect(statusIdx).toBeLessThan(quitIdx);
  });

  it("returns consistent items regardless of pipeline state", () => {
    const emptyState = makeState();
    const busyState = makeState({
      backlog: makeBacklog(10),
      inProgress: makeInProgress(3),
      completedSlugs: ["a", "b", "c"],
    });

    const emptyItems = buildMenuItems(emptyState);
    const busyItems = buildMenuItems(busyState);

    // Same number of items (state doesn't change available actions yet)
    expect(emptyItems.length).toBe(busyItems.length);

    // Same values in same order
    expect(emptyItems.map((i) => i.value)).toEqual(
      busyItems.map((i) => i.value),
    );
  });

  it("all items have required fields", () => {
    const state = makeState();
    const items = buildMenuItems(state);

    for (const item of items) {
      expect(item.value).toBeTypeOf("string");
      expect(item.value.length).toBeGreaterThan(0);
      expect(item.label).toBeTypeOf("string");
      expect(item.label.length).toBeGreaterThan(0);
      expect(["run", "pipeline", "maintenance"]).toContain(item.group);
    }
  });
});
