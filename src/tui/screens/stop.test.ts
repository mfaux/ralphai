/**
 * Tests for the stop screen.
 *
 * Tests the pure helper functions exported from stop.tsx:
 * - formatDuration()
 * - buildStopListItems()
 * - buildConfirmText()
 *
 * Also tests the StopScreen component renders without error in both
 * single-plan (confirmation prompt) and multi-plan (picker) modes.
 *
 * Pure unit tests for helpers — no filesystem, no subprocess.
 * Component tests use mock.module to stub `runRalphaiStop`.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import React from "react";
import { render } from "ink";
import type { PipelineState, InProgressPlan } from "../../pipeline-state.ts";

// ---------------------------------------------------------------------------
// Mock runRalphaiStop before importing stop.tsx
// ---------------------------------------------------------------------------

const mockRunRalphaiStop = mock(() => {});

mock.module("../../stop.ts", () => ({
  runRalphaiStop: mockRunRalphaiStop,
  showStopHelp: () => {},
  StopOptions: undefined,
}));

// Import after mocking
const { formatDuration, buildStopListItems, buildConfirmText, StopScreen } =
  await import("./stop.tsx");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunningPlan(
  slug: string,
  pid: number,
  filename?: string,
): InProgressPlan {
  return {
    filename: filename ?? `${slug}.md`,
    slug,
    scope: "",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: false,
    liveness: { tag: "running", pid },
  };
}

function makeState(
  inProgress: InProgressPlan[],
  overrides?: Partial<PipelineState>,
): PipelineState {
  return {
    backlog: [],
    inProgress,
    completedSlugs: [],
    worktrees: [],
    problems: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("returns undefined for undefined input", () => {
    expect(formatDuration(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(formatDuration("")).toBeUndefined();
  });

  it("returns undefined for invalid date", () => {
    expect(formatDuration("not-a-date")).toBeUndefined();
  });

  it("returns undefined for future date", () => {
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    expect(formatDuration(futureDate)).toBeUndefined();
  });

  it("returns '< 1m' for very recent start", () => {
    const now = new Date().toISOString();
    expect(formatDuration(now)).toBe("< 1m");
  });

  it("returns minutes for durations under an hour", () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(formatDuration(thirtyMinsAgo)).toBe("30m");
  });

  it("returns hours and minutes for durations over an hour", () => {
    const ninetyMinsAgo = new Date(Date.now() - 90 * 60_000).toISOString();
    expect(formatDuration(ninetyMinsAgo)).toBe("1h 30m");
  });

  it("returns hours only when minutes are zero", () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60_000).toISOString();
    expect(formatDuration(twoHoursAgo)).toBe("2h");
  });
});

// ---------------------------------------------------------------------------
// buildStopListItems
// ---------------------------------------------------------------------------

describe("buildStopListItems", () => {
  it("returns empty array for empty input", () => {
    expect(buildStopListItems([], new Map())).toEqual([]);
  });

  it("builds items with PID hints", () => {
    const plans = [makeRunningPlan("plan-a", 1234)];
    const items = buildStopListItems(plans, new Map());

    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("plan-a");
    expect(items[0]!.label).toBe("plan-a.md");
    expect(items[0]!.hint).toBe("PID 1234");
  });

  it("includes duration in hint when available", () => {
    const plans = [makeRunningPlan("plan-a", 1234)];
    const durations = new Map([["plan-a", "15m"]]);
    const items = buildStopListItems(plans, durations);

    expect(items[0]!.hint).toBe("PID 1234 · 15m");
  });

  it("builds multiple items", () => {
    const plans = [
      makeRunningPlan("plan-a", 1234),
      makeRunningPlan("plan-b", 5678),
    ];
    const durations = new Map<string, string | undefined>([
      ["plan-a", "1h 15m"],
      ["plan-b", undefined],
    ]);
    const items = buildStopListItems(plans, durations);

    expect(items).toHaveLength(2);
    expect(items[0]!.hint).toBe("PID 1234 · 1h 15m");
    expect(items[1]!.hint).toBe("PID 5678");
  });
});

// ---------------------------------------------------------------------------
// buildConfirmText
// ---------------------------------------------------------------------------

describe("buildConfirmText", () => {
  it("builds confirmation text with slug and PID", () => {
    const plan = makeRunningPlan("my-plan", 4242);
    expect(buildConfirmText(plan)).toBe("Stop 'my-plan' (PID 4242)?");
  });
});

// ---------------------------------------------------------------------------
// StopScreen component
// ---------------------------------------------------------------------------

describe("StopScreen", () => {
  beforeEach(() => {
    mockRunRalphaiStop.mockClear();
  });

  it("renders empty state without error", () => {
    const state = makeState([]);
    const instance = render(
      React.createElement(StopScreen, {
        state,
        cwd: "/tmp",
        onDone: () => {},
        onBack: () => {},
      }),
    );
    instance.unmount();
  });

  it("renders single-plan confirmation without error", () => {
    const state = makeState([makeRunningPlan("plan-a", 1234)]);
    const instance = render(
      React.createElement(StopScreen, {
        state,
        cwd: "/tmp",
        onDone: () => {},
        onBack: () => {},
      }),
    );
    instance.unmount();
  });

  it("renders multi-plan picker without error", () => {
    const state = makeState([
      makeRunningPlan("plan-a", 1234),
      makeRunningPlan("plan-b", 5678),
    ]);
    const instance = render(
      React.createElement(StopScreen, {
        state,
        cwd: "/tmp",
        onDone: () => {},
        onBack: () => {},
      }),
    );
    instance.unmount();
  });

  it("renders multi-plan picker with duration map", () => {
    const state = makeState([
      makeRunningPlan("plan-a", 1234),
      makeRunningPlan("plan-b", 5678),
    ]);
    const durationMap = new Map<string, string | undefined>([
      ["plan-a", "5m"],
      ["plan-b", "1h 30m"],
    ]);
    const instance = render(
      React.createElement(StopScreen, {
        state,
        cwd: "/tmp",
        onDone: () => {},
        onBack: () => {},
        durationMap,
      }),
    );
    instance.unmount();
  });
});
