/**
 * Issue naming utilities — pure functions for slugs, branch names,
 * commit-type extraction, and dependency slugs.
 *
 * All functions are side-effect free (no I/O, no network calls).
 */

// ---------------------------------------------------------------------------
// Slugify
// ---------------------------------------------------------------------------

/**
 * Convert a string to a filename-safe lowercase slug (max 60 chars).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Conventional-commit type extraction from titles
// ---------------------------------------------------------------------------

/**
 * Conventional commit types recognised in issue/PRD titles.
 * Same set used by `CC_PATTERN` in `pr-lifecycle.ts`.
 */
const CC_TITLE_PATTERN =
  /^(feat|fix|refactor|test|docs|chore|ci|build|perf|style|revert)(?:\([^)]*\))?!?:\s+(.+)$/i;

/**
 * Strip a leading "PRD:" or "PRD " prefix (case-insensitive) from a title.
 *
 * PRD titles like `"PRD: Add dark mode"` should not leak the "PRD" label
 * into branch names or PR titles.  Stripping it early lets the rest of the
 * pipeline treat them like any other title.
 */
function stripPrdPrefix(title: string): string {
  return title.replace(/^prd[:\s]+/i, "").trim();
}

/**
 * Extract the conventional-commit type and remaining description from a title.
 *
 * If the title starts with a recognised prefix (e.g. `"fix: broken login"`),
 * returns `{ type: "fix", description: "broken login" }`.
 * Otherwise defaults to `{ type: "feat", description: <original title> }`.
 *
 * A leading `"PRD:"` label is stripped before matching so that PRD titles
 * like `"PRD: Add dark mode"` produce `feat/add-dark-mode` instead of
 * `feat/prd-add-dark-mode`.
 */
export function commitTypeFromTitle(title: string): {
  type: string;
  description: string;
} {
  const cleaned = stripPrdPrefix(title);
  const m = cleaned.match(CC_TITLE_PATTERN);
  if (m) {
    return { type: m[1]!.toLowerCase(), description: m[2]!.trim() };
  }
  return { type: "feat", description: cleaned };
}

// ---------------------------------------------------------------------------
// Branch names
// ---------------------------------------------------------------------------

/**
 * Derive a branch name from an issue or PRD title.
 *
 * If the title starts with a conventional-commit prefix (e.g. `"fix: broken
 * login"`), the branch uses that type: `fix/broken-login`.
 * Otherwise defaults to `feat/<slugified-title>`.
 */
export function issueBranchName(title: string): string {
  const { type, description } = commitTypeFromTitle(title);
  return `${type}/${slugify(description)}`;
}

// ---------------------------------------------------------------------------
// Dependency slugs
// ---------------------------------------------------------------------------

/**
 * Generate a dependency slug for a GitHub issue number.
 * The slug follows the pattern `gh-{N}` and is used in `depends-on`
 * frontmatter to reference the plan file for that issue.
 */
export function issueDepSlug(issueNumber: number): string {
  return `gh-${issueNumber}`;
}
