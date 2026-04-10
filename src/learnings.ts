/**
 * Learnings parser and formatter: provides pure functions for parsing,
 * prompt formatting, and PR-body formatting of learnings content.
 *
 * This module has NO filesystem dependencies — all functions are pure.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the content of a `<learnings>` block into either a prose string or
 * null. Returns null if the content is the literal string "none"
 * (case-insensitive), only whitespace, or empty. Otherwise returns the
 * trimmed prose text.
 */
export function parseLearningContent(block: string): string | null {
  const trimmed = block.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.toLowerCase() === "none") return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format accumulated learnings for injection into the agent prompt.
 * Returns a formatted context string with advisory framing when the list
 * is non-empty; returns empty string when the list is empty.
 */
export function formatLearningsForPrompt(learnings: string[]): string {
  if (learnings.length === 0) return "";

  const items = learnings.map((l) => `- ${l}`).join("\n");
  return [
    "## Learnings from previous iterations",
    "",
    "Treat these as guidance, not ground truth. They reflect past mistakes",
    "and lessons — apply them when relevant, but verify before assuming",
    "they still hold.",
    "",
    items,
  ].join("\n");
}

/**
 * Format accumulated learnings as a `## Learnings` Markdown section for
 * the PR body. Each entry is rendered as a bullet point.
 * Returns empty string when the list is empty.
 */
export function formatLearningsForPr(learnings: string[]): string {
  if (learnings.length === 0) return "";

  const items = learnings.map((l) => `- ${l}`).join("\n");
  return `## Learnings\n\n${items}`;
}
