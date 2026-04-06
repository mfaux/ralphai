/**
 * TUI menu items — pure data layer.
 *
 * Ports `buildMenuItems()` and `buildHeaderLine()` from the clack-based
 * interactive menu to a pure-function module suitable for Ink rendering.
 *
 * Key differences from `src/interactive/menu.ts`:
 *
 * - Groups renamed: run → START, pipeline → MANAGE, maintenance → TOOLS
 * - `recent-activity` item dropped
 * - `view-config` + `edit-config` consolidated into `settings`
 * - Each item carries an optional `hotkey` for single-key activation
 */

import type { PipelineState } from "../pipeline-state.ts";
import { DIM, RESET, TEXT } from "../utils.ts";
import {
  runNextMenuItem,
  pickFromBacklogMenuItem,
  pickFromGithubMenuItem,
  runWithOptionsMenuItem,
} from "../interactive/run-actions.ts";
import {
  stalledWarning,
  resumeStalledMenuItem,
  stopRunningMenuItem,
  resetPlanMenuItem,
} from "../interactive/pipeline-actions.ts";

// ---------------------------------------------------------------------------
// Menu item types
// ---------------------------------------------------------------------------

/** Visual group ordering for TUI menu items. */
export type MenuGroup = "START" | "MANAGE" | "TOOLS";

/** A single TUI menu item descriptor. */
export interface MenuItem {
  value: string;
  label: string;
  hint?: string;
  group: MenuGroup;
  disabled?: boolean;
  /** Single-key hotkey that fires the action immediately on the main menu. */
  hotkey?: string;
}

/** Extra context for menu construction that lives outside PipelineState. */
export interface MenuContext {
  /** Whether GitHub issues are configured as the issue source. */
  hasGitHubIssues: boolean;
  /** Number of available GitHub issues (from peek). */
  githubIssueCount?: number;
  /** `true` while the GitHub issue peek is in flight. */
  githubIssueLoading?: boolean;
  /** Error string from a failed GitHub issue peek. */
  githubIssueError?: string;
}

// ---------------------------------------------------------------------------
// Pipeline summary header
// ---------------------------------------------------------------------------

/**
 * Build the pipeline summary header string.
 *
 * Examples:
 * - "Pipeline: 3 backlog · 1 running · 5 completed"
 * - "Pipeline: 3 backlog · 1 running · 5 completed · ⚠ 1 plan stalled"
 * - "Pipeline: empty"
 * - "Pipeline: 0 backlog · 0 running · 2 completed"
 */
export function buildHeaderLine(state: PipelineState): string {
  const backlogCount = state.backlog.length;
  const runningCount = state.inProgress.length;
  const completedCount = state.completedSlugs.length;

  if (backlogCount === 0 && runningCount === 0 && completedCount === 0) {
    return `${TEXT}Pipeline: ${DIM}empty${RESET}`;
  }

  const parts = [
    `${backlogCount} backlog`,
    `${runningCount} running`,
    `${completedCount} completed`,
  ];

  const warning = stalledWarning(state);
  if (warning) {
    parts.push(warning);
  }

  return `${TEXT}Pipeline: ${DIM}${parts.join(" \u00b7 ")}${RESET}`;
}

// ---------------------------------------------------------------------------
// Empty pipeline detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the pipeline is completely empty — no backlog plans,
 * no in-progress plans, and no completed plans.
 *
 * Used by the menu screen to display a helpful getting-started hint.
 */
export function isPipelineEmpty(state: PipelineState): boolean {
  return (
    state.backlog.length === 0 &&
    state.inProgress.length === 0 &&
    state.completedSlugs.length === 0
  );
}

// ---------------------------------------------------------------------------
// Menu item construction
// ---------------------------------------------------------------------------

/** Group sort order for visual display. */
const GROUP_ORDER: Record<MenuGroup, number> = {
  START: 0,
  MANAGE: 1,
  TOOLS: 2,
};

/**
 * Build menu items from the current pipeline state.
 *
 * Returns an ordered array of `MenuItem` descriptors. Items are sorted
 * by group (START → MANAGE → TOOLS) with insertion order preserved
 * within each group.
 *
 * When stalled plans exist, "Resume stalled plan" is promoted to the
 * top of the START group (before "Run next plan").
 */
export function buildMenuItems(
  state: PipelineState,
  ctx: MenuContext = { hasGitHubIssues: false },
): MenuItem[] {
  const items: MenuItem[] = [];

  // --- Resume stalled (promoted to START group when stalled plans exist) ---
  const resume = resumeStalledMenuItem(state);
  const hasStalledPlans = !resume.disabled;
  items.push({
    value: "resume-stalled",
    label: resume.label,
    hint: resume.hint,
    group: hasStalledPlans ? "START" : "MANAGE",
    disabled: resume.disabled,
    hotkey: "r",
  });

  // --- START group ---

  // When GitHub issues are loading or errored, override the context
  // passed to item builders so they show appropriate hints.
  const githubLoading = ctx.hasGitHubIssues && ctx.githubIssueLoading === true;
  const githubError = ctx.hasGitHubIssues ? ctx.githubIssueError : undefined;

  const runNext = runNextMenuItem(
    state,
    ctx.hasGitHubIssues,
    ctx.githubIssueCount,
  );

  // Override run-next hint when GitHub data is still loading or errored
  // and the item is in a GitHub-dependent state (no local plan found).
  // When a local plan is available, the label includes the plan name and
  // the hint is irrelevant to GitHub, so we leave it alone.
  const localPlanFound = runNext.label !== "Run next plan";
  const runNextHint =
    !localPlanFound && githubLoading
      ? "loading\u2026"
      : !localPlanFound && githubError
        ? `(GitHub: ${githubError})`
        : runNext.hint;

  items.push({
    value: "run-next",
    label: runNext.label,
    hint: runNextHint,
    group: "START",
    disabled: runNext.disabled,
    hotkey: "n",
  });

  const pickBacklog = pickFromBacklogMenuItem(state);
  items.push({
    value: "pick-from-backlog",
    label: pickBacklog.label,
    hint: pickBacklog.hint,
    group: "START",
    disabled: pickBacklog.disabled,
    hotkey: "b",
  });

  // Override pick-from-github item for loading/error states
  let pickGithub: { label: string; hint?: string; disabled: boolean };

  if (githubLoading) {
    pickGithub = {
      label: "Pick from GitHub",
      hint: "loading…",
      disabled: true,
    };
  } else if (githubError) {
    pickGithub = {
      label: "Pick from GitHub",
      hint: `(${githubError})`,
      disabled: true,
    };
  } else {
    pickGithub = pickFromGithubMenuItem(ctx);
  }

  items.push({
    value: "pick-from-github",
    label: pickGithub.label,
    hint: pickGithub.hint,
    group: "START",
    disabled: pickGithub.disabled,
    hotkey: "g",
  });

  const runWithOpts = runWithOptionsMenuItem();
  items.push({
    value: "run-with-options",
    label: runWithOpts.label,
    hint: runWithOpts.hint,
    group: "START",
    disabled: runWithOpts.disabled,
    hotkey: "o",
  });

  // --- MANAGE group ---
  const stop = stopRunningMenuItem(state);
  items.push({
    value: "stop-running",
    label: stop.label,
    hint: stop.hint,
    group: "MANAGE",
    disabled: stop.disabled,
    hotkey: "s",
  });

  const reset = resetPlanMenuItem(state);
  items.push({
    value: "reset-plan",
    label: reset.label,
    hint: reset.hint,
    group: "MANAGE",
    disabled: reset.disabled,
    hotkey: "e",
  });

  items.push({
    value: "view-status",
    label: "View pipeline status",
    group: "MANAGE",
    hotkey: "p",
  });

  // --- TOOLS group ---
  items.push({
    value: "doctor",
    label: "Doctor",
    hint: "run health checks",
    group: "TOOLS",
    hotkey: "d",
  });

  items.push({
    value: "clean",
    label: "Clean worktrees",
    group: "TOOLS",
    hotkey: "c",
  });

  items.push({
    value: "settings",
    label: "Settings",
    hint: "view or edit config",
    group: "TOOLS",
  });

  items.push({
    value: "quit",
    label: "Quit",
    group: "TOOLS",
    hotkey: "q",
  });

  // Sort by group order, preserving insertion order within each group
  items.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);

  return items;
}
