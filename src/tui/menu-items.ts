/**
 * TUI menu items module.
 *
 * Pure-function data layer for the TUI main menu. Builds menu item
 * descriptors from pipeline state — no I/O, no rendering.
 *
 * Ported from `src/interactive/menu.ts` with these changes:
 * - Groups renamed: run → START, pipeline → MANAGE, maintenance → TOOLS
 * - `recent-activity` item dropped
 * - `view-config` + `edit-config` consolidated → `settings`
 * - Hotkey assignments added to every item
 */

import type { PipelineState } from "../pipeline-state.ts";
import type { ResolvedConfig } from "../config.ts";
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

/** A single menu item descriptor. */
export interface MenuItem {
  value: string;
  label: string;
  hint?: string;
  group: MenuGroup;
  disabled?: boolean;
  /** Single-key hotkey for immediate activation on the main menu. */
  hotkey?: string;
}

/** Extra context for menu construction that lives outside PipelineState. */
export interface MenuContext {
  /** Whether GitHub issues are configured as the issue source. */
  hasGitHubIssues: boolean;
  /** Number of available GitHub issues (from peek). */
  githubIssueCount?: number;
  /** Resolved config values needed by GitHub actions. */
  githubConfig?: {
    cwd: string;
    standaloneLabel: string;
    issueRepo: string;
    issuePrdLabel?: string;
  };
  /** Resolved config for the run wizard. */
  resolvedConfig?: ResolvedConfig;
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
  const runNext = runNextMenuItem(
    state,
    ctx.hasGitHubIssues,
    ctx.githubIssueCount,
  );
  items.push({
    value: "run-next",
    label: runNext.label,
    hint: runNext.hint,
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

  const pickGithub = pickFromGithubMenuItem(ctx);
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
