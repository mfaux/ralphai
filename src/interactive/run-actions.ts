/**
 * Run action handlers for the interactive menu.
 *
 * Provides "Run next plan", "Pick from backlog", and "Pick from GitHub"
 * actions. All delegate to `runRalphai(["run", ...])` and signal the
 * menu loop to exit so the runner owns the terminal.
 */

import * as clack from "@clack/prompts";
import type { PipelineState, BacklogPlan } from "../pipeline-state.ts";
import type { ResolvedConfig } from "../config.ts";
import { runRalphai } from "../ralphai.ts";
import {
  listGithubIssues,
  buildGithubPickList,
  type ListGithubIssuesOptions,
} from "./github-issues.ts";
import { runConfigWizard } from "./run-wizard.ts";

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
 *
 * @param githubIssueCount - Number of available GitHub issues (from peek).
 *   When 0, the item is disabled. When >0, the hint includes the count.
 *   When undefined, falls back to a generic "will pull from GitHub" hint.
 */
export function runNextMenuItem(
  state: PipelineState,
  hasGitHubIssues: boolean,
  githubIssueCount?: number,
): { label: string; hint?: string; disabled: boolean } {
  const nextPlan = findNextPlanName(state);

  if (nextPlan) {
    return {
      label: `Run next plan (${nextPlan})`,
      disabled: false,
    };
  }

  // No local plans ready — check GitHub issue availability
  if (hasGitHubIssues) {
    // Count known and zero — disable with explicit message
    if (githubIssueCount === 0) {
      return {
        label: "Run next plan",
        hint: "(no GitHub issues)",
        disabled: true,
      };
    }

    // Count known and positive — show how many are available
    if (githubIssueCount !== undefined && githubIssueCount > 0) {
      return {
        label: "Run next plan",
        hint: `will pull oldest of ${githubIssueCount} from GitHub`,
        disabled: false,
      };
    }

    // Count unknown (peek not yet completed or failed) — generic hint
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

/**
 * Build the label and hint for the "Run with options..." menu item.
 *
 * Always enabled — the wizard handles unavailable targets via disabled
 * options in its own sub-prompt.
 */
export function runWithOptionsMenuItem(): {
  label: string;
  hint?: string;
  disabled: boolean;
} {
  return {
    label: "Run with options...",
    hint: "configure before running",
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
      `No issues labeled '${listOptions.standaloneLabel}' found in ${result.repo}.`,
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

/**
 * Target selection result from the "Run with options..." sub-prompt.
 *
 * `type` indicates which target was chosen:
 * - `"auto-detect"` — use auto-detection (no extra args)
 * - `"backlog"` — a specific backlog plan was selected
 * - `"github"` — a specific GitHub issue was selected
 *
 * `args` contains the CLI args to pass for this target (e.g. `["--plan", "foo.md"]`).
 */
interface TargetSelection {
  type: "auto-detect" | "backlog" | "github";
  args: string[];
}

/**
 * Show the target sub-prompt for "Run with options...".
 *
 * Returns the selected target and args, or `null` if the user cancels.
 */
async function selectTarget(
  state: PipelineState,
  ctx: {
    hasGitHubIssues: boolean;
    githubIssueCount?: number;
    githubConfig?: ListGithubIssuesOptions;
  },
): Promise<TargetSelection | null> {
  // Build sub-prompt options, reusing existing builders for availability/hints
  const autoDetect = runNextMenuItem(
    state,
    ctx.hasGitHubIssues,
    ctx.githubIssueCount,
  );
  const backlog = pickFromBacklogMenuItem(state);
  const github = pickFromGithubMenuItem(ctx);

  const options: {
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
  }[] = [
    {
      value: "auto-detect",
      label: "Auto-detect (next plan)",
      hint: autoDetect.hint,
      disabled: autoDetect.disabled,
    },
    {
      value: "pick-from-backlog",
      label: "Pick from backlog",
      hint: backlog.hint,
      disabled: backlog.disabled,
    },
    {
      value: "pick-from-github",
      label: "Pick from GitHub",
      hint: github.hint,
      disabled: github.disabled,
    },
  ];

  const selected = await clack.select({
    message: "Select a target:",
    options,
  });

  if (clack.isCancel(selected)) {
    return null;
  }

  const action = selected as string;

  if (action === "auto-detect") {
    return { type: "auto-detect", args: [] };
  }

  if (action === "pick-from-backlog") {
    // Delegate to backlog picker sub-list
    const planOptions = state.backlog.map((plan) => {
      const parts: string[] = [];
      if (plan.scope) parts.push(`scope: ${plan.scope}`);
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

    planOptions.push({ value: "__back__", label: "Back", hint: undefined });

    const planSelected = await clack.select({
      message: "Pick a plan to run:",
      options: planOptions,
    });

    if (clack.isCancel(planSelected) || planSelected === "__back__") {
      return null;
    }

    return {
      type: "backlog",
      args: ["--plan", planSelected as string],
    };
  }

  if (action === "pick-from-github") {
    if (!ctx.githubConfig) return null;

    const result = listGithubIssues(ctx.githubConfig);
    if (!result.ok) {
      clack.log.error(result.error);
      return null;
    }
    if (result.issues.length === 0) {
      clack.log.warning(
        `No issues labeled '${ctx.githubConfig.standaloneLabel}' found in ${result.repo}.`,
      );
      return null;
    }

    const pickList = buildGithubPickList(result.issues);
    const issueSelected = await clack.select({
      message: `Pick a GitHub issue to run (${result.issues.length} available):`,
      options: pickList.map((item) => ({
        value: item.value,
        label: item.label,
        hint: item.hint,
      })),
    });

    if (clack.isCancel(issueSelected)) return null;
    const value = issueSelected as string;
    if (value === "__back__" || value.startsWith("__ctx__:")) return null;

    const issueNumber = parseInt(value, 10);
    if (isNaN(issueNumber)) return null;

    return {
      type: "github",
      args: [String(issueNumber)],
    };
  }

  return null;
}

/**
 * Handle the "Run with options..." action.
 *
 * 1. Show target sub-prompt (auto-detect, backlog, GitHub)
 * 2. Show the config wizard
 * 3. Merge wizard flags with target args and launch
 *
 * Returns `"continue"` on any cancellation, `"exit"` after launch.
 */
export async function handleRunWithOptions(
  state: PipelineState,
  ctx: {
    hasGitHubIssues: boolean;
    githubIssueCount?: number;
    githubConfig?: ListGithubIssuesOptions;
    resolvedConfig?: ResolvedConfig;
  },
): Promise<"continue" | "exit"> {
  // --- Step 1: target selection ---
  const target = await selectTarget(state, ctx);
  if (!target) return "continue";

  // --- Step 2: config wizard ---
  if (!ctx.resolvedConfig) {
    // Config not available — skip wizard and launch directly
    await runRalphai(["run", ...target.args]);
    return "exit";
  }

  const wizardFlags = await runConfigWizard(ctx.resolvedConfig);
  if (wizardFlags === null) return "continue";

  // --- Step 3: merge and launch ---
  await runRalphai(["run", ...wizardFlags, ...target.args]);
  return "exit";
}
