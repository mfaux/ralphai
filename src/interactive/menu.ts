/**
 * Interactive menu module.
 *
 * Provides a looping interactive menu for the no-args TTY path. Displays
 * a pipeline summary header and a `@clack/prompts` select menu with
 * actions like "View pipeline status" and "Quit".
 */

import * as clack from "@clack/prompts";
import type { PipelineState } from "../pipeline-state.ts";
import { gatherPipelineState } from "../pipeline-state.ts";
import { resolveConfig } from "../config.ts";
import { listRalphaiWorktrees, printStatusOnce } from "../ralphai.ts";
import { peekGithubIssues, peekPrdIssues } from "../issues.ts";
import { DIM, RESET, TEXT } from "../utils.ts";
import {
  runNextMenuItem,
  pickFromBacklogMenuItem,
  pickFromGithubMenuItem,
  handleRunNext,
  handlePickFromBacklog,
  handlePickFromGitHub,
} from "./run-actions.ts";
import {
  stalledWarning,
  resumeStalledMenuItem,
  stopRunningMenuItem,
  resetPlanMenuItem,
  recentActivityMenuItem,
  handleResumeStalled,
  handleStopRunning,
  handleResetPlan,
  handleRecentActivity,
} from "./pipeline-actions.ts";
import {
  handleDoctor,
  handleClean,
  handleViewConfig,
  handleEditConfig,
} from "./maintenance-actions.ts";

// ---------------------------------------------------------------------------
// Menu item types
// ---------------------------------------------------------------------------

/** Visual group ordering for menu items. */
export type MenuGroup = "run" | "pipeline" | "maintenance";

/** A single menu item descriptor. */
export interface MenuItem {
  value: string;
  label: string;
  hint?: string;
  group: MenuGroup;
  disabled?: boolean;
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
    issueLabel: string;
    issueRepo: string;
  };
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
  run: 0,
  pipeline: 1,
  maintenance: 2,
};

/**
 * Build menu items from the current pipeline state.
 *
 * Returns an ordered array of `MenuItem` descriptors. Items are sorted
 * by group (run → pipeline → maintenance) with insertion order preserved
 * within each group.
 *
 * When stalled plans exist, "Resume stalled plan" is promoted to the
 * top of the run group (before "Run next plan").
 */
export function buildMenuItems(
  state: PipelineState,
  ctx: MenuContext = { hasGitHubIssues: false },
): MenuItem[] {
  const items: MenuItem[] = [];

  // --- Resume stalled (promoted to run group when stalled plans exist) ---
  const resume = resumeStalledMenuItem(state);
  const hasStalledPlans = !resume.disabled;
  items.push({
    value: "resume-stalled",
    label: resume.label,
    hint: resume.hint,
    group: hasStalledPlans ? "run" : "pipeline",
    disabled: resume.disabled,
  });

  // --- Run group ---
  const runNext = runNextMenuItem(
    state,
    ctx.hasGitHubIssues,
    ctx.githubIssueCount,
  );
  items.push({
    value: "run-next",
    label: runNext.label,
    hint: runNext.hint,
    group: "run",
    disabled: runNext.disabled,
  });

  const pickBacklog = pickFromBacklogMenuItem(state);
  items.push({
    value: "pick-from-backlog",
    label: pickBacklog.label,
    hint: pickBacklog.hint,
    group: "run",
    disabled: pickBacklog.disabled,
  });

  const pickGithub = pickFromGithubMenuItem(ctx);
  items.push({
    value: "pick-from-github",
    label: pickGithub.label,
    hint: pickGithub.hint,
    group: "run",
    disabled: pickGithub.disabled,
  });

  // --- Pipeline group ---
  const stop = stopRunningMenuItem(state);
  items.push({
    value: "stop-running",
    label: stop.label,
    hint: stop.hint,
    group: "pipeline",
    disabled: stop.disabled,
  });

  const reset = resetPlanMenuItem(state);
  items.push({
    value: "reset-plan",
    label: reset.label,
    hint: reset.hint,
    group: "pipeline",
    disabled: reset.disabled,
  });

  items.push({
    value: "view-status",
    label: "View pipeline status",
    group: "pipeline",
  });

  const recentActivity = recentActivityMenuItem(state);
  items.push({
    value: "recent-activity",
    label: recentActivity.label,
    hint: recentActivity.hint,
    group: "pipeline",
    disabled: recentActivity.disabled,
  });

  // --- Maintenance group ---
  items.push({
    value: "doctor",
    label: "Doctor",
    hint: "run health checks",
    group: "maintenance",
  });

  items.push({
    value: "clean",
    label: "Clean worktrees",
    group: "maintenance",
  });

  items.push({
    value: "view-config",
    label: "View config",
    group: "maintenance",
  });

  items.push({
    value: "edit-config",
    label: "Edit config",
    hint: "re-run init wizard",
    group: "maintenance",
  });

  items.push({
    value: "quit",
    label: "Quit",
    group: "maintenance",
  });

  // Sort by group order, preserving insertion order within each group
  items.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);

  return items;
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

/** Return value indicating whether the menu loop should continue. */
type DispatchResult = "continue" | "exit";

async function dispatchAction(
  action: string,
  _cwd: string,
  state: PipelineState,
  ctx: MenuContext,
): Promise<DispatchResult> {
  switch (action) {
    case "resume-stalled":
      return handleResumeStalled(state);

    case "run-next":
      await handleRunNext();
      return "exit";

    case "pick-from-backlog":
      return handlePickFromBacklog(state);

    case "pick-from-github":
      if (ctx.githubConfig) {
        return handlePickFromGitHub(ctx.githubConfig);
      }
      return "continue";

    case "stop-running":
      return handleStopRunning(state, _cwd);

    case "reset-plan":
      return handleResetPlan(state, _cwd);

    case "view-status":
      console.log();
      printStatusOnce(_cwd);
      return "continue";

    case "recent-activity":
      return handleRecentActivity(_cwd);

    case "doctor":
      return handleDoctor(_cwd);

    case "clean":
      return handleClean(_cwd);

    case "view-config":
      return handleViewConfig(_cwd);

    case "edit-config":
      return handleEditConfig();

    case "quit":
      return "exit";

    default:
      return "continue";
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the interactive menu loop.
 *
 * Displays a pipeline summary header and a select menu. Re-gathers
 * pipeline state before each iteration so data is always fresh.
 * Exits cleanly on "Quit" or Ctrl+C.
 */
export async function runInteractive(cwd: string): Promise<void> {
  // Resolve config once for the session to check GitHub issue source
  let hasGitHubIssues = false;
  let issueLabel = "ralphai";
  let issueRepo = "";
  try {
    const { config } = resolveConfig({
      cwd,
      envVars: process.env,
      cliArgs: [],
    });
    hasGitHubIssues = config.issueSource.value === "github";
    issueLabel = config.issueLabel.value;
    issueRepo = config.issueRepo.value;
  } catch {
    // Config resolution failure — proceed with defaults
  }

  // Peek at GitHub issue count (for menu item label). Combines regular
  // issues and PRDs, deduplicating by counting the larger set.
  let githubIssueCount: number | undefined;
  if (hasGitHubIssues) {
    const regularPeek = peekGithubIssues({
      cwd,
      issueSource: "github",
      issueLabel,
      issueRepo,
    });
    const prdPeek = peekPrdIssues({
      cwd,
      issueSource: "github",
      issueLabel,
      issueRepo,
    });
    // Sum but accept that some overlap may exist (close enough for a label)
    githubIssueCount = (regularPeek.count || 0) + (prdPeek.count || 0);
  }

  const ctx: MenuContext = {
    hasGitHubIssues,
    githubIssueCount,
    githubConfig: hasGitHubIssues ? { cwd, issueLabel, issueRepo } : undefined,
  };

  while (true) {
    // Gather fresh pipeline state each iteration
    let worktrees: { path: string; branch: string }[] = [];
    try {
      worktrees = listRalphaiWorktrees(cwd);
    } catch {
      // Not in a git repo or git not available
    }
    const state = gatherPipelineState(cwd, { worktrees });

    // Display header
    console.log();
    console.log(buildHeaderLine(state));
    console.log();

    // Build and display menu
    const items = buildMenuItems(state, ctx);

    const selected = await clack.select({
      message: "What would you like to do?",
      options: items.map((item) => ({
        value: item.value,
        label: item.label,
        hint: item.hint,
      })),
    });

    // Ctrl+C or escape
    if (clack.isCancel(selected)) {
      return;
    }

    const result = await dispatchAction(selected as string, cwd, state, ctx);
    if (result === "exit") {
      return;
    }
  }
}
