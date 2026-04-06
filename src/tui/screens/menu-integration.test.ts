/**
 * Integration tests for the menu screen's split layout wiring.
 *
 * Verifies the data-flow contract between components composed in
 * `MenuScreen`:
 * - `buildMenuItems` → `buildListItems` → items with `value` strings
 * - Those `value` strings flow through `onCursorChange` to `DetailPane`
 * - `detailForItem` produces non-empty content for every navigable value
 *
 * These tests verify that the integration is consistent — every menu
 * item value that the cursor can land on produces meaningful detail
 * content, and no navigable item produces a blank pane.
 *
 * Pure-function tests only (no React rendering). The split layout
 * threshold and resize logic are covered in `split-layout.test.ts`.
 */

import { describe, it, expect } from "bun:test";
import type { PipelineState } from "../../pipeline-state.ts";
import type { MenuContext } from "../menu-items.ts";
import { buildMenuItems } from "../menu-items.ts";
import { buildListItems, isGroupHeader } from "./menu.tsx";
import { detailForItem } from "../components/detail-pane.tsx";
import type { DetailContent } from "../components/detail-pane.tsx";
import {
  shouldSplit,
  SPLIT_THRESHOLD,
} from "../components/split-layout.tsx";

// ---------------------------------------------------------------------------
// Test helpers
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

function makeBacklog(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    filename: `plan-${i + 1}.md`,
    scope: "",
    dependsOn: [] as string[],
  }));
}

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
const WITH_GITHUB: MenuContext = {
  hasGitHubIssues: true,
  githubIssueCount: 5,
};

/**
 * Get all navigable item values from a pipeline state and menu context.
 * Navigable = enabled + not a group header.
 */
function navigableValues(
  state: PipelineState,
  ctx: MenuContext = NO_GITHUB,
): string[] {
  const menuItems = buildMenuItems(state, ctx);
  const listItems = buildListItems(menuItems);
  return listItems
    .filter((item) => !item.disabled && !isGroupHeader(item.value))
    .map((item) => item.value);
}

// ---------------------------------------------------------------------------
// Contract: every navigable item produces detail content
// ---------------------------------------------------------------------------

describe("menu → detail pane contract", () => {
  it("every navigable item value produces non-empty detail content (empty state)", () => {
    const state = makeState();
    const values = navigableValues(state);

    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      const detail = detailForItem(value, state, false);
      expect(detail.title).toBeTruthy();
    }
  });

  it("every navigable item value produces non-empty detail content (populated state)", () => {
    const state = makeState({
      backlog: makeBacklog(3),
      inProgress: makeInProgress(2, "running"),
      completedSlugs: ["done-1", "done-2"],
      worktrees: [
        {
          entry: { path: "/tmp/wt1", branch: "b1" },
          hasActivePlan: true,
        },
      ],
    });
    const values = navigableValues(state);

    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      const detail = detailForItem(value, state, false);
      expect(detail.title).toBeTruthy();
    }
  });

  it("every navigable item value produces non-empty detail content (stalled state)", () => {
    const state = makeState({
      backlog: makeBacklog(1),
      inProgress: makeInProgress(1, "stalled"),
    });
    const values = navigableValues(state);

    // resume-stalled should be navigable when stalled plans exist
    expect(values).toContain("resume-stalled");

    for (const value of values) {
      const detail = detailForItem(value, state, false);
      expect(detail.title).toBeTruthy();
    }
  });

  it("every navigable item value produces non-empty detail content (GitHub enabled)", () => {
    const state = makeState({ backlog: makeBacklog(2) });
    const values = navigableValues(state, WITH_GITHUB);

    // pick-from-github should be navigable when GitHub is configured
    expect(values).toContain("pick-from-github");

    for (const value of values) {
      const detail = detailForItem(value, state, false, WITH_GITHUB);
      expect(detail.title).toBeTruthy();
    }
  });

  it("loading state produces detail content with loading indicator", () => {
    const state = makeState();
    const loadingItems = [
      "pick-from-backlog",
      "stop-running",
      "reset-plan",
      "view-status",
      "clean",
      "run-next",
      "resume-stalled",
    ];

    for (const value of loadingItems) {
      const detail = detailForItem(value, null, true);
      expect(detail.loading).toBe(true);
      expect(detail.title).toBeTruthy();
    }
  });

  it("group headers are never navigable", () => {
    const state = makeState({ backlog: makeBacklog(3) });
    const menuItems = buildMenuItems(state);
    const listItems = buildListItems(menuItems);
    const groupHeaders = listItems.filter((item) => isGroupHeader(item.value));

    for (const header of groupHeaders) {
      expect(header.disabled).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Split layout threshold integration
// ---------------------------------------------------------------------------

describe("split layout threshold integration", () => {
  it("at >=120 columns, split layout is active", () => {
    expect(shouldSplit(SPLIT_THRESHOLD)).toBe(true);
  });

  it("at <120 columns, split layout is inactive (detail pane hidden)", () => {
    expect(shouldSplit(119)).toBe(false);
  });

  it("crossing the threshold switches between split and single-pane modes", () => {
    // Simulate a resize sequence: narrow → wide → narrow
    expect(shouldSplit(80)).toBe(false);
    expect(shouldSplit(120)).toBe(true);
    expect(shouldSplit(80)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Detail content shape validation
// ---------------------------------------------------------------------------

describe("detail content shape", () => {
  it("all detail content has a title string", () => {
    const state = makeState({ backlog: makeBacklog(2) });
    const allValues = [
      "run-next",
      "pick-from-backlog",
      "pick-from-github",
      "run-with-options",
      "stop-running",
      "reset-plan",
      "view-status",
      "doctor",
      "clean",
      "settings",
      "resume-stalled",
      "quit",
    ];

    for (const value of allValues) {
      const detail = detailForItem(value, state, false, WITH_GITHUB);
      expect(typeof detail.title).toBe("string");
      expect(typeof detail.lines).toBe("object");
      expect(Array.isArray(detail.lines)).toBe(true);
    }
  });

  it("unknown values produce empty content (no crash)", () => {
    const detail = detailForItem("unknown-value", null, false);
    expect(detail.title).toBe("");
    expect(detail.lines).toEqual([]);
  });

  it("each detail line has a text property", () => {
    const state = makeState({
      backlog: makeBacklog(2),
      inProgress: makeInProgress(1, "running"),
    });

    const values = navigableValues(state);
    for (const value of values) {
      const detail = detailForItem(value, state, false);
      for (const line of detail.lines) {
        expect(typeof line.text).toBe("string");
      }
    }
  });
});
