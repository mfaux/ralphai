/**
 * PRD discovery I/O module: fetches a GitHub issue, checks for the
 * `ralphai-prd` label, and if present, calls the sub-issue parser to
 * extract work items.
 *
 * Returns a discriminated union:
 * - `{ isPrd: true, prd, subIssues }` — issue is a PRD with sub-issues
 * - `{ isPrd: true, prd, subIssues: [], allCompleted: true }` — all checked
 * - `{ isPrd: true, prd, subIssues: [], allCompleted: false }` — no task list, fallback
 * - `{ isPrd: false, issue }` — not a PRD, standalone issue
 */
import { execSync } from "child_process";

import { PRD_LABEL, checkGhAvailable } from "./issues.ts";
import { parseSubIssues, hasCheckedSubIssues } from "./prd-sub-issue-parser.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured result when the issue IS a PRD. */
export interface PrdDiscoveryResultPrd {
  isPrd: true;
  prd: { number: number; title: string };
  /** Unchecked sub-issue numbers (in body order). */
  subIssues: number[];
  /** True when there are checked items but no unchecked ones. */
  allCompleted: boolean;
  /** The raw PRD body (used for fallback: body-as-plan). */
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
 * - If the issue has the `ralphai-prd` label, parses the body for
 *   sub-issues and returns a PRD result.
 * - If the issue does NOT have the label, returns a non-PRD result
 *   with the issue's number, title, and body.
 *
 * Throws a descriptive error if:
 * - `gh` CLI is not available or not authenticated
 * - the issue is not found or inaccessible
 * - the response cannot be parsed
 */
export function discoverPrdTarget(
  repo: string,
  issueNumber: number,
  cwd: string,
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

  const hasLabel = data.labels.some((l) => l.name === PRD_LABEL);

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

  // It's a PRD — parse sub-issues from the body
  const subIssues = parseSubIssues(data.body);
  const allCompleted = subIssues.length === 0 && hasCheckedSubIssues(data.body);

  return {
    isPrd: true,
    prd: { number: issueNumber, title: data.title },
    subIssues,
    allCompleted,
    body: data.body ?? "",
  };
}
