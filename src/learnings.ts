/**
 * Learnings formatting: pure functions that turn accumulated learnings
 * (string arrays) into Markdown for agent prompts and PR bodies.
 *
 * This module is intentionally formatting-only — parsing and extraction
 * live in the runner (src/runner.ts) where the agent output is processed.
 */

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
