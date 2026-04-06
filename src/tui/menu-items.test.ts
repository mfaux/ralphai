/**
 * Tests for the TUI menu items module.
 *
 * Ports tests from `src/interactive/menu.test.ts` with adaptations for:
 * - Renamed groups: run → START, pipeline → MANAGE, maintenance → TOOLS
 * - Dropped `recent-activity` item
 * - Consolidated `view-config` + `edit-config` → `settings`
 * - Added hotkey assignments
 *
 * These are pure unit tests — no filesystem, no subprocess.
 */

import { describe, it, expect } from "bun:test";
import { stripAnsi } from "../utils.ts";
import type { PipelineState } from "../pipeline-state.ts";
import {
  buildHeaderLine,
  buildMenuItems,
  isPipelineEmpty,
  type MenuItem,
  type MenuContext,
} from "./menu-items.ts";

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
    expect(values).toContain("doctor");
    expect(values).toContain("clean");
    expect(values).toContain("settings");
    expect(values).toContain("quit");
  });

  it("does not include dropped items", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const values = items.map((i) => i.value);

    expect(values).not.toContain("recent-activity");
    expect(values).not.toContain("view-config");
    expect(values).not.toContain("edit-config");
  });

  it("orders items by group: START, MANAGE, TOOLS", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);

    const runNextIdx = items.findIndex((i) => i.value === "run-next");
    const pickIdx = items.findIndex((i) => i.value === "pick-from-backlog");
    const statusIdx = items.findIndex((i) => i.value === "view-status");
    const quitIdx = items.findIndex((i) => i.value === "quit");

    // START group before MANAGE before TOOLS
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
      expect(["START", "MANAGE", "TOOLS"]).toContain(item.group);
    }
  });

  it("uses START, MANAGE, TOOLS group names", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);
    const groups = new Set(items.map((i) => i.group));

    expect(groups).toContain("START");
    expect(groups).toContain("MANAGE");
    expect(groups).toContain("TOOLS");
    expect(groups.size).toBe(3);
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

  it("is in the START group", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const pick = items.find((i) => i.value === "pick-from-github")!;
    expect(pick.group).toBe("START");
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
// buildMenuItems — stalled promotion
// ---------------------------------------------------------------------------

describe("buildMenuItems — stalled promotion", () => {
  it("promotes resume-stalled to top of menu when stalled plans exist", () => {
    const state = makeState({
      inProgress: makeInProgress(1, "stalled"),
      backlog: makeBacklog(2),
    });
    const items = buildMenuItems(state, NO_GITHUB);

    // resume-stalled should be the first item (promoted to START group)
    expect(items[0]!.value).toBe("resume-stalled");
    expect(items[0]!.group).toBe("START");
  });

  it("resume-stalled is in MANAGE group when no stalled plans", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);
    const resume = items.find((i) => i.value === "resume-stalled")!;

    expect(resume.group).toBe("MANAGE");
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

  it("resume-stalled appears after START group when not stalled", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);
    const resumeIdx = items.findIndex((i) => i.value === "resume-stalled");
    const runNextIdx = items.findIndex((i) => i.value === "run-next");

    expect(resumeIdx).toBeGreaterThan(runNextIdx);
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — pipeline management items
// ---------------------------------------------------------------------------

describe("buildMenuItems — pipeline management items", () => {
  it("includes stop-running in MANAGE group", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const stop = items.find((i) => i.value === "stop-running")!;

    expect(stop.group).toBe("MANAGE");
  });

  it("includes reset-plan in MANAGE group", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const reset = items.find((i) => i.value === "reset-plan")!;

    expect(reset.group).toBe("MANAGE");
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
// buildMenuItems — TOOLS items (formerly maintenance)
// ---------------------------------------------------------------------------

describe("buildMenuItems — TOOLS items", () => {
  it("doctor, clean, settings, and quit are in the TOOLS group and never disabled", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);

    for (const value of ["doctor", "clean", "settings", "quit"]) {
      const item = items.find((i) => i.value === value)!;
      expect(item.group).toBe("TOOLS");
      expect(item.disabled).toBeFalsy();
    }
  });

  it("TOOLS items appear after MANAGE items, quit is last", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const statusIdx = items.findIndex((i) => i.value === "view-status");
    const doctorIdx = items.findIndex((i) => i.value === "doctor");

    expect(doctorIdx).toBeGreaterThan(statusIdx);
    expect(items[items.length - 1]!.value).toBe("quit");
  });

  it("settings item has hint 'view or edit config'", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const settings = items.find((i) => i.value === "settings")!;

    expect(settings.label).toBe("Settings");
    expect(settings.hint).toBe("view or edit config");
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

  it("is in the START group", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const item = items.find((i) => i.value === "run-with-options")!;
    expect(item.group).toBe("START");
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

  it("appears after pick-from-github in the START group", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const items = buildMenuItems(state, NO_GITHUB);
    const githubIdx = items.findIndex((i) => i.value === "pick-from-github");
    const optionsIdx = items.findIndex((i) => i.value === "run-with-options");

    expect(optionsIdx).toBeGreaterThan(githubIdx);
  });

  it("appears before MANAGE group items", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const optionsIdx = items.findIndex((i) => i.value === "run-with-options");
    const statusIdx = items.findIndex((i) => i.value === "view-status");

    expect(optionsIdx).toBeLessThan(statusIdx);
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — hotkey assignments
// ---------------------------------------------------------------------------

describe("buildMenuItems — hotkey assignments", () => {
  it("assigns expected hotkeys to each item", () => {
    const state = makeState({
      backlog: makeBacklog(1),
      inProgress: makeInProgress(1, "stalled"),
    });
    const items = buildMenuItems(state, WITH_GITHUB);

    const hotkeys: Record<string, string | undefined> = {};
    for (const item of items) {
      hotkeys[item.value] = item.hotkey;
    }

    expect(hotkeys["resume-stalled"]).toBe("r");
    expect(hotkeys["run-next"]).toBe("n");
    expect(hotkeys["pick-from-backlog"]).toBe("b");
    expect(hotkeys["pick-from-github"]).toBe("g");
    expect(hotkeys["run-with-options"]).toBe("o");
    expect(hotkeys["stop-running"]).toBe("s");
    expect(hotkeys["reset-plan"]).toBe("e");
    expect(hotkeys["view-status"]).toBe("p");
    expect(hotkeys["doctor"]).toBe("d");
    expect(hotkeys["clean"]).toBe("c");
    expect(hotkeys["quit"]).toBe("q");
  });

  it("all hotkeys are unique single characters", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const hotkeys = items.map((i) => i.hotkey).filter(Boolean) as string[];

    // All single characters
    for (const key of hotkeys) {
      expect(key.length).toBe(1);
    }

    // All unique
    const unique = new Set(hotkeys);
    expect(unique.size).toBe(hotkeys.length);
  });

  it("settings item has no hotkey", () => {
    const state = makeState();
    const items = buildMenuItems(state, NO_GITHUB);
    const settings = items.find((i) => i.value === "settings")!;

    expect(settings.hotkey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — GitHub loading indicator
// ---------------------------------------------------------------------------

describe("buildMenuItems — GitHub loading indicator", () => {
  it("pick-from-github shows 'loading...' hint and is disabled while loading", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueLoading: true,
    };
    const items = buildMenuItems(state, ctx);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.label).toBe("Pick from GitHub");
    expect(pick.hint).toBe("loading\u2026");
    expect(pick.disabled).toBe(true);
  });

  it("run-next shows 'loading...' hint when GitHub is loading and no local plans", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueLoading: true,
    };
    const items = buildMenuItems(state, ctx);
    const runNext = items.find((i) => i.value === "run-next")!;

    // run-next should show a hint that includes loading
    expect(runNext.hint).toBe("loading\u2026");
  });

  it("run-next hint remains plan name when local plans exist, even if GitHub is loading", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueLoading: true,
    };
    const items = buildMenuItems(state, ctx);
    const runNext = items.find((i) => i.value === "run-next")!;

    // When a local plan is available, loading doesn't affect the label
    expect(runNext.label).toBe("Run next plan (plan-1.md)");
    expect(runNext.disabled).toBeFalsy();
  });

  it("loading indicators don't appear when hasGitHubIssues is false", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: false,
      githubIssueLoading: true, // ignored when not configured
    };
    const items = buildMenuItems(state, ctx);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.hint).toBe("(not configured)");
    expect(pick.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMenuItems — GitHub error state
// ---------------------------------------------------------------------------

describe("buildMenuItems — GitHub error state", () => {
  it("pick-from-github shows error hint and is disabled on error", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueError: "gh CLI not available",
    };
    const items = buildMenuItems(state, ctx);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.hint).toBe("(gh CLI not available)");
    expect(pick.disabled).toBe(true);
  });

  it("run-next shows GitHub error hint when no local plans", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueError: "gh CLI not available",
    };
    const items = buildMenuItems(state, ctx);
    const runNext = items.find((i) => i.value === "run-next")!;

    // run-next still gets generic "will pull from GitHub" from runNextMenuItem,
    // but our override replaces undefined hints with the error
    expect(runNext.hint).toBe("(GitHub: gh CLI not available)");
  });

  it("error indicators don't appear when hasGitHubIssues is false", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: false,
      githubIssueError: "some error", // ignored
    };
    const items = buildMenuItems(state, ctx);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.hint).toBe("(not configured)");
  });

  it("loading state takes precedence over error state for pick-from-github", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueLoading: true,
      githubIssueError: "stale error",
    };
    const items = buildMenuItems(state, ctx);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.hint).toBe("loading\u2026");
    expect(pick.disabled).toBe(true);
  });

  it("successful count overrides loading/error for pick-from-github", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueCount: 5,
    };
    const items = buildMenuItems(state, ctx);
    const pick = items.find((i) => i.value === "pick-from-github")!;

    expect(pick.label).toBe("Pick from GitHub (5 issues)");
    expect(pick.disabled).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// isPipelineEmpty
// ---------------------------------------------------------------------------

describe("isPipelineEmpty", () => {
  it("returns true when all pipeline sections are empty", () => {
    const state = makeState();
    expect(isPipelineEmpty(state)).toBe(true);
  });

  it("returns false when backlog has plans", () => {
    const state = makeState({ backlog: makeBacklog(1) });
    expect(isPipelineEmpty(state)).toBe(false);
  });

  it("returns false when in-progress has plans", () => {
    const state = makeState({ inProgress: makeInProgress(1) });
    expect(isPipelineEmpty(state)).toBe(false);
  });

  it("returns false when completed has slugs", () => {
    const state = makeState({ completedSlugs: ["done-a"] });
    expect(isPipelineEmpty(state)).toBe(false);
  });

  it("returns false when all sections have data", () => {
    const state = makeState({
      backlog: makeBacklog(2),
      inProgress: makeInProgress(1),
      completedSlugs: ["done-a"],
    });
    expect(isPipelineEmpty(state)).toBe(false);
  });

  it("returns true when worktrees/problems exist but plans are empty", () => {
    // Worktrees and problems don't count as pipeline content
    const state = makeState({
      worktrees: [
        {
          entry: { path: "/tmp/wt", branch: "main" },
          hasActivePlan: false,
        },
      ],
      problems: [{ message: "some warning" }],
    });
    expect(isPipelineEmpty(state)).toBe(true);
  });
});
