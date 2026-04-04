/**
 * PRD discovery I/O module: fetches a GitHub issue, checks for the
 * `ralphai-prd` label, and if present, calls the sub-issues REST API
 * to discover work items.
 *
 * Returns a discriminated union:
 * - `{ isPrd: true, prd, subIssues, subIssueDetails }` — PRD with open sub-issues
 * - `{ isPrd: true, prd, subIssues: [], allCompleted: true }` — all closed
 * - `{ isPrd: true, prd, subIssues: [], allCompleted: false }` — no sub-issues
 * - `{ isPrd: false, issue }` — not a PRD, standalone issue
 */
import { execSync } from "child_process";

import { checkGhAvailable } from "./issues.ts";
import { DEFAULTS } from "./config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A sub-issue object returned by the REST API. */
export interface PrdSubIssue {
  number: number;
  title: string;
  state: string;
  node_id: string;
}

/** Structured result when the issue IS a PRD. */
export interface PrdDiscoveryResultPrd {
  isPrd: true;
  prd: { number: number; title: string };
  /** Open sub-issue numbers (for backward compatibility). */
  subIssues: number[];
  /** Full sub-issue objects for open sub-issues. */
  subIssueDetails: PrdSubIssue[];
  /** True when all sub-issues are closed. */
  allCompleted: boolean;
  /** The raw PRD body. */
  body: string;
}

/** Structured result when the issue is NOT a PRD. */
export interface PrdDiscoveryResultIssue {
  isPrd: false;
  issue: { number: number; title: string; body: string };
}

export type PrdDiscoveryResult =
  | PrdDiscoveryResultPrd
  | PrdDiscoveryResultIssue;

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

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Fetch a GitHub issue by number and determine whether it is a PRD.
 *
 * - If the issue has the `ralphai-prd` label, fetches sub-issues via
 *   the REST API and returns a PRD result.
 * - If the issue does NOT have the label, returns a non-PRD result
 *   with the issue's number, title, and body.
 *
 * Throws a descriptive error if:
 * - `gh` CLI is not available or not authenticated
 * - the issue is not found or inaccessible
 * - the response cannot be parsed
 * - the sub-issues API call fails
 */
export function discoverPrdTarget(
  repo: string,
  issueNumber: number,
  cwd: string,
  prdLabel?: string,
): PrdDiscoveryResult {
  if (!checkGhAvailable()) {
    throw new Error(
      "gh CLI not available or not authenticated — cannot fetch issue",
    );
  }

  const raw = execQuiet(
    `gh issue view ${issueNumber} --repo "${repo}" --json title,body,labels`,
    cwd,
  );

  if (!raw) {
    throw new Error(
      `Could not fetch issue #${issueNumber} from ${repo}. ` +
        `Check that the issue exists and you have access.`,
    );
  }

  let data: { title: string; body: string; labels: Array<{ name: string }> };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse response for issue #${issueNumber} from ${repo}`,
    );
  }

  const hasLabel = data.labels.some(
    (l) => l.name === (prdLabel ?? DEFAULTS.prdLabel),
  );

  if (!hasLabel) {
    return {
      isPrd: false,
      issue: {
        number: issueNumber,
        title: data.title,
        body: data.body ?? "",
      },
    };
  }

  // It's a PRD — fetch sub-issues via the REST API
  const subIssuesRaw = execQuiet(
    `gh api repos/${repo}/issues/${issueNumber}/sub_issues`,
    cwd,
  );

  if (subIssuesRaw === null) {
    throw new Error(
      `Failed to fetch sub-issues for PRD #${issueNumber} from ${repo}. ` +
        `This may be a rate limit, auth failure, or network issue. ` +
        `Run "gh api repos/${repo}/issues/${issueNumber}/sub_issues" manually to diagnose.`,
    );
  }

  let allSubIssues: Array<{
    number: number;
    title: string;
    state: string;
    node_id: string;
  }>;
  try {
    allSubIssues = JSON.parse(subIssuesRaw);
  } catch {
    throw new Error(
      `Failed to parse sub-issues response for PRD #${issueNumber} from ${repo}`,
    );
  }

  if (!Array.isArray(allSubIssues)) {
    throw new Error(
      `Unexpected sub-issues response for PRD #${issueNumber} from ${repo} — expected an array`,
    );
  }

  const openSubIssues: PrdSubIssue[] = allSubIssues
    .filter((si) => si.state === "open")
    .map((si) => ({
      number: si.number,
      title: si.title,
      state: si.state,
      node_id: si.node_id,
    }));

  const allCompleted = allSubIssues.length > 0 && openSubIssues.length === 0;

  return {
    isPrd: true,
    prd: { number: issueNumber, title: data.title },
    subIssues: openSubIssues.map((si) => si.number),
    subIssueDetails: openSubIssues,
    allCompleted,
    body: data.body ?? "",
  };
}
