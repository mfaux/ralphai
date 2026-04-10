/**
 * PRD context builder for the TUI confirmation screen.
 *
 * Provides a pure helper for computing the sub-issue position string
 * and an I/O function that fetches PRD data via `discoverPrdTarget()`
 * and returns a `PrdContext` ready for the confirmation screen.
 *
 * Pure helpers are exported for unit testing:
 * - `buildPrdPosition` — computes "N of M remaining" from sub-issue data
 *
 * I/O functions:
 * - `fetchPrdContext` — fetches PRD data and builds a PrdContext
 */

import { discoverPrdTarget } from "../issue-lifecycle.ts";
import type { PrdSubIssue } from "../issue-lifecycle.ts";
import type { PrdContext } from "./screens/confirm.tsx";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Compute the position string for a sub-issue within a PRD.
 *
 * Given the list of open sub-issue numbers and the current sub-issue
 * number, returns a human-readable position like "1 of 3 remaining".
 *
 * When the current sub-issue is not in the list (e.g. it was closed
 * between fetch and display), returns a fallback like "3 remaining"
 * without a position index.
 *
 * @param openSubIssues - Open sub-issue numbers in display order
 * @param currentIssue - The sub-issue being confirmed for a run
 */
export function buildPrdPosition(
  openSubIssues: number[],
  currentIssue: number,
): string {
  const total = openSubIssues.length;
  if (total === 0) return "no remaining sub-issues";

  const index = openSubIssues.indexOf(currentIssue);
  if (index === -1) {
    return `${total} remaining`;
  }

  return `${index + 1} of ${total} remaining`;
}

// ---------------------------------------------------------------------------
// I/O functions
// ---------------------------------------------------------------------------

/**
 * Options for `fetchPrdContext`.
 */
export interface FetchPrdContextOptions {
  /** GitHub repo in "owner/repo" format. */
  repo: string;
  /** PRD issue number (from `prd:` frontmatter). */
  prdNumber: number;
  /** Current sub-issue number being confirmed for a run. */
  currentIssue: number;
  /** Working directory for `gh` commands. */
  cwd: string;
  /** Optional PRD label override (defaults to `ralphai-prd`). */
  prdLabel?: string;
}

/**
 * Fetch PRD data and build a `PrdContext` for the confirmation screen.
 *
 * Calls `discoverPrdTarget()` to fetch the PRD issue and its sub-issues,
 * then computes the position of the current sub-issue.
 *
 * Returns `null` when:
 * - The issue is not actually a PRD (label was removed)
 * - The `discoverPrdTarget()` call throws (network/auth failure)
 *
 * Fail-open: callers should proceed without PRD context when this
 * returns `null`.
 */
export function fetchPrdContext(
  opts: FetchPrdContextOptions,
): PrdContext | null {
  try {
    const result = discoverPrdTarget(
      opts.repo,
      opts.prdNumber,
      opts.cwd,
      opts.prdLabel,
    );

    if (!result.isPrd) return null;

    const position = buildPrdPosition(result.subIssues, opts.currentIssue);

    return {
      prdTitle: result.prd.title,
      position,
    };
  } catch {
    // Fail-open: if PRD discovery fails, proceed without context.
    return null;
  }
}

// ---------------------------------------------------------------------------
// From cached picker data
// ---------------------------------------------------------------------------

/**
 * Build `PrdContext` from cached issue picker data, avoiding a network
 * round-trip when the caller already has PRD sub-issue details.
 *
 * @param prdTitle - Parent PRD title
 * @param openSubIssues - Open sub-issue details from the picker cache
 * @param currentIssue - The sub-issue being confirmed for a run
 */
export function buildPrdContextFromCache(
  prdTitle: string,
  openSubIssues: PrdSubIssue[],
  currentIssue: number,
): PrdContext {
  const position = buildPrdPosition(
    openSubIssues.map((si) => si.number),
    currentIssue,
  );

  return { prdTitle, position };
}
