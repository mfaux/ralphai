/**
 * Tests for the pipeline header component's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/components/header.tsx`:
 * - `buildHeaderParts` — builds structured header segments from pipeline state
 * - `buildStalledWarning` — generates stalled-plans warning string
 *
 * Component rendering tests are deferred until `ink-testing-library` is
 * available. The test runner only discovers `.test.ts` files, so this
 * file tests pure functions only.
 */

import { describe, it, expect } from "bun:test";
import type { PipelineState } from "../../pipeline-state.ts";
import {
  buildHeaderParts,
  buildStalledWarning,
  buildHeaderText,
} from "./header.tsx";

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

// ---------------------------------------------------------------------------
// buildHeaderParts
// ---------------------------------------------------------------------------

describe("buildHeaderParts", () => {
  it("returns null when all counts are zero (empty pipeline)", () => {
    const state = makeState();
    expect(buildHeaderParts(state)).toBeNull();
  });

  it("returns parts with correct counts", () => {
    const state = makeState({
      backlog: makeBacklog(3),
      inProgress: makeInProgress(1),
      completedSlugs: ["done-a", "done-b", "done-c", "done-d", "done-e"],
    });
    const parts = buildHeaderParts(state)!;

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: "3 backlog" });
    expect(parts[1]).toEqual({ text: "1 running" });
    expect(parts[2]).toEqual({ text: "5 completed" });
  });

  it("shows zero counts when some categories are empty", () => {
    const state = makeState({
      completedSlugs: ["done-a", "done-b"],
    });
    const parts = buildHeaderParts(state)!;

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: "0 backlog" });
    expect(parts[1]).toEqual({ text: "0 running" });
    expect(parts[2]).toEqual({ text: "2 completed" });
  });

  it("shows counts when only backlog has plans", () => {
    const state = makeState({
      backlog: makeBacklog(5),
    });
    const parts = buildHeaderParts(state)!;

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: "5 backlog" });
    expect(parts[1]).toEqual({ text: "0 running" });
    expect(parts[2]).toEqual({ text: "0 completed" });
  });

  it("shows counts when only in-progress has plans", () => {
    const state = makeState({
      inProgress: makeInProgress(2),
    });
    const parts = buildHeaderParts(state)!;

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: "0 backlog" });
    expect(parts[1]).toEqual({ text: "2 running" });
    expect(parts[2]).toEqual({ text: "0 completed" });
  });

  it("appends stalled warning part when stalled plans exist", () => {
    const state = makeState({
      inProgress: makeInProgress(1, "stalled"),
      backlog: makeBacklog(2),
    });
    const parts = buildHeaderParts(state)!;

    expect(parts).toHaveLength(4);
    expect(parts[3]).toEqual({
      text: "\u26a0 1 plan stalled",
      warning: true,
    });
  });

  it("appends plural stalled warning when multiple plans are stalled", () => {
    const state = makeState({
      inProgress: makeInProgress(3, "stalled"),
    });
    const parts = buildHeaderParts(state)!;

    expect(parts).toHaveLength(4);
    expect(parts[3]).toEqual({
      text: "\u26a0 3 plans stalled",
      warning: true,
    });
  });

  it("does not include stalled warning when no plans are stalled", () => {
    const state = makeState({
      inProgress: makeInProgress(2, "running"),
    });
    const parts = buildHeaderParts(state)!;

    expect(parts).toHaveLength(3);
    // No warning part
    expect(parts.every((p) => !p.warning)).toBe(true);
  });

  it("does not include stalled warning for in_progress (non-stalled) plans", () => {
    const state = makeState({
      inProgress: makeInProgress(2, "in_progress"),
    });
    const parts = buildHeaderParts(state)!;

    expect(parts).toHaveLength(3);
    expect(parts.every((p) => !p.warning)).toBe(true);
  });

  it("counts all in-progress plans regardless of liveness for running count", () => {
    // Mix of stalled, running, and in_progress plans — all count as "in progress"
    const state = makeState({
      inProgress: [
        ...makeInProgress(1, "stalled"),
        ...makeInProgress(1, "running"),
        ...makeInProgress(1, "in_progress"),
      ],
    });
    const parts = buildHeaderParts(state)!;

    // 3 in-progress total
    expect(parts[1]).toEqual({ text: "3 running" });
  });
});

// ---------------------------------------------------------------------------
// buildStalledWarning
// ---------------------------------------------------------------------------

describe("buildStalledWarning", () => {
  it("returns undefined when no plans are stalled", () => {
    const state = makeState();
    expect(buildStalledWarning(state)).toBeUndefined();
  });

  it("returns undefined when plans exist but none are stalled", () => {
    const state = makeState({
      inProgress: makeInProgress(2, "running"),
    });
    expect(buildStalledWarning(state)).toBeUndefined();
  });

  it("returns singular warning for 1 stalled plan", () => {
    const state = makeState({
      inProgress: makeInProgress(1, "stalled"),
    });
    expect(buildStalledWarning(state)).toBe("\u26a0 1 plan stalled");
  });

  it("returns plural warning for multiple stalled plans", () => {
    const state = makeState({
      inProgress: makeInProgress(3, "stalled"),
    });
    expect(buildStalledWarning(state)).toBe("\u26a0 3 plans stalled");
  });

  it("counts only stalled plans, not running ones", () => {
    const state = makeState({
      inProgress: [
        ...makeInProgress(2, "stalled"),
        ...makeInProgress(3, "running"),
      ],
    });
    expect(buildStalledWarning(state)).toBe("\u26a0 2 plans stalled");
  });

  it("counts only stalled plans, not in_progress ones", () => {
    const state = makeState({
      inProgress: [
        ...makeInProgress(1, "stalled"),
        ...makeInProgress(2, "in_progress"),
      ],
    });
    expect(buildStalledWarning(state)).toBe("\u26a0 1 plan stalled");
  });
});

// ---------------------------------------------------------------------------
// buildHeaderText (error-aware status text)
// ---------------------------------------------------------------------------

describe("buildHeaderText", () => {
  it("returns 'loading…' when state is null and no error", () => {
    expect(buildHeaderText(null)).toBe("loading…");
  });

  it("returns the error message when state is null and error is set", () => {
    expect(buildHeaderText(null, "Subprocess timed out")).toBe(
      "Subprocess timed out",
    );
  });

  it("returns 'empty' when state has all zero counts", () => {
    const state = makeState();
    expect(buildHeaderText(state)).toBe("empty");
  });

  it("returns undefined when state has counts (delegate to buildHeaderParts)", () => {
    const state = makeState({ backlog: makeBacklog(2) });
    expect(buildHeaderText(state)).toBeUndefined();
  });

  it("ignores error when state is not null", () => {
    // When data was loaded but an error occurred during a refresh,
    // the header should show the data, not the error.
    const state = makeState({ backlog: makeBacklog(1) });
    expect(buildHeaderText(state, "stale error")).toBeUndefined();
  });
});
