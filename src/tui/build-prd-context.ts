/**
 * PRD context builder for the TUI confirmation screen.
 *
 * Provides a pure helper for computing the sub-issue position string.
 *
 * Pure helpers are exported for unit testing:
 * - `buildPrdPosition` — computes "N of M remaining" from sub-issue data
 */

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
