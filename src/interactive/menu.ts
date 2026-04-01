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
import { listRalphaiWorktrees, printStatusOnce } from "../ralphai.ts";
import { BOLD, DIM, RESET, TEXT } from "../utils.ts";

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

// ---------------------------------------------------------------------------
// Pipeline summary header
// ---------------------------------------------------------------------------

/**
 * Build the pipeline summary header string.
 *
 * Examples:
 * - "Pipeline: 3 backlog \u00b7 1 running \u00b7 5 completed"
 * - "Pipeline: empty"
 * - "Pipeline: 0 backlog \u00b7 0 running \u00b7 2 completed"
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
 * Returns an ordered array of `MenuItem` descriptors. Later slices will
 * add more items; this initial version includes "View pipeline status"
 * and "Quit".
 */
export function buildMenuItems(state: PipelineState): MenuItem[] {
  const items: MenuItem[] = [];

  // --- Pipeline group ---
  items.push({
    value: "view-status",
    label: "View pipeline status",
    group: "pipeline",
  });

  // --- Maintenance group ---
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

function dispatchAction(action: string, cwd: string): DispatchResult {
  switch (action) {
    case "view-status":
      console.log();
      printStatusOnce(cwd);
      return "continue";

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
    const items = buildMenuItems(state);

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

    const result = dispatchAction(selected as string, cwd);
    if (result === "exit") {
      return;
    }
  }
}
