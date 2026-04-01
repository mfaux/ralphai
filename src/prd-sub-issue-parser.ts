/**
 * PRD sub-issue parser: extracts issue numbers from unchecked task list
 * items in a GitHub issue body string.
 *
 * Supported formats:
 *   - `- [ ] #N`
 *   - `- [ ] https://github.com/owner/repo/issues/N`
 *
 * Checked items (`- [x] #N`) are excluded.
 *
 * This module has NO I/O dependencies — all functions are pure.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Matches an unchecked GitHub task list item that references an issue.
 *
 * Captures either:
 *   Group 1: issue number from `#N` shorthand
 *   Group 2: issue number from a full `https://github.com/.../issues/N` URL
 *
 * The regex requires `- [ ]` (unchecked checkbox) and will not match
 * `- [x]` (checked checkbox). Trailing description text after the
 * issue reference is allowed (e.g. `- [ ] #7 — Fix the bug`).
 */
const UNCHECKED_ISSUE_RE =
  /^- \[ \] (?:#(\d+)|https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+))(?:\s.*)?$/;

/**
 * Matches a checked (`[x]` or `[X]`) GitHub task list item that references
 * an issue.
 */
const CHECKED_ISSUE_RE =
  /^- \[[xX]\] (?:#(\d+)|https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+))(?:\s.*)?$/;

/**
 * Extract issue numbers from unchecked task list items in a GitHub issue
 * body. Returns an array of issue numbers (as numbers), preserving the
 * order they appear in the body.
 *
 * - Checked items (`- [x] ...`) are excluded.
 * - Non-issue task items (e.g. `- [ ] some text`) are ignored.
 * - Empty or undefined input returns an empty array.
 */
export function parseSubIssues(body: string | undefined | null): number[] {
  if (!body) return [];

  const issues: number[] = [];

  for (const line of body.split("\n")) {
    const match = UNCHECKED_ISSUE_RE.exec(line.trimEnd());
    if (!match) continue;

    const raw = match[1] ?? match[2];
    if (!raw) continue;

    issues.push(Number(raw));
  }

  return issues;
}

/**
 * Check whether a body contains any checked (`[x]`) task list items that
 * reference issues. Used to distinguish "PRD with no task list" from
 * "all sub-issues already completed".
 */
export function hasCheckedSubIssues(body: string | undefined | null): boolean {
  if (!body) return false;

  for (const line of body.split("\n")) {
    if (CHECKED_ISSUE_RE.test(line.trimEnd())) {
      return true;
    }
  }

  return false;
}
