/**
 * Tests for interactive run action helpers.
 *
 * Tests the pure helper functions: unmetDependencies, findNextPlanName,
 * runNextMenuItem, and pickFromBacklogMenuItem. These are pure unit
 * tests — no filesystem, no subprocess, no clack prompts.
 */

import { describe, it, expect } from "bun:test";
import type { PipelineState } from "../plan-lifecycle.ts";
import type { BacklogPlan } from "../plan-lifecycle.ts";
import {
  unmetDependencies,
  findNextPlanName,
  runNextMenuItem,
  pickFromBacklogMenuItem,
  pickFromGithubMenuItem,
  runWithOptionsMenuItem,
} from "./run-actions.ts";

// ---------------------------------------------------------------------------
// Helpers
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

function makePlan(
  filename: string,
  opts?: { scope?: string; dependsOn?: string[] },
): BacklogPlan {
  return {
    filename,
    scope: opts?.scope ?? "",
    dependsOn: opts?.dependsOn ?? [],
  };
}

// ---------------------------------------------------------------------------
// unmetDependencies
// ---------------------------------------------------------------------------

describe("unmetDependencies", () => {
  it("returns empty array when plan has no dependencies", () => {
    const plan = makePlan("a.md");
    expect(unmetDependencies(plan, [])).toEqual([]);
  });

  it("returns all deps when none are completed", () => {
    const plan = makePlan("a.md", { dependsOn: ["dep-x.md", "dep-y.md"] });
    expect(unmetDependencies(plan, [])).toEqual(["dep-x.md", "dep-y.md"]);
  });

  it("filters out completed dependencies", () => {
    const plan = makePlan("a.md", { dependsOn: ["dep-x.md", "dep-y.md"] });
    expect(unmetDependencies(plan, ["dep-x"])).toEqual(["dep-y.md"]);
  });

  it("returns empty when all deps are completed", () => {
    const plan = makePlan("a.md", { dependsOn: ["dep-x.md", "dep-y.md"] });
    expect(unmetDependencies(plan, ["dep-x", "dep-y"])).toEqual([]);
  });

  it("handles deps specified without .md extension in dependsOn", () => {
    const plan = makePlan("a.md", { dependsOn: ["dep-x"] });
    expect(unmetDependencies(plan, ["dep-x"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findNextPlanName
// ---------------------------------------------------------------------------

describe("findNextPlanName", () => {
  it("returns undefined when backlog is empty", () => {
    const state = makeState();
    expect(findNextPlanName(state)).toBeUndefined();
  });

  it("returns first plan when it has no dependencies", () => {
    const state = makeState({
      backlog: [makePlan("first.md"), makePlan("second.md")],
    });
    expect(findNextPlanName(state)).toBe("first.md");
  });

  it("skips blocked plans and returns first ready one", () => {
    const state = makeState({
      backlog: [
        makePlan("blocked.md", { dependsOn: ["dep.md"] }),
        makePlan("ready.md"),
      ],
    });
    expect(findNextPlanName(state)).toBe("ready.md");
  });

  it("returns undefined when all plans are blocked", () => {
    const state = makeState({
      backlog: [
        makePlan("a.md", { dependsOn: ["dep.md"] }),
        makePlan("b.md", { dependsOn: ["other.md"] }),
      ],
    });
    expect(findNextPlanName(state)).toBeUndefined();
  });

  it("considers completed slugs when checking readiness", () => {
    const state = makeState({
      backlog: [makePlan("a.md", { dependsOn: ["dep.md"] })],
      completedSlugs: ["dep"],
    });
    expect(findNextPlanName(state)).toBe("a.md");
  });
});

// ---------------------------------------------------------------------------
// runNextMenuItem
// ---------------------------------------------------------------------------

describe("runNextMenuItem", () => {
  it("includes plan name when a ready plan exists", () => {
    const state = makeState({ backlog: [makePlan("add-auth.md")] });
    const item = runNextMenuItem(state, false);

    expect(item.label).toBe("Run next plan (add-auth.md)");
    expect(item.disabled).toBe(false);
    expect(item.hint).toBeUndefined();
  });

  it("is disabled with nothing queued when empty and no GitHub", () => {
    const state = makeState();
    const item = runNextMenuItem(state, false);

    expect(item.label).toBe("Run next plan");
    expect(item.hint).toBe("(nothing queued)");
    expect(item.disabled).toBe(true);
  });

  it("shows GitHub hint when empty but GitHub configured", () => {
    const state = makeState();
    const item = runNextMenuItem(state, true);

    expect(item.label).toBe("Run next plan");
    expect(item.hint).toBe("will pull from GitHub");
    expect(item.disabled).toBe(false);
  });

  it("shows plan name even when GitHub is configured", () => {
    const state = makeState({ backlog: [makePlan("my-plan.md")] });
    const item = runNextMenuItem(state, true);

    // Local plan takes precedence over GitHub hint
    expect(item.label).toBe("Run next plan (my-plan.md)");
    expect(item.disabled).toBe(false);
  });

  it("is disabled when all plans are blocked and no GitHub", () => {
    const state = makeState({
      backlog: [makePlan("blocked.md", { dependsOn: ["dep.md"] })],
    });
    const item = runNextMenuItem(state, false);

    expect(item.disabled).toBe(true);
    expect(item.hint).toBe("(nothing queued)");
  });

  it("is disabled with '(no GitHub issues)' when GitHub configured but count is 0", () => {
    const state = makeState();
    const item = runNextMenuItem(state, true, 0);

    expect(item.label).toBe("Run next plan");
    expect(item.hint).toBe("(no GitHub issues)");
    expect(item.disabled).toBe(true);
  });

  it("shows issue count in hint when GitHub issues are available", () => {
    const state = makeState();
    const item = runNextMenuItem(state, true, 5);

    expect(item.label).toBe("Run next plan");
    expect(item.hint).toBe("will pull oldest of 5 from GitHub");
    expect(item.disabled).toBe(false);
  });

  it("uses singular 'issue' for count of 1", () => {
    const state = makeState();
    const item = runNextMenuItem(state, true, 1);

    expect(item.hint).toBe("will pull oldest of 1 from GitHub");
  });

  it("falls back to generic hint when count is undefined", () => {
    const state = makeState();
    const item = runNextMenuItem(state, true, undefined);

    expect(item.label).toBe("Run next plan");
    expect(item.hint).toBe("will pull from GitHub");
    expect(item.disabled).toBe(false);
  });

  it("shows plan name regardless of GitHub issue count", () => {
    const state = makeState({ backlog: [makePlan("local.md")] });
    const item = runNextMenuItem(state, true, 5);

    // Local plan takes precedence — no GitHub hint needed
    expect(item.label).toBe("Run next plan (local.md)");
    expect(item.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pickFromBacklogMenuItem
// ---------------------------------------------------------------------------

describe("pickFromBacklogMenuItem", () => {
  it("shows count for multiple plans", () => {
    const state = makeState({
      backlog: [makePlan("a.md"), makePlan("b.md"), makePlan("c.md")],
    });
    const item = pickFromBacklogMenuItem(state);

    expect(item.label).toBe("Pick from backlog (3 plans)");
    expect(item.disabled).toBe(false);
  });

  it("uses singular for one plan", () => {
    const state = makeState({ backlog: [makePlan("only.md")] });
    const item = pickFromBacklogMenuItem(state);

    expect(item.label).toBe("Pick from backlog (1 plan)");
    expect(item.disabled).toBe(false);
  });

  it("is disabled with (empty) when backlog is empty", () => {
    const state = makeState();
    const item = pickFromBacklogMenuItem(state);

    expect(item.label).toBe("Pick from backlog");
    expect(item.hint).toBe("(empty)");
    expect(item.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pickFromGithubMenuItem
// ---------------------------------------------------------------------------

describe("pickFromGithubMenuItem", () => {
  it("is disabled with (not configured) when GitHub is not configured", () => {
    const item = pickFromGithubMenuItem({ hasGitHubIssues: false });

    expect(item.label).toBe("Pick from GitHub");
    expect(item.hint).toBe("(not configured)");
    expect(item.disabled).toBe(true);
  });

  it("shows count when GitHub is configured and count is known", () => {
    const item = pickFromGithubMenuItem({
      hasGitHubIssues: true,
      githubIssueCount: 5,
    });

    expect(item.label).toBe("Pick from GitHub (5 issues)");
    expect(item.disabled).toBe(false);
  });

  it("uses singular 'issue' for count of 1", () => {
    const item = pickFromGithubMenuItem({
      hasGitHubIssues: true,
      githubIssueCount: 1,
    });

    expect(item.label).toBe("Pick from GitHub (1 issue)");
    expect(item.disabled).toBe(false);
  });

  it("is disabled with (no issues) when count is 0", () => {
    const item = pickFromGithubMenuItem({
      hasGitHubIssues: true,
      githubIssueCount: 0,
    });

    expect(item.label).toBe("Pick from GitHub");
    expect(item.hint).toBe("(no issues)");
    expect(item.disabled).toBe(true);
  });

  it("is enabled without count when count is not yet known", () => {
    const item = pickFromGithubMenuItem({
      hasGitHubIssues: true,
      githubIssueCount: undefined,
    });

    expect(item.label).toBe("Pick from GitHub");
    expect(item.hint).toBeUndefined();
    expect(item.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runWithOptionsMenuItem
// ---------------------------------------------------------------------------

describe("runWithOptionsMenuItem", () => {
  it("returns 'Run with options...' label", () => {
    const item = runWithOptionsMenuItem();
    expect(item.label).toBe("Run with options...");
  });

  it("is always enabled", () => {
    const item = runWithOptionsMenuItem();
    expect(item.disabled).toBe(false);
  });

  it("has a hint about configuring", () => {
    const item = runWithOptionsMenuItem();
    expect(item.hint).toBe("configure before running");
  });
});
