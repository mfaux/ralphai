/**
 * HITL (human-in-the-loop) sub-issue helpers for the PRD runner loop.
 *
 * Extracted from `runPrdIssueTarget()` in ralphai.ts to enable unit testing
 * of HITL filtering, dependency blocking, and summary formatting logic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A sub-issue blocked by one or more HITL dependencies. */
export interface BlockedSubIssue {
  number: number;
  blockedBy: number[];
}

/** Data bag for the PRD HITL summary section. */
export interface PrdHitlSummaryInput {
  prdNumber: number;
  totalSubIssues: number;
  completedCount: number;
  stuckSubIssues: number[];
  hitlSubIssues: number[];
  blockedSubIssues: BlockedSubIssue[];
}

// ---------------------------------------------------------------------------
// HITL dependency detection
// ---------------------------------------------------------------------------

/**
 * Given a list of `depends-on` slugs (e.g. `["gh-42", "gh-50"]`) and a set
 * of HITL issue numbers, return the subset that are HITL blockers.
 *
 * Slugs must match the exact pattern `gh-<number>`.
 */
export function findHitlBlockers(
  deps: string[],
  hitlIssueNumbers: Set<number>,
): number[] {
  const blockers: number[] = [];
  for (const dep of deps) {
    const m = dep.match(/^gh-(\d+)$/);
    if (m) {
      const depNum = parseInt(m[1]!, 10);
      if (hitlIssueNumbers.has(depNum)) {
        blockers.push(depNum);
      }
    }
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// Summary formatting
// ---------------------------------------------------------------------------

/**
 * Format the HITL-related lines for the PRD exit summary.
 * Returns an array of lines (without trailing newlines) to be printed.
 *
 * The output follows the existing summary format in `runPrdIssueTarget()`:
 * - "HITL (waiting on human): #3, #5"
 * - "Blocked by HITL: #4 (depends on #3)"
 */
export function formatPrdHitlSummary(input: PrdHitlSummaryInput): string[] {
  const lines: string[] = [];

  lines.push("========================================");
  lines.push(`  PRD #${input.prdNumber} — summary`);
  lines.push("========================================");
  lines.push(
    `Completed: ${input.completedCount}/${input.totalSubIssues} sub-issue(s)`,
  );

  if (input.stuckSubIssues.length > 0) {
    lines.push(
      `Stuck/skipped: ${input.stuckSubIssues.map((n) => `#${n}`).join(", ")}`,
    );
  }

  if (input.hitlSubIssues.length > 0) {
    lines.push(
      `HITL (waiting on human): ${input.hitlSubIssues.map((n) => `#${n}`).join(", ")}`,
    );
  }

  if (input.blockedSubIssues.length > 0) {
    for (const b of input.blockedSubIssues) {
      lines.push(
        `Blocked by HITL: #${b.number} (depends on ${b.blockedBy.map((n) => `#${n}`).join(", ")})`,
      );
    }
  }

  return lines;
}
