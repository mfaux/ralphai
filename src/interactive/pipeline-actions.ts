/**
 * Pipeline management helpers for the interactive menu.
 *
 * Provides pure helper functions for building menu item labels, hints,
 * and disabled states, plus liveness-based plan filters. These are
 * consumed by `src/tui/menu-items.ts` and `src/tui/` components.
 *
 * The clack-based action handlers that were previously in this file have
 * been removed — the Ink TUI handles all user interaction directly.
 */

import type { PipelineState, InProgressPlan } from "../pipeline-state.ts";

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
