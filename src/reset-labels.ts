/**
 * Label restoration for GitHub issues when plans are reset.
 *
 * When a plan sourced from a GitHub issue is moved back to the backlog
 * (via `ralphai reset` or the interactive menu), the in-progress label
 * should be removed and the intake label restored — returning the issue
 * to the pickup queue.
 *
 * This is the reverse of the intake → in-progress transition performed
 * in issues.ts when an issue is pulled into the pipeline.
 */
import { execSync } from "child_process";
import { extractIssueFrontmatter } from "./frontmatter.ts";
import { transitionReset } from "./label-lifecycle.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RestoreIssueLabelsOptions {
  /** Path to the plan .md file (must still exist on disk). */
  planPath: string;
  /** The intake label to restore (e.g. "ralphai-standalone"). */
  standaloneLabel: string;
  /** The in-progress label to remove (e.g. "ralphai-standalone:in-progress"). */
  standaloneInProgressLabel: string;
  /** The stuck label to remove (e.g. "ralphai-standalone:stuck"). */
  standaloneStuckLabel: string;
  /** Sub-issue intake label (e.g. "ralphai-subissue"). */
  subissueLabel?: string;
  /** Sub-issue in-progress label (e.g. "ralphai-subissue:in-progress"). */
  subissueInProgressLabel?: string;
  /** Sub-issue stuck label (e.g. "ralphai-subissue:stuck"). */
  subissueStuckLabel?: string;
  /** Configured issue repo (owner/repo), or "" to auto-detect from issue-url. */
  issueRepo: string;
  /** Working directory for gh CLI calls. */
  cwd: string;
}

export interface RestoreIssueLabelsResult {
  restored: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the `gh` CLI is installed and authenticated.
 * Duplicated from issues.ts to keep this module self-contained for
 * testability (mock.module scope).
 */
function isGhAvailable(): boolean {
  try {
    execSync("gh --version", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return false;
  }
  try {
    execSync("gh auth status", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return false;
  }
  return true;
}

/**
 * Extract owner/repo from an issue URL.
 * e.g. "https://github.com/acme/widgets/issues/42" → "acme/widgets"
 */
function repoFromUrl(issueUrl: string): string | null {
  const m = issueUrl.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\//);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Restore the intake label on a GitHub issue when its plan is reset.
 *
 * Reads frontmatter from the plan file. If the plan is GitHub-sourced
 * (`source: github` with an issue number), calls `gh issue edit` to
 * remove the in-progress label and add the intake label.
 *
 * Best-effort: failures are reported in the result but never thrown.
 */
export function restoreIssueLabels(
  options: RestoreIssueLabelsOptions,
): RestoreIssueLabelsResult {
  const { planPath, issueRepo, cwd } = options;

  // Read frontmatter to check if this is a GitHub-sourced plan
  const fm = extractIssueFrontmatter(planPath);

  if (fm.source !== "github" || !fm.issue) {
    return { restored: false, message: "not a GitHub-sourced plan" };
  }

  // Choose the correct label family: sub-issues (prd present in frontmatter)
  // use subissue labels when available, standalone issues use standalone labels.
  const isSubIssue = fm.prd !== undefined;
  const issueLabel =
    isSubIssue && options.subissueLabel
      ? options.subissueLabel
      : options.standaloneLabel;
  const issueInProgressLabel =
    isSubIssue && options.subissueInProgressLabel
      ? options.subissueInProgressLabel
      : options.standaloneInProgressLabel;
  const issueStuckLabel =
    isSubIssue && options.subissueStuckLabel
      ? options.subissueStuckLabel
      : options.standaloneStuckLabel;

  // Check gh CLI availability
  if (!isGhAvailable()) {
    return {
      restored: false,
      message: "gh CLI not available — cannot restore issue labels",
    };
  }

  // Determine repo: prefer config, fall back to issue-url, then git remote
  let repo = issueRepo || null;
  if (!repo && fm.issueUrl) {
    repo = repoFromUrl(fm.issueUrl);
  }
  if (!repo) {
    return {
      restored: false,
      message: `Could not determine repo for issue #${fm.issue}`,
    };
  }

  // Reverse the label transition: remove in-progress and stuck, add intake.
  // For sub-issues, also defensively remove standalone state labels in case
  // the wrong family was applied (the pullGithubIssueByNumber bug).
  // gh issue edit --remove-label is a no-op for labels that aren't present.
  const extraRemoveLabels: string[] = [];
  if (isSubIssue && options.subissueLabel) {
    // We're resetting a sub-issue with subissue labels — also remove
    // any standalone state labels that may have been erroneously applied.
    extraRemoveLabels.push(options.standaloneInProgressLabel);
    extraRemoveLabels.push(options.standaloneStuckLabel);
  }

  const transitionResult = transitionReset(
    { number: fm.issue, repo },
    issueLabel,
    issueInProgressLabel,
    issueStuckLabel,
    cwd,
    false,
    extraRemoveLabels,
  );

  return {
    restored: transitionResult.ok,
    message: transitionResult.message,
  };
}
