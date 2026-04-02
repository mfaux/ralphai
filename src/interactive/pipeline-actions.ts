/**
 * Pipeline management action handlers for the interactive menu.
 *
 * Provides "Resume stalled plan", "Stop running plan", and "Reset plan"
 * actions. Each has a menu item helper (label/hint/disabled) and an
 * action handler that uses `@clack/prompts` for sub-selections.
 */

import * as clack from "@clack/prompts";
import type { PipelineState, InProgressPlan } from "../pipeline-state.ts";
import { runRalphai, resetPlanBySlug } from "../ralphai.ts";
import { runRalphaiStop } from "../stop.ts";

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
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Handle the "Resume stalled plan" action.
 *
 * If one stalled plan: delegates immediately to the runner with resume.
 * If multiple: shows a `clack.select` to pick which one to resume.
 * Ctrl+C or "Back" returns to the main menu.
 *
 * @returns `"continue"` to re-show the main menu, `"exit"` when handing
 *   off to the runner.
 */
export async function handleResumeStalled(
  state: PipelineState,
): Promise<"continue" | "exit"> {
  const stalled = stalledPlans(state);

  if (stalled.length === 0) {
    return "continue";
  }

  let slug: string;

  if (stalled.length === 1) {
    slug = stalled[0]!.slug;
  } else {
    const options = stalled.map((plan) => ({
      value: plan.slug,
      label: plan.filename,
      hint: plan.scope ? `scope: ${plan.scope}` : undefined,
    }));

    options.push({
      value: "__back__",
      label: "Back",
      hint: undefined,
    });

    const selected = await clack.select({
      message: "Pick a stalled plan to resume:",
      options,
    });

    if (clack.isCancel(selected)) {
      return "continue";
    }

    if (selected === "__back__") {
      return "continue";
    }

    slug = selected as string;
  }

  // Delegate to runner with resume behavior: run --plan <slug>.md --resume
  await runRalphai(["run", "--plan", `${slug}.md`, "--resume"]);
  return "exit";
}

/**
 * Handle the "Stop running plan" action.
 *
 * If one running plan: confirms and stops it.
 * If multiple: shows a `clack.select` to pick which one to stop.
 * Ctrl+C or "Back" returns to the main menu.
 *
 * @returns `"continue"` — always returns to the menu after stopping.
 */
export async function handleStopRunning(
  state: PipelineState,
  cwd: string,
): Promise<"continue"> {
  const running = runningPlans(state);

  if (running.length === 0) {
    return "continue";
  }

  let slug: string;

  if (running.length === 1) {
    const plan = running[0]!;
    const confirmed = await clack.confirm({
      message: `Stop '${plan.slug}' (PID ${(plan.liveness as { tag: "running"; pid: number }).pid})?`,
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      return "continue";
    }

    slug = plan.slug;
  } else {
    const options: { value: string; label: string; hint?: string }[] =
      running.map((plan) => {
        const pid = (plan.liveness as { tag: "running"; pid: number }).pid;
        return {
          value: plan.slug,
          label: plan.filename,
          hint: `PID ${pid}`,
        };
      });

    options.push({
      value: "__back__",
      label: "Back",
    });

    const selected = await clack.select({
      message: "Pick a running plan to stop:",
      options,
    });

    if (clack.isCancel(selected)) {
      return "continue";
    }

    if (selected === "__back__") {
      return "continue";
    }

    slug = selected as string;
  }

  runRalphaiStop({ cwd, dryRun: false, slug });
  return "continue";
}

/**
 * Handle the "Reset plan" action.
 *
 * Shows in-progress plans, lets user pick one, delegates to
 * `resetPlanBySlug` to move the plan back to backlog. Returns to the
 * menu.
 *
 * @returns `"continue"` — always returns to the menu after resetting.
 */
export async function handleResetPlan(
  state: PipelineState,
  cwd: string,
): Promise<"continue"> {
  const plans = resettablePlans(state);

  if (plans.length === 0) {
    return "continue";
  }

  const options = plans.map((plan) => {
    const parts: string[] = [];
    if (plan.scope) parts.push(`scope: ${plan.scope}`);
    if (plan.liveness.tag === "stalled") parts.push("stalled");
    if (plan.liveness.tag === "running") parts.push("running");
    if (plan.liveness.tag === "in_progress") parts.push("in progress");
    return {
      value: plan.slug,
      label: plan.filename,
      hint: parts.length > 0 ? parts.join(" · ") : undefined,
    };
  });

  options.push({
    value: "__back__",
    label: "Back",
    hint: undefined,
  });

  const selected = await clack.select({
    message: "Pick a plan to reset:",
    options,
  });

  if (clack.isCancel(selected)) {
    return "continue";
  }

  if (selected === "__back__") {
    return "continue";
  }

  const slug = selected as string;

  // Delegate to the simplified reset function
  resetPlanBySlug(cwd, slug);
  return "continue";
}
