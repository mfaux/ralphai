/**
 * Tests for the detail-pane component's pure helpers.
 *
 * Tests the exported pure functions from `src/tui/components/detail-pane.tsx`:
 * - `detailForItem` — maps highlighted menu item to content descriptor
 * - `formatDuration` — human-readable duration formatting
 * - `formatLiveness` — liveness status formatting
 * - `formatDependency` — dependency status indicator
 *
 * Component-level rendering tests (verifying Ink output) are deferred
 * until `ink-testing-library` is available.
 */

import { describe, it, expect } from "bun:test";
import {
  detailForItem,
  formatDuration,
  formatLiveness,
  formatDependency,
} from "./detail-pane.tsx";
import type { DetailContent } from "./detail-pane.tsx";
import type { PipelineState, InProgressPlan } from "../../pipeline-state.ts";
import type { MenuContext } from "../menu-items.ts";
import type { ResolvedConfig, ResolvedValue } from "../../config.ts";

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

function makeInProgressPlan(
  overrides?: Partial<InProgressPlan>,
): InProgressPlan {
  return {
    filename: "test-plan.md",
    slug: "test-plan",
    scope: "",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: false,
    liveness: { tag: "in_progress" },
    ...overrides,
  };
}

function makeMenuContext(overrides?: Partial<MenuContext>): MenuContext {
  return {
    hasGitHubIssues: false,
    ...overrides,
  };
}

function rv<T>(
  value: T,
  source: "default" | "config" | "env" | "cli" = "default",
): ResolvedValue<T> {
  return { value, source };
}

function makeConfig(
  overrides?: Partial<Record<string, ResolvedValue<unknown>>>,
): ResolvedConfig {
  return {
    agentCommand: rv("opencode"),
    setupCommand: rv(""),
    feedbackCommands: rv("bun run build,bun test"),
    prFeedbackCommands: rv(""),
    baseBranch: rv("main"),
    maxStuck: rv(3),
    issueSource: rv("none" as const),
    standaloneLabel: rv("ralphai-standalone"),
    subissueLabel: rv("ralphai-subissue"),
    prdLabel: rv("ralphai-prd"),
    issueRepo: rv(""),
    issueCommentProgress: rv("true"),
    issueHitlLabel: rv("ralphai-subissue-hitl"),
    iterationTimeout: rv(0),
    autoCommit: rv("false"),
    workspaces: rv(null),
    ...overrides,
  } as ResolvedConfig;
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("returns '< 1m' for durations under 1 minute", () => {
    expect(formatDuration(0)).toBe("< 1m");
    expect(formatDuration(30_000)).toBe("< 1m");
    expect(formatDuration(59_999)).toBe("< 1m");
  });

  it("returns minutes for durations under 1 hour", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(300_000)).toBe("5m");
    expect(formatDuration(2_700_000)).toBe("45m");
  });

  it("returns hours and minutes for longer durations", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(8_100_000)).toBe("2h 15m");
    expect(formatDuration(7_200_000)).toBe("2h");
  });

  it("returns only hours when minutes are zero", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(7_200_000)).toBe("2h");
  });
});

// ---------------------------------------------------------------------------
// formatLiveness
// ---------------------------------------------------------------------------

describe("formatLiveness", () => {
  it("formats running plans with PID", () => {
    const plan = makeInProgressPlan({
      liveness: { tag: "running", pid: 1234 },
    });
    expect(formatLiveness(plan)).toBe("running (PID 1234)");
  });

  it("formats stalled plans", () => {
    const plan = makeInProgressPlan({ liveness: { tag: "stalled" } });
    expect(formatLiveness(plan)).toBe("stalled");
  });

  it("formats in_progress plans", () => {
    const plan = makeInProgressPlan({ liveness: { tag: "in_progress" } });
    expect(formatLiveness(plan)).toBe("in progress");
  });

  it("formats outcome plans", () => {
    const plan = makeInProgressPlan({
      liveness: { tag: "outcome", outcome: "stuck" },
    });
    expect(formatLiveness(plan)).toBe("stuck");
  });
});

// ---------------------------------------------------------------------------
// formatDependency
// ---------------------------------------------------------------------------

describe("formatDependency", () => {
  it("marks completed dependencies with checkmark", () => {
    expect(formatDependency("gh-42", ["gh-42"])).toBe("✓ gh-42");
  });

  it("marks incomplete dependencies with circle", () => {
    expect(formatDependency("gh-42", [])).toBe("○ gh-42");
    expect(formatDependency("gh-42", ["gh-99"])).toBe("○ gh-42");
  });

  it("matches prefix-based slugs", () => {
    // gh-42 matches gh-42-add-feature
    expect(formatDependency("gh-42", ["gh-42-add-feature"])).toBe("✓ gh-42");
  });

  it("does not match partial prefixes", () => {
    // gh-4 should not match gh-42
    expect(formatDependency("gh-4", ["gh-42"])).toBe("○ gh-4");
  });

  it("matches exact slug", () => {
    expect(formatDependency("my-plan", ["my-plan"])).toBe("✓ my-plan");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "pick-from-github"
// ---------------------------------------------------------------------------

describe("detailForItem — pick-from-github", () => {
  it("shows loading when GitHub issues are loading", () => {
    const ctx = makeMenuContext({
      hasGitHubIssues: true,
      githubIssueLoading: true,
    });
    const detail = detailForItem("pick-from-github", null, false, ctx);
    expect(detail.title).toBe("GitHub Issues");
    expect(detail.loading).toBe(true);
  });

  it("shows error when GitHub issue fetch failed", () => {
    const ctx = makeMenuContext({
      hasGitHubIssues: true,
      githubIssueError: "gh not available",
    });
    const detail = detailForItem("pick-from-github", null, false, ctx);
    expect(detail.title).toBe("GitHub Issues");
    expect(detail.lines[0]!.text).toBe("gh not available");
    expect(detail.lines[0]!.color).toBe("yellow");
  });

  it("shows not-configured message when GitHub is not configured", () => {
    const ctx = makeMenuContext({ hasGitHubIssues: false });
    const detail = detailForItem("pick-from-github", null, false, ctx);
    expect(detail.title).toBe("GitHub Issues");
    expect(detail.lines[0]!.text).toContain("not configured");
  });

  it("shows count when issues are available", () => {
    const ctx = makeMenuContext({
      hasGitHubIssues: true,
      githubIssueCount: 5,
    });
    const detail = detailForItem("pick-from-github", null, false, ctx);
    expect(detail.title).toBe("GitHub Issues");
    expect(detail.lines[0]!.text).toBe("5 issues available");
    expect(detail.lines[0]!.bold).toBe(true);
  });

  it("uses singular 'issue' for count of 1", () => {
    const ctx = makeMenuContext({
      hasGitHubIssues: true,
      githubIssueCount: 1,
    });
    const detail = detailForItem("pick-from-github", null, false, ctx);
    expect(detail.lines[0]!.text).toBe("1 issue available");
  });

  it("shows zero-count message when no issues found", () => {
    const ctx = makeMenuContext({
      hasGitHubIssues: true,
      githubIssueCount: 0,
    });
    const detail = detailForItem("pick-from-github", null, false, ctx);
    expect(detail.lines[0]!.text).toContain("No issues found");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "pick-from-backlog"
// ---------------------------------------------------------------------------

describe("detailForItem — pick-from-backlog", () => {
  it("shows loading when state is loading", () => {
    const detail = detailForItem("pick-from-backlog", null, true);
    expect(detail.title).toBe("Backlog");
    expect(detail.loading).toBe(true);
  });

  it("shows loading when state is null", () => {
    const detail = detailForItem("pick-from-backlog", null, false);
    expect(detail.title).toBe("Backlog");
    expect(detail.loading).toBe(true);
  });

  it("shows empty message when backlog is empty", () => {
    const state = makeState();
    const detail = detailForItem("pick-from-backlog", state, false);
    expect(detail.title).toBe("Backlog");
    expect(detail.lines[0]!.text).toContain("No plans");
  });

  it("shows backlog plans with dependency indicators", () => {
    const state = makeState({
      backlog: [
        { filename: "add-feature.md", scope: "", dependsOn: ["gh-42"] },
      ],
      completedSlugs: ["gh-42-something"],
    });
    const detail = detailForItem("pick-from-backlog", state, false);
    expect(detail.title).toBe("Backlog (1)");
    expect(detail.lines[0]!.text).toBe("add-feature");
    // Dependency should be marked complete (prefix match)
    expect(detail.lines[1]!.text).toContain("✓ gh-42");
    expect(detail.lines[1]!.color).toBe("green");
  });

  it("shows incomplete dependencies", () => {
    const state = makeState({
      backlog: [
        {
          filename: "add-feature.md",
          scope: "",
          dependsOn: ["gh-99"],
        },
      ],
    });
    const detail = detailForItem("pick-from-backlog", state, false);
    expect(detail.lines[1]!.text).toContain("○ gh-99");
    expect(detail.lines[1]!.dim).toBe(true);
  });

  it("shows plans without dependencies", () => {
    const state = makeState({
      backlog: [{ filename: "simple-plan.md", scope: "", dependsOn: [] }],
    });
    const detail = detailForItem("pick-from-backlog", state, false);
    expect(detail.lines[0]!.text).toBe("simple-plan");
    expect(detail.lines[1]!.text).toContain("No dependencies");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "stop-running"
// ---------------------------------------------------------------------------

describe("detailForItem — stop-running", () => {
  it("shows loading when state is loading", () => {
    const detail = detailForItem("stop-running", null, true);
    expect(detail.loading).toBe(true);
  });

  it("shows empty message when no plans are running", () => {
    const state = makeState();
    const detail = detailForItem("stop-running", state, false);
    expect(detail.lines[0]!.text).toContain("No plans currently running");
  });

  it("shows running plans with PIDs", () => {
    const state = makeState({
      inProgress: [
        makeInProgressPlan({
          slug: "my-plan",
          liveness: { tag: "running", pid: 5678 },
          totalTasks: 10,
          tasksCompleted: 3,
        }),
      ],
    });
    const detail = detailForItem("stop-running", state, false);
    expect(detail.title).toBe("Running (1)");
    expect(detail.lines[0]!.text).toBe("my-plan");
    expect(detail.lines[1]!.text).toContain("PID 5678");
    expect(detail.lines[2]!.text).toContain("3/10 tasks");
  });

  it("excludes non-running plans", () => {
    const state = makeState({
      inProgress: [
        makeInProgressPlan({
          slug: "stalled-plan",
          liveness: { tag: "stalled" },
        }),
        makeInProgressPlan({
          slug: "running-plan",
          liveness: { tag: "running", pid: 999 },
        }),
      ],
    });
    const detail = detailForItem("stop-running", state, false);
    expect(detail.title).toBe("Running (1)");
    expect(detail.lines[0]!.text).toBe("running-plan");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "reset-plan"
// ---------------------------------------------------------------------------

describe("detailForItem — reset-plan", () => {
  it("shows loading when state is loading", () => {
    const detail = detailForItem("reset-plan", null, true);
    expect(detail.loading).toBe(true);
  });

  it("shows empty message when no in-progress plans", () => {
    const state = makeState();
    const detail = detailForItem("reset-plan", state, false);
    expect(detail.lines[0]!.text).toContain("No in-progress plans");
  });

  it("shows in-progress plans with liveness status", () => {
    const state = makeState({
      inProgress: [
        makeInProgressPlan({
          slug: "my-plan",
          liveness: { tag: "stalled" },
          totalTasks: 8,
          tasksCompleted: 5,
        }),
      ],
    });
    const detail = detailForItem("reset-plan", state, false);
    expect(detail.title).toBe("In Progress (1)");
    expect(detail.lines[0]!.text).toBe("my-plan");
    expect(detail.lines[1]!.text).toContain("stalled");
    expect(detail.lines[2]!.text).toContain("5/8 tasks");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "view-status"
// ---------------------------------------------------------------------------

describe("detailForItem — view-status", () => {
  it("shows loading when state is loading", () => {
    const detail = detailForItem("view-status", null, true);
    expect(detail.loading).toBe(true);
  });

  it("shows pipeline breakdown summary", () => {
    const state = makeState({
      backlog: [{ filename: "a.md", scope: "", dependsOn: [] }],
      inProgress: [makeInProgressPlan()],
      completedSlugs: ["done-1", "done-2"],
      worktrees: [{ entry: { path: "/wt", branch: "b" }, hasActivePlan: true }],
    });
    const detail = detailForItem("view-status", state, false);
    expect(detail.title).toBe("Pipeline Summary");
    expect(detail.lines[0]!.text).toBe("Backlog: 1");
    expect(detail.lines[1]!.text).toBe("In progress: 1");
    expect(detail.lines[2]!.text).toBe("Completed: 2");
    expect(detail.lines[3]!.text).toBe("Worktrees: 1");
  });

  it("shows problems count when present", () => {
    const state = makeState({
      problems: [{ message: "orphaned receipt" }],
    });
    const detail = detailForItem("view-status", state, false);
    const problemLine = detail.lines.find((l) => l.text.startsWith("Problems"));
    expect(problemLine).toBeDefined();
    expect(problemLine!.color).toBe("yellow");
  });

  it("shows stalled count when present", () => {
    const state = makeState({
      inProgress: [makeInProgressPlan({ liveness: { tag: "stalled" } })],
    });
    const detail = detailForItem("view-status", state, false);
    const stalledLine = detail.lines.find((l) => l.text.startsWith("Stalled"));
    expect(stalledLine).toBeDefined();
    expect(stalledLine!.color).toBe("yellow");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "doctor"
// ---------------------------------------------------------------------------

describe("detailForItem — doctor", () => {
  it("shows press enter message", () => {
    const detail = detailForItem("doctor", null, false);
    expect(detail.title).toBe("Doctor");
    expect(detail.lines[0]!.text).toContain("Press Enter to run checks");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "clean"
// ---------------------------------------------------------------------------

describe("detailForItem — clean", () => {
  it("shows loading when state is loading", () => {
    const detail = detailForItem("clean", null, true);
    expect(detail.loading).toBe(true);
  });

  it("shows worktree count summary", () => {
    const state = makeState({
      worktrees: [
        { entry: { path: "/a", branch: "b1" }, hasActivePlan: true },
        { entry: { path: "/b", branch: "b2" }, hasActivePlan: false },
      ],
    });
    const detail = detailForItem("clean", state, false);
    expect(detail.title).toBe("Clean Worktrees");
    expect(detail.lines[0]!.text).toBe("2 worktrees total");
    expect(detail.lines[1]!.text).toContain("1 without active plan");
  });

  it("shows all-active message when no orphaned worktrees", () => {
    const state = makeState({
      worktrees: [{ entry: { path: "/a", branch: "b1" }, hasActivePlan: true }],
    });
    const detail = detailForItem("clean", state, false);
    expect(detail.lines[1]!.text).toContain("All worktrees have active plans");
  });

  it("shows no-worktrees message when empty", () => {
    const state = makeState();
    const detail = detailForItem("clean", state, false);
    expect(detail.lines[0]!.text).toBe("0 worktrees total");
    expect(detail.lines[1]!.text).toContain("No worktrees to clean");
  });

  it("uses singular 'worktree' for count of 1", () => {
    const state = makeState({
      worktrees: [{ entry: { path: "/a", branch: "b1" }, hasActivePlan: true }],
    });
    const detail = detailForItem("clean", state, false);
    expect(detail.lines[0]!.text).toBe("1 worktree total");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "settings"
// ---------------------------------------------------------------------------

describe("detailForItem — settings", () => {
  it("shows fallback message when no config provided", () => {
    const detail = detailForItem("settings", null, false);
    expect(detail.title).toBe("Settings");
    expect(detail.lines[0]!.text).toContain("Press Enter");
  });

  it("shows config values with sources", () => {
    const config = makeConfig({
      agentCommand: rv("opencode", "config"),
      baseBranch: rv("develop", "cli"),
    });
    const detail = detailForItem("settings", null, false, undefined, config);
    expect(detail.title).toBe("Settings");

    // Find agentCommand line
    const agentLine = detail.lines.find((l) =>
      l.text.startsWith("agentCommand"),
    );
    expect(agentLine).toBeDefined();
    expect(agentLine!.text).toContain("opencode");

    // Find its source line
    const agentIdx = detail.lines.indexOf(agentLine!);
    const sourceLine = detail.lines[agentIdx + 1];
    expect(sourceLine!.text).toContain("config");
    expect(sourceLine!.dim).toBe(true);

    // Find baseBranch line
    const branchLine = detail.lines.find((l) =>
      l.text.startsWith("baseBranch"),
    );
    expect(branchLine!.text).toContain("develop");
  });

  it("shows (not set) for empty string values", () => {
    const config = makeConfig({
      agentCommand: rv("", "default"),
    });
    const detail = detailForItem("settings", null, false, undefined, config);
    const agentLine = detail.lines.find((l) =>
      l.text.startsWith("agentCommand"),
    );
    expect(agentLine!.text).toContain("(not set)");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "run-next"
// ---------------------------------------------------------------------------

describe("detailForItem — run-next", () => {
  it("shows loading when state is loading", () => {
    const detail = detailForItem("run-next", null, true);
    expect(detail.loading).toBe(true);
  });

  it("shows no-plans message when pipeline is empty", () => {
    const state = makeState();
    const detail = detailForItem("run-next", state, false);
    expect(detail.lines[0]!.text).toContain("No plans available");
  });

  it("shows next plan from backlog", () => {
    const state = makeState({
      backlog: [{ filename: "next-plan.md", scope: "", dependsOn: [] }],
    });
    const detail = detailForItem("run-next", state, false);
    expect(detail.lines[0]!.text).toBe("next-plan");
    expect(detail.lines[0]!.bold).toBe(true);
  });

  it("shows scope when available", () => {
    const state = makeState({
      backlog: [
        { filename: "next-plan.md", scope: "packages/web", dependsOn: [] },
      ],
    });
    const detail = detailForItem("run-next", state, false);
    expect(detail.lines[0]!.text).toBe("next-plan");
    expect(detail.lines[1]!.text).toContain("packages/web");
  });

  it("shows dependency status for next plan", () => {
    const state = makeState({
      backlog: [{ filename: "next-plan.md", scope: "", dependsOn: ["dep-a"] }],
      completedSlugs: ["dep-a"],
    });
    const detail = detailForItem("run-next", state, false);
    expect(detail.lines[0]!.text).toBe("next-plan");
    expect(detail.lines[1]!.text).toContain("dep-a");
    expect(detail.lines[1]!.color).toBe("green");
  });

  it("shows blocked plans when all backlog has unmet deps", () => {
    const state = makeState({
      backlog: [
        { filename: "blocked.md", scope: "", dependsOn: ["unfinished"] },
      ],
    });
    const detail = detailForItem("run-next", state, false);
    expect(detail.lines[0]!.text).toContain("blocked by unmet dependencies");
  });

  it("shows in-progress message when backlog is empty but plans running", () => {
    const state = makeState({
      inProgress: [makeInProgressPlan()],
    });
    const detail = detailForItem("run-next", state, false);
    expect(detail.lines[0]!.text).toContain("all plans are in progress");
  });

  it("shows GitHub fallback when no local plans but issues available", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueCount: 7,
    };
    const detail = detailForItem("run-next", state, false, ctx);
    expect(detail.lines.some((l) => l.text.includes("7 issues"))).toBe(true);
  });

  it("shows loading hint when GitHub issues are loading and no local plans", () => {
    const state = makeState();
    const ctx: MenuContext = {
      hasGitHubIssues: true,
      githubIssueLoading: true,
    };
    const detail = detailForItem("run-next", state, false, ctx);
    expect(detail.loading).toBe(true);
    expect(detail.lines.some((l) => l.text.includes("Checking GitHub"))).toBe(
      true,
    );
  });

  it("skips first ready plan to find dependency-ready one", () => {
    const state = makeState({
      backlog: [
        { filename: "blocked.md", scope: "", dependsOn: ["dep-x"] },
        { filename: "ready.md", scope: "", dependsOn: [] },
      ],
    });
    const detail = detailForItem("run-next", state, false);
    expect(detail.lines[0]!.text).toBe("ready");
    expect(detail.lines[0]!.bold).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "resume-stalled"
// ---------------------------------------------------------------------------

describe("detailForItem — resume-stalled", () => {
  it("shows loading when state is loading", () => {
    const detail = detailForItem("resume-stalled", null, true);
    expect(detail.loading).toBe(true);
  });

  it("shows no-stalled message when none stalled", () => {
    const state = makeState();
    const detail = detailForItem("resume-stalled", state, false);
    expect(detail.lines[0]!.text).toContain("No stalled plans");
  });

  it("shows stalled plans with progress", () => {
    const state = makeState({
      inProgress: [
        makeInProgressPlan({
          slug: "stuck-plan",
          liveness: { tag: "stalled" },
          totalTasks: 10,
          tasksCompleted: 7,
        }),
      ],
    });
    const detail = detailForItem("resume-stalled", state, false);
    expect(detail.title).toBe("Stalled (1)");
    expect(detail.lines[0]!.text).toBe("stuck-plan");
    expect(detail.lines[1]!.text).toContain("7/10 tasks");
  });

  it("excludes non-stalled plans", () => {
    const state = makeState({
      inProgress: [
        makeInProgressPlan({
          slug: "running-plan",
          liveness: { tag: "running", pid: 123 },
        }),
        makeInProgressPlan({
          slug: "stalled-plan",
          liveness: { tag: "stalled" },
        }),
      ],
    });
    const detail = detailForItem("resume-stalled", state, false);
    expect(detail.title).toBe("Stalled (1)");
    expect(detail.lines[0]!.text).toBe("stalled-plan");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "run-with-options"
// ---------------------------------------------------------------------------

describe("detailForItem — run-with-options", () => {
  it("shows contextual hint", () => {
    const detail = detailForItem("run-with-options", null, false);
    expect(detail.title).toBe("Run with options");
    expect(detail.lines[0]!.text).toContain("Press Enter");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — "quit"
// ---------------------------------------------------------------------------

describe("detailForItem — quit", () => {
  it("shows exit message", () => {
    const detail = detailForItem("quit", null, false);
    expect(detail.title).toBe("Quit");
    expect(detail.lines[0]!.text).toContain("Exit");
  });
});

// ---------------------------------------------------------------------------
// detailForItem — unknown item
// ---------------------------------------------------------------------------

describe("detailForItem — unknown item", () => {
  it("returns empty content for unknown values", () => {
    const detail = detailForItem("unknown-item", null, false);
    expect(detail.title).toBe("");
    expect(detail.lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Loading indicators (subtask 8)
// ---------------------------------------------------------------------------

describe("loading indicators", () => {
  const loadableItems = [
    "pick-from-backlog",
    "stop-running",
    "reset-plan",
    "view-status",
    "clean",
    "run-next",
    "resume-stalled",
  ];

  for (const item of loadableItems) {
    it(`shows loading for "${item}" when state is loading`, () => {
      const detail = detailForItem(item, null, true);
      expect(detail.loading).toBe(true);
    });
  }

  it("shows loading for pick-from-github when issues are loading", () => {
    const ctx = makeMenuContext({
      hasGitHubIssues: true,
      githubIssueLoading: true,
    });
    const detail = detailForItem("pick-from-github", null, false, ctx);
    expect(detail.loading).toBe(true);
  });

  it("does not show loading for doctor", () => {
    const detail = detailForItem("doctor", null, true);
    expect(detail.loading).toBeUndefined();
  });

  it("does not show loading for run-with-options", () => {
    const detail = detailForItem("run-with-options", null, true);
    expect(detail.loading).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pipeline error state in detail pane (Cycle 4)
// ---------------------------------------------------------------------------

describe("pipeline error state in detail pane", () => {
  const itemsWithPipelineLoading = [
    "pick-from-backlog",
    "stop-running",
    "reset-plan",
    "view-status",
    "clean",
    "run-next",
    "resume-stalled",
  ];

  for (const item of itemsWithPipelineLoading) {
    it(`shows error for "${item}" when state is null and error is set`, () => {
      const detail = detailForItem(
        item,
        null,
        false, // not loading
        undefined,
        undefined,
        "Subprocess timed out",
      );
      expect(detail.loading).toBeFalsy();
      // The error text should appear in the lines
      const errorLine = detail.lines.find((l) =>
        l.text.includes("Subprocess timed out"),
      );
      expect(errorLine).toBeDefined();
      expect(errorLine!.color).toBe("yellow");
    });
  }

  it("shows error for run-next when no local plans and pipeline errored", () => {
    const detail = detailForItem(
      "run-next",
      null,
      false,
      undefined,
      undefined,
      "git worktree list timed out",
    );
    expect(detail.loading).toBeFalsy();
    expect(
      detail.lines.some((l) => l.text.includes("git worktree list timed out")),
    ).toBe(true);
  });

  it("does not show error for items when state is available", () => {
    const state = makeState();
    const detail = detailForItem(
      "pick-from-backlog",
      state,
      false,
      undefined,
      undefined,
      "stale error",
    );
    // With valid state, no error line should be present
    expect(detail.loading).toBeFalsy();
    expect(detail.lines.some((l) => l.text.includes("stale error"))).toBe(
      false,
    );
  });
});
