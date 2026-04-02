/**
 * Run action handlers for the interactive menu.
 *
 * Provides "Run next plan", "Pick from backlog", and "Pick from GitHub"
 * actions. All delegate to `runRalphai(["run", ...])` and signal the
 * menu loop to exit so the runner owns the terminal.
 */

import * as clack from "@clack/prompts";
import type { PipelineState, BacklogPlan } from "../pipeline-state.ts";
import { runRalphai } from "../ralphai.ts";
import {
  listGithubIssues,
  buildGithubPickList,
  type ListGithubIssuesOptions,
} from "./github-issues.ts";

// ---------------------------------------------------------------------------
// Helpers — next-plan detection from PipelineState
// ---------------------------------------------------------------------------

/**
 * Compute unmet dependencies for a backlog plan.
 * A dependency is unmet when its slug is not in `completedSlugs`.
 */
export function unmetDependencies(
  plan: BacklogPlan,
  completedSlugs: string[],
): string[] {
  if (plan.dependsOn.length === 0) return [];
  const doneSet = new Set(completedSlugs);
  return plan.dependsOn.filter((dep) => {
    const slug = dep.replace(/\.md$/, "");
    return !doneSet.has(slug);
  });
}

/**
 * Find the auto-detected "next" plan name from pipeline state.
 *
 * Mirrors the `detectPlan` algorithm: first ready plan (by alphabetical
 * order) whose dependencies are all satisfied. Returns `undefined` when
 * no plan is ready.
 */
export function findNextPlanName(state: PipelineState): string | undefined {
  for (const plan of state.backlog) {
    const unmet = unmetDependencies(plan, state.completedSlugs);
    if (unmet.length === 0) {
      return plan.filename;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Menu item helpers
// ---------------------------------------------------------------------------

/**
 * Build the label and hint for the "Run next plan" menu item.
 */
export function runNextMenuItem(
  state: PipelineState,
  hasGitHubIssues: boolean,
): { label: string; hint?: string; disabled: boolean } {
  const nextPlan = findNextPlanName(state);

  if (nextPlan) {
    return {
      label: `Run next plan (${nextPlan})`,
      disabled: false,
    };
  }

  // No local plans ready — if GitHub issues are configured, the runner
  // will auto-pull from GitHub, so the item stays enabled.
  if (hasGitHubIssues) {
    return {
      label: "Run next plan",
      hint: "will pull from GitHub",
      disabled: false,
    };
  }

  return {
    label: "Run next plan",
    hint: "(nothing queued)",
    disabled: true,
  };
}

/**
 * Build the label and hint for the "Pick from backlog" menu item.
 */
export function pickFromBacklogMenuItem(state: PipelineState): {
  label: string;
  hint?: string;
  disabled: boolean;
} {
  const count = state.backlog.length;

  if (count === 0) {
    return {
      label: "Pick from backlog",
      hint: "(empty)",
      disabled: true,
    };
  }

  return {
    label: `Pick from backlog (${count} plan${count === 1 ? "" : "s"})`,
    disabled: false,
  };
}

/**
 * Build the label and hint for the "Pick from GitHub" menu item.
 *
 * Disabled with "(not configured)" when `issueSource` is not "github".
 * When configured, shows the count of available issues if known.
 */
export function pickFromGithubMenuItem(ctx: {
  hasGitHubIssues: boolean;
  githubIssueCount?: number;
}): {
  label: string;
  hint?: string;
  disabled: boolean;
} {
  if (!ctx.hasGitHubIssues) {
    return {
      label: "Pick from GitHub",
      hint: "(not configured)",
      disabled: true,
    };
  }

  const count = ctx.githubIssueCount;
  if (count !== undefined && count > 0) {
    return {
      label: `Pick from GitHub (${count} issue${count === 1 ? "" : "s"})`,
      disabled: false,
    };
  }

  if (count === 0) {
    return {
      label: "Pick from GitHub",
      hint: "(no issues)",
      disabled: true,
    };
  }

  // Count not yet known — show as enabled without count
  return {
    label: "Pick from GitHub",
    disabled: false,
  };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Handle the "Run next plan" action.
 * Delegates to `runRalphai(["run"])` which auto-detects the next plan.
 */
export async function handleRunNext(): Promise<void> {
  await runRalphai(["run"]);
}

/**
 * Handle the "Pick from backlog" action.
 *
 * Presents a `clack.select` sub-list of all backlog plans with scope
 * and dependency info. Selecting a plan delegates to
 * `runRalphai(["run", "--plan", filename])`. The "Back" option or
 * Ctrl+C returns to the main menu.
 *
 * @returns `"continue"` to re-show the main menu, `"exit"` when handing
 *   off to the runner.
 */
export async function handlePickFromBacklog(
  state: PipelineState,
): Promise<"continue" | "exit"> {
  const options = state.backlog.map((plan) => {
    const parts: string[] = [];

    if (plan.scope) {
      parts.push(`scope: ${plan.scope}`);
    }

    const unmet = unmetDependencies(plan, state.completedSlugs);
    if (unmet.length > 0) {
      const depNames = unmet.map((d) => d.replace(/\.md$/, "")).join(", ");
      parts.push(`waiting on ${depNames}`);
    }

    return {
      value: plan.filename,
      label: plan.filename,
      hint: parts.length > 0 ? parts.join(" · ") : undefined,
    };
  });

  // Add "Back" option at the end
  options.push({
    value: "__back__",
    label: "Back",
    hint: undefined,
  });

  const selected = await clack.select({
    message: "Pick a plan to run:",
    options,
  });

  // Ctrl+C or escape — return to main menu
  if (clack.isCancel(selected)) {
    return "continue";
  }

  if (selected === "__back__") {
    return "continue";
  }

  // Hand off to the runner with the selected plan
  await runRalphai(["run", "--plan", selected as string]);
  return "exit";
}

/**
 * Handle the "Pick from GitHub" action.
 *
 * Fetches labeled issues, builds a combined display list (PRDs with
 * sub-issue context + regular issues), and presents a `clack.select`.
 * Selecting an issue delegates to `runRalphai(["run", String(number)])`.
 * "Back" or Ctrl+C returns to the main menu.
 *
 * Error cases (missing gh, API failure, empty result) are shown with
 * `clack.log.error` and return to the menu.
 *
 * @returns `"continue"` to re-show the main menu, `"exit"` when handing
 *   off to the runner.
 */
export async function handlePickFromGitHub(
  listOptions: ListGithubIssuesOptions,
): Promise<"continue" | "exit"> {
  const result = listGithubIssues(listOptions);

  if (!result.ok) {
    clack.log.error(result.error);
    return "continue";
  }

  if (result.issues.length === 0) {
    clack.log.warning(
      `No issues labeled '${listOptions.issueLabel}' found in ${result.repo}.`,
    );
    return "continue";
  }

  const pickList = buildGithubPickList(result.issues);

  const selected = await clack.select({
    message: `Pick a GitHub issue to run (${result.issues.length} available):`,
    options: pickList.map((item) => ({
      value: item.value,
      label: item.label,
      hint: item.hint,
    })),
  });

  // Ctrl+C or escape — return to main menu
  if (clack.isCancel(selected)) {
    return "continue";
  }

  const value = selected as string;

  if (value === "__back__") {
    return "continue";
  }

  // Sub-issue context lines are non-selectable — if somehow selected, ignore
  if (value.startsWith("__ctx__:")) {
    return "continue";
  }

  // Delegate to the runner with the issue number
  const issueNumber = parseInt(value, 10);
  if (isNaN(issueNumber)) {
    return "continue";
  }

  await runRalphai(["run", String(issueNumber)]);
  return "exit";
}
