/**
 * Label restoration for GitHub issues when plans are reset.
 *
 * When a plan sourced from a GitHub issue is moved back to the backlog
 * (via `ralphai reset` or the interactive menu), the in-progress and
 * stuck labels should be removed — returning the issue to the pickup
 * queue. The family label stays (it was never removed during pull).
 *
 * This is the reverse of the pull transition performed in issues.ts
 * when an issue is pulled into the pipeline.
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
 * Restore labels on a GitHub issue when its plan is reset.
 *
 * Reads frontmatter from the plan file. If the plan is GitHub-sourced
 * (`source: github` with an issue number), calls `gh issue edit` to
 * remove the in-progress and stuck state labels (shared labels).
 * The family label is left untouched since it was never removed.
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

  // Remove shared state labels (in-progress and stuck).
  // The family label stays — it was never removed during pull.
  const transitionResult = transitionReset({ number: fm.issue, repo }, cwd);

  return {
    restored: transitionResult.ok,
    message: transitionResult.message,
  };
}
