/**
 * Pipeline management helpers for the interactive menu.
 *
 * Provides pure helper functions that filter plans by liveness state
 * and build menu item descriptors (label, hint, disabled) from pipeline
 * state. Also provides recent-activity reading/formatting utilities.
 *
 * No I/O or rendering — all clack-based action handlers have been
 * removed in favour of the Ink-based TUI screens.
 */

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { PipelineState, InProgressPlan } from "../pipeline-state.ts";
import { parseReceipt } from "../receipt.ts";
import { DIM, RESET, TEXT } from "../utils.ts";

// ---------------------------------------------------------------------------
// Helpers — filter in-progress plans by liveness
// ---------------------------------------------------------------------------

/** Plans whose runner PID is dead (stalled). */
export function stalledPlans(state: PipelineState): InProgressPlan[] {
  return state.inProgress.filter((p) => p.liveness.tag === "stalled");
}

/** Plans whose runner PID is alive (running). */
export function runningPlans(state: PipelineState): InProgressPlan[] {
  return state.inProgress.filter((p) => p.liveness.tag === "running");
}

/** Plans that are in-progress (any liveness except outcome-based). */
export function resettablePlans(state: PipelineState): InProgressPlan[] {
  return state.inProgress.filter((p) => p.liveness.tag !== "outcome");
}

// ---------------------------------------------------------------------------
// Menu item helpers
// ---------------------------------------------------------------------------

/**
 * Build the label, hint, and disabled state for "Resume stalled plan".
 */
export function resumeStalledMenuItem(state: PipelineState): {
  label: string;
  hint?: string;
  disabled: boolean;
} {
  const stalled = stalledPlans(state);

  if (stalled.length === 0) {
    return {
      label: "Resume stalled plan",
      hint: "(none)",
      disabled: true,
    };
  }

  return {
    label: `Resume stalled plan (${stalled.length} stalled)`,
    disabled: false,
  };
}

/**
 * Build the label, hint, and disabled state for "Stop running plan".
 */
export function stopRunningMenuItem(state: PipelineState): {
  label: string;
  hint?: string;
  disabled: boolean;
} {
  const running = runningPlans(state);

  if (running.length === 0) {
    return {
      label: "Stop running plan",
      hint: "(none)",
      disabled: true,
    };
  }

  return {
    label: `Stop running plan (${running.length} running)`,
    disabled: false,
  };
}

/**
 * Build the label, hint, and disabled state for "Reset plan".
 */
export function resetPlanMenuItem(state: PipelineState): {
  label: string;
  hint?: string;
  disabled: boolean;
} {
  const plans = resettablePlans(state);

  if (plans.length === 0) {
    return {
      label: "Reset plan",
      hint: "(none)",
      disabled: true,
    };
  }

  return {
    label: `Reset plan (${plans.length} in progress)`,
    disabled: false,
  };
}

// ---------------------------------------------------------------------------
// Stalled warning banner
// ---------------------------------------------------------------------------

/**
 * Build the stalled warning string for the header, or `undefined` if
 * no plans are stalled.
 *
 * Examples:
 * - "⚠ 1 plan stalled"
 * - "⚠ 3 plans stalled"
 */
export function stalledWarning(state: PipelineState): string | undefined {
  const count = stalledPlans(state).length;
  if (count === 0) return undefined;
  return `⚠ ${count} plan${count === 1 ? "" : "s"} stalled`;
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

/**
 * Build the label, hint, and disabled state for "Recent activity".
 */
export function recentActivityMenuItem(state: PipelineState): {
  label: string;
  hint?: string;
  disabled: boolean;
} {
  if (state.completedSlugs.length === 0) {
    return {
      label: "Recent activity",
      hint: "(none)",
      disabled: true,
    };
  }

  return {
    label: `Recent activity (${state.completedSlugs.length} completed)`,
    disabled: false,
  };
}

/** Entry from an archived receipt for display. */
export interface ArchivedPlan {
  slug: string;
  prUrl?: string;
  startedAt?: string;
}

/**
 * Read the most recent archived plans (up to `limit`) from the archive
 * directory. Sorts by directory mtime (most recent first).
 */
export function readArchivedPlans(
  archiveDir: string,
  limit = 10,
): ArchivedPlan[] {
  if (!existsSync(archiveDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(archiveDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  // Sort by mtime descending (most recent first)
  const withMtime = entries
    .map((name) => {
      const dir = join(archiveDir, name);
      try {
        return { name, mtime: statSync(dir).mtimeMs };
      } catch {
        return { name, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime);

  const result: ArchivedPlan[] = [];
  for (const { name } of withMtime.slice(0, limit)) {
    const receiptPath = join(archiveDir, name, "receipt.txt");
    const receipt = parseReceipt(receiptPath);
    result.push({
      slug: name,
      prUrl: receipt?.pr_url,
      startedAt: receipt?.started_at,
    });
  }
  return result;
}

/**
 * Format a single archived plan for display.
 */
export function formatArchivedPlan(plan: ArchivedPlan): string {
  const check = `${TEXT}✓${RESET}`;
  if (plan.prUrl) {
    return `  ${check} ${plan.slug}  ${DIM}${plan.prUrl}${RESET}`;
  }
  return `  ${check} ${plan.slug}`;
}
