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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RestoreIssueLabelsOptions {
  /** Path to the plan .md file (must still exist on disk). */
  planPath: string;
  /** The intake label to restore (e.g. "ralphai"). */
  issueLabel: string;
  /** The in-progress label to remove (e.g. "ralphai:in-progress"). */
  issueInProgressLabel: string;
  /** The stuck label to remove (e.g. "ralphai:stuck"). */
  issueStuckLabel: string;
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

function execQuiet(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

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
  const {
    planPath,
    issueLabel,
    issueInProgressLabel,
    issueStuckLabel,
    issueRepo,
    cwd,
  } = options;

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

  // Reverse the label transition: remove in-progress and stuck, add intake
  const cmd =
    `gh issue edit ${fm.issue} --repo "${repo}" ` +
    `--add-label "${issueLabel}" --remove-label "${issueInProgressLabel}" --remove-label "${issueStuckLabel}"`;

  const result = execQuiet(cmd, cwd);
  if (result === null) {
    return {
      restored: false,
      message: `Label restoration failed for issue #${fm.issue}`,
    };
  }

  return {
    restored: true,
    message: `Restored labels on issue #${fm.issue} (${repo})`,
  };
}
