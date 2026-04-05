/**
 * Run action menu item builders for the interactive menu.
 *
 * Provides pure helper functions that build menu item descriptors
 * (label, hint, disabled) from pipeline state. No I/O or rendering.
 */

import type { PipelineState, BacklogPlan } from "../pipeline-state.ts";

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
