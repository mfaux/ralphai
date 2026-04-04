/**
 * GitHub issue listing for the interactive "Pick from GitHub" menu action.
 *
 * Fetches open issues labeled with the configured label and/or `ralphai-prd`,
 * classifies them as regular issues vs PRDs, and builds a combined display
 * list for the `clack.select` picker.
 *
 * Sub-issues for PRDs are fetched via the REST API
 * (`repos/{owner}/{repo}/issues/{N}/sub_issues`) rather than body parsing.
 *
 * This module is intentionally separate from `src/issues.ts` (which handles
 * pull/peek operations for the runner) to keep both files under the 300-line
 * size limit.
 */

import { execSync } from "child_process";
import { checkGhAvailable, detectIssueRepo } from "../issues.ts";
import { DEFAULTS } from "../config.ts";
import type { PrdSubIssue } from "../prd-discovery.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single GitHub issue returned by listGithubIssues. */
export interface GithubIssueListItem {
  number: number;
  title: string;
  labels: string[];
  /** True when the issue has the `ralphai-prd` label. */
  isPrd: boolean;
  /** Open sub-issue numbers (only populated for PRDs). */
  subIssues: number[];
  /** Full sub-issue objects from the REST API (only populated for PRDs). */
  subIssueDetails: PrdSubIssue[];
}

/** Options for fetching the issue list. */
export interface ListGithubIssuesOptions {
  cwd: string;
  standaloneLabel: string;
  issueRepo: string;
  issuePrdLabel?: string;
}

/** Successful result with issues. */
interface ListSuccess {
  ok: true;
  issues: GithubIssueListItem[];
  repo: string;
}

/** Error result with a user-facing message. */
interface ListError {
  ok: false;
  error: string;
}

export type ListGithubIssuesResult = ListSuccess | ListError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command and return trimmed stdout, or null on any error. */
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
 * Fetch open sub-issues for a PRD via the REST API.
 *
 * Fail-open: returns an empty array if the API call fails, the response
 * is not valid JSON, or the response is not an array. This keeps the
 * picker functional even when the sub-issues endpoint is unavailable.
 */
function fetchSubIssuesForPrd(
  repo: string,
  issueNumber: number,
  cwd: string,
): PrdSubIssue[] {
  const raw = execQuiet(
    `gh api repos/${repo}/issues/${issueNumber}/sub_issues`,
    cwd,
  );

  if (raw === null) return [];

  let allSubIssues: Array<{
    number: number;
    title: string;
    state: string;
    node_id: string;
  }>;
  try {
    allSubIssues = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(allSubIssues)) return [];

  return allSubIssues
    .filter((si) => si.state === "open")
    .map((si) => ({
      number: si.number,
      title: si.title,
      state: si.state,
      node_id: si.node_id,
    }));
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Fetch open GitHub issues for the interactive picker.
 *
 * Fetches issues with the configured label AND issues with the `ralphai-prd`
 * label in a single `gh` call (using comma-separated labels would AND them,
 * so we make two calls and deduplicate by issue number).
 *
 * For PRD issues, fetches sub-issues via the REST API
 * (`repos/{owner}/{repo}/issues/{N}/sub_issues`).
 */
export function listGithubIssues(
  options: ListGithubIssuesOptions,
): ListGithubIssuesResult {
  const { cwd, standaloneLabel: issueLabel, issueRepo } = options;
  const prdLabel = options.issuePrdLabel ?? DEFAULTS.prdLabel;

  if (!checkGhAvailable()) {
    return {
      ok: false,
      error:
        "gh CLI not available or not authenticated.\n" +
        "Install it from https://cli.github.com/ and run: gh auth login",
    };
  }

  const repo = detectIssueRepo(cwd, issueRepo);
  if (!repo) {
    return {
      ok: false,
      error:
        "Could not detect GitHub repo from git remote.\n" +
        "Set issueRepo in config or ensure a remote is configured.",
    };
  }

  // Fetch regular issues (with the configured label)
  const regularRaw = execQuiet(
    `gh issue list --repo "${repo}" --label "${issueLabel}" --state open ` +
      `--limit 100 --json number,title,labels`,
    cwd,
  );

  // Fetch PRD issues (with the configured PRD label)
  const prdRaw = execQuiet(
    `gh issue list --repo "${repo}" --label "${prdLabel}" --state open ` +
      `--limit 100 --json number,title,labels`,
    cwd,
  );

  if (regularRaw === null && prdRaw === null) {
    return {
      ok: false,
      error:
        `Could not fetch issues from ${repo}.\n` +
        "Check your network connection, authentication, and rate limits.",
    };
  }

  // Parse and merge, deduplicating by issue number
  const seen = new Map<number, GithubIssueListItem>();

  for (const raw of [regularRaw, prdRaw]) {
    if (!raw) continue;

    let parsed: Array<{
      number: number;
      title: string;
      labels: Array<{ name: string }>;
    }>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    for (const issue of parsed) {
      if (seen.has(issue.number)) continue;

      const labelNames = issue.labels.map((l) => l.name);
      const isPrd = labelNames.includes(prdLabel);

      // For PRDs, fetch sub-issues via the REST API (fail-open: empty on error)
      let subIssueDetails: PrdSubIssue[] = [];
      if (isPrd) {
        subIssueDetails = fetchSubIssuesForPrd(repo, issue.number, cwd);
      }

      seen.set(issue.number, {
        number: issue.number,
        title: issue.title,
        labels: labelNames,
        isPrd,
        subIssues: subIssueDetails.map((si) => si.number),
        subIssueDetails,
      });
    }
  }

  const issues = Array.from(seen.values());

  // Sort: PRDs first, then regular issues, both by issue number ascending
  issues.sort((a, b) => {
    if (a.isPrd !== b.isPrd) return a.isPrd ? -1 : 1;
    return a.number - b.number;
  });

  return { ok: true, issues, repo };
}

// ---------------------------------------------------------------------------
// Display list building
// ---------------------------------------------------------------------------

/** A selectable item in the combined pick list. */
export interface PickListItem {
  /** The value passed to clack.select when this item is chosen. */
  value: string;
  /** Display label (may include ANSI formatting). */
  label: string;
  /** Optional hint shown after the label. */
  hint?: string;
}

/**
 * Build the combined display list for `clack.select`.
 *
 * PRDs appear as selectable items with indented, non-selectable sub-issue
 * context lines below them. Regular issues are simple selectable items.
 * A "Back" option is appended at the end.
 *
 * Display format:
 * ```
 * #10 Auth Redesign [PRD]            2 remaining
 *   ├ #11 Add login endpoint         (next up)
 *   ├ #12 Add signup endpoint
 *   └ #13 Add password reset
 * #14 Fix dashboard bug
 * ```
 *
 * Sub-issue context lines use a separator value prefix (`__ctx__:`) so the
 * handler can distinguish them from real selections. However, clack.select
 * doesn't support non-selectable items natively, so we include sub-issues
 * as separate items with a distinct value prefix.
 *
 * Sub-issue titles are derived from `subIssueDetails` on each issue — no
 * separate title-resolution step is needed.
 */
export function buildGithubPickList(
  issues: GithubIssueListItem[],
): PickListItem[] {
  const items: PickListItem[] = [];

  for (const issue of issues) {
    if (issue.isPrd) {
      // PRD parent — selectable
      const remaining = issue.subIssues.length;
      const hint = remaining > 0 ? `${remaining} remaining` : "no sub-issues";
      items.push({
        value: String(issue.number),
        label: `#${issue.number} ${issue.title} [PRD]`,
        hint,
      });

      // Build a title lookup from subIssueDetails
      const titleByNumber = new Map(
        issue.subIssueDetails.map((si) => [si.number, si.title]),
      );

      // Sub-issue context lines — non-selectable (separator prefix)
      for (let i = 0; i < issue.subIssues.length; i++) {
        const subNum = issue.subIssues[i]!;
        const subTitle = titleByNumber.get(subNum) ?? "";
        const isLast = i === issue.subIssues.length - 1;
        const connector = isLast ? "\u2514" : "\u251C";
        const titleSuffix = subTitle ? ` ${subTitle}` : "";
        const nextUp = i === 0 ? "  (next up)" : "";
        items.push({
          value: `__ctx__:${subNum}`,
          label: `  ${connector} #${subNum}${titleSuffix}${nextUp}`,
        });
      }
    } else {
      // Regular issue — selectable
      items.push({
        value: String(issue.number),
        label: `#${issue.number} ${issue.title}`,
      });
    }
  }

  // "Back" option
  items.push({
    value: "__back__",
    label: "Back",
  });

  return items;
}
