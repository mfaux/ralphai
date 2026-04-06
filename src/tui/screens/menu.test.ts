/**
 * Tests for the main menu screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/menu.tsx`:
 * - `buildListItems` — converts menu items to flat list with group headers
 * - `buildHotkeyMap` — builds hotkey → action lookup
 * - `isGroupHeader` — identifies group header sentinel values
 *
 * Component rendering tests are deferred until `ink-testing-library` is
 * available. The test runner only discovers `.test.ts` files, so this
 * file tests pure functions only.
 */

import { describe, it, expect } from "bun:test";
import type { PipelineState } from "../../pipeline-state.ts";
import type { MenuItem, MenuContext } from "../menu-items.ts";
import { buildMenuItems } from "../menu-items.ts";
import {
  buildListItems,
  buildHotkeyMap,
  isGroupHeader,
  EMPTY_STATE_HINTS,
} from "./menu.tsx";

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

const NO_GITHUB: MenuContext = { hasGitHubIssues: false };

// ---------------------------------------------------------------------------
// isGroupHeader
// ---------------------------------------------------------------------------

describe("isGroupHeader", () => {
  it("returns true for group header sentinel values", () => {
    expect(isGroupHeader("__group__START")).toBe(true);
    expect(isGroupHeader("__group__MANAGE")).toBe(true);
    expect(isGroupHeader("__group__TOOLS")).toBe(true);
  });

  it("returns false for regular item values", () => {
    expect(isGroupHeader("run-next")).toBe(false);
    expect(isGroupHeader("quit")).toBe(false);
    expect(isGroupHeader("resume-stalled")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGroupHeader("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildListItems
// ---------------------------------------------------------------------------

describe("buildListItems", () => {
  it("inserts a group header before each new group", () => {
    const menuItems: MenuItem[] = [
      { value: "a", label: "A", group: "START" },
      { value: "b", label: "B", group: "START" },
      { value: "c", label: "C", group: "MANAGE" },
      { value: "d", label: "D", group: "TOOLS" },
    ];

    const list = buildListItems(menuItems);

    // Expect: header-START, a, b, header-MANAGE, c, header-TOOLS, d
    expect(list).toHaveLength(7);
    expect(list[0]!.value).toBe("__group__START");
    expect(list[0]!.disabled).toBe(true);
    expect(list[1]!.value).toBe("a");
    expect(list[2]!.value).toBe("b");
    expect(list[3]!.value).toBe("__group__MANAGE");
    expect(list[3]!.disabled).toBe(true);
    expect(list[4]!.value).toBe("c");
    expect(list[5]!.value).toBe("__group__TOOLS");
    expect(list[5]!.disabled).toBe(true);
    expect(list[6]!.value).toBe("d");
  });

  it("group headers have the correct label text", () => {
    const menuItems: MenuItem[] = [
      { value: "a", label: "A", group: "START" },
      { value: "b", label: "B", group: "MANAGE" },
      { value: "c", label: "C", group: "TOOLS" },
    ];

    const list = buildListItems(menuItems);

    expect(list[0]!.label).toBe("START");
    expect(list[2]!.label).toBe("MANAGE");
    expect(list[4]!.label).toBe("TOOLS");
  });

  it("preserves disabled state on regular items", () => {
    const menuItems: MenuItem[] = [
      { value: "a", label: "A", group: "START", disabled: true },
      { value: "b", label: "B", group: "START", disabled: false },
      { value: "c", label: "C", group: "START" },
    ];

    const list = buildListItems(menuItems);

    // list[0] is the group header (disabled)
    expect(list[1]!.disabled).toBe(true);
    expect(list[2]!.disabled).toBe(false);
    expect(list[3]!.disabled).toBeUndefined();
  });

  it("preserves hint text on regular items", () => {
    const menuItems: MenuItem[] = [
      { value: "a", label: "A", hint: "some hint", group: "START" },
      { value: "b", label: "B", group: "START" },
    ];

    const list = buildListItems(menuItems);

    expect(list[1]!.hint).toBe("some hint");
    expect(list[2]!.hint).toBeUndefined();
  });

  it("returns empty array for empty input", () => {
    expect(buildListItems([])).toEqual([]);
  });

  it("handles single group", () => {
    const menuItems: MenuItem[] = [{ value: "a", label: "A", group: "TOOLS" }];

    const list = buildListItems(menuItems);

    expect(list).toHaveLength(2);
    expect(list[0]!.value).toBe("__group__TOOLS");
    expect(list[1]!.value).toBe("a");
  });

  it("works with full buildMenuItems output (no stalled plans)", () => {
    const state = makeState({ backlog: makeBacklog(3) });
    const menuItems = buildMenuItems(state, NO_GITHUB);
    const list = buildListItems(menuItems);

    // Should have 3 group headers + 12 menu items = 15
    const groupHeaders = list.filter((i) => isGroupHeader(i.value));
    const regularItems = list.filter((i) => !isGroupHeader(i.value));

    expect(groupHeaders).toHaveLength(3);
    expect(regularItems).toHaveLength(12);

    // Group headers should appear in order
    expect(groupHeaders[0]!.label).toBe("START");
    expect(groupHeaders[1]!.label).toBe("MANAGE");
    expect(groupHeaders[2]!.label).toBe("TOOLS");
  });

  it("works with full buildMenuItems output (stalled plans promote resume to START)", () => {
    const state = makeState({
      backlog: makeBacklog(2),
      inProgress: makeInProgress(1, "stalled"),
    });
    const menuItems = buildMenuItems(state, NO_GITHUB);
    const list = buildListItems(menuItems);

    // When stalled, resume-stalled is in START group
    // Find the first regular item after the START header
    const startHeaderIdx = list.findIndex((i) => i.value === "__group__START");
    expect(list[startHeaderIdx + 1]!.value).toBe("resume-stalled");
    expect(list[startHeaderIdx + 1]!.disabled).toBeFalsy();
  });

  it("all group headers are disabled (cursor skips them)", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const menuItems = buildMenuItems(state, NO_GITHUB);
    const list = buildListItems(menuItems);

    const groupHeaders = list.filter((i) => isGroupHeader(i.value));
    for (const header of groupHeaders) {
      expect(header.disabled).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buildHotkeyMap
// ---------------------------------------------------------------------------

describe("buildHotkeyMap", () => {
  it("maps hotkeys to action values for enabled items", () => {
    const menuItems: MenuItem[] = [
      { value: "run-next", label: "Run next", group: "START", hotkey: "n" },
      { value: "quit", label: "Quit", group: "TOOLS", hotkey: "q" },
    ];

    const map = buildHotkeyMap(menuItems);

    expect(map.get("n")).toBe("run-next");
    expect(map.get("q")).toBe("quit");
    expect(map.size).toBe(2);
  });

  it("excludes disabled items from the hotkey map", () => {
    const menuItems: MenuItem[] = [
      {
        value: "run-next",
        label: "Run next",
        group: "START",
        hotkey: "n",
        disabled: true,
      },
      { value: "quit", label: "Quit", group: "TOOLS", hotkey: "q" },
    ];

    const map = buildHotkeyMap(menuItems);

    expect(map.has("n")).toBe(false);
    expect(map.get("q")).toBe("quit");
    expect(map.size).toBe(1);
  });

  it("excludes items without hotkeys", () => {
    const menuItems: MenuItem[] = [
      { value: "settings", label: "Settings", group: "TOOLS" },
      { value: "quit", label: "Quit", group: "TOOLS", hotkey: "q" },
    ];

    const map = buildHotkeyMap(menuItems);

    expect(map.size).toBe(1);
    expect(map.get("q")).toBe("quit");
  });

  it("returns empty map for empty input", () => {
    expect(buildHotkeyMap([]).size).toBe(0);
  });

  it("contains all expected hotkeys from buildMenuItems (no stalled)", () => {
    const state = makeState({ backlog: makeBacklog(3) });
    const menuItems = buildMenuItems(state, NO_GITHUB);
    const map = buildHotkeyMap(menuItems);

    // resume-stalled is disabled (no stalled plans) → excluded
    expect(map.has("r")).toBe(false);

    // These should always be present when backlog is non-empty
    expect(map.get("n")).toBe("run-next");
    expect(map.get("b")).toBe("pick-from-backlog");
    expect(map.get("o")).toBe("run-with-options");
    expect(map.get("p")).toBe("view-status");
    expect(map.get("d")).toBe("doctor");
    expect(map.get("c")).toBe("clean");
    expect(map.get("q")).toBe("quit");
  });

  it("includes resume hotkey when stalled plans exist", () => {
    const state = makeState({
      backlog: makeBacklog(2),
      inProgress: makeInProgress(1, "stalled"),
    });
    const menuItems = buildMenuItems(state, NO_GITHUB);
    const map = buildHotkeyMap(menuItems);

    expect(map.get("r")).toBe("resume-stalled");
  });

  it("includes GitHub hotkey when GitHub issues are configured", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueCount: 5,
    };
    const menuItems = buildMenuItems(state, ctx);
    const map = buildHotkeyMap(menuItems);

    expect(map.get("g")).toBe("pick-from-github");
  });

  it("excludes GitHub hotkey when GitHub is not configured", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const menuItems = buildMenuItems(state, NO_GITHUB);
    const map = buildHotkeyMap(menuItems);

    expect(map.has("g")).toBe(false);
  });

  it("excludes stop hotkey when no running plans", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const menuItems = buildMenuItems(state, NO_GITHUB);
    const map = buildHotkeyMap(menuItems);

    expect(map.has("s")).toBe(false);
  });

  it("includes stop hotkey when running plans exist", () => {
    const state = makeState({
      backlog: makeBacklog(1),
      inProgress: makeInProgress(1, "running"),
    });
    const menuItems = buildMenuItems(state, NO_GITHUB);
    const map = buildHotkeyMap(menuItems);

    expect(map.get("s")).toBe("stop-running");
  });
});

// ---------------------------------------------------------------------------
// EMPTY_STATE_HINTS
// ---------------------------------------------------------------------------

describe("EMPTY_STATE_HINTS", () => {
  it("contains at least one hint", () => {
    expect(EMPTY_STATE_HINTS.length).toBeGreaterThan(0);
  });

  it("all hints are non-empty strings", () => {
    for (const hint of EMPTY_STATE_HINTS) {
      expect(typeof hint).toBe("string");
      expect(hint.length).toBeGreaterThan(0);
    }
  });

  it("includes guidance about adding plans to backlog", () => {
    const combined = EMPTY_STATE_HINTS.join(" ");
    expect(combined).toContain("backlog");
  });

  it("includes guidance about ralphai init", () => {
    const combined = EMPTY_STATE_HINTS.join(" ");
    expect(combined).toContain("ralphai init");
  });
});
