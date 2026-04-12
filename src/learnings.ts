/**
 * Formatting-only module: pure functions for prompt and PR-body formatting
 * of accumulated learnings and session context.
 *
 * Extraction and parsing logic lives in `src/runner.ts` (which owns the
 * agent output processing pipeline).
 *
 * This module is intentionally formatting-only — parsing and extraction
 * live in the runner (src/runner.ts) where the agent output is processed.
 */

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

// ---------------------------------------------------------------------------
// Context formatting
// ---------------------------------------------------------------------------

/**
 * Format context notes from previous iterations for injection into the
 * agent prompt. Returns a formatted section with advisory framing when the
 * list is non-empty; returns empty string when the list is empty.
 */
export function formatContextForPrompt(context: string[]): string {
  if (context.length === 0) return "";

  const items = context.map((c) => `- ${c}`).join("\n");
  return [
    "## Context from previous iterations",
    "",
    "These notes describe decisions, state, and intent from earlier work on",
    "this plan. Use them to stay aligned with prior progress, but verify",
    "details against the actual codebase — things may have changed.",
    "",
    items,
  ].join("\n");
}

/**
 * Format context notes as a collapsible `<details>` Markdown block for the
 * PR body. Each entry is rendered as a bullet point inside the collapsed
 * section. The collapsed format keeps session notes available for debugging
 * without cluttering the PR description.
 * Returns empty string when the list is empty.
 */
export function formatContextForPr(context: string[]): string {
  if (context.length === 0) return "";

  const items = context.map((c) => `- ${c}`).join("\n");
  return `<details><summary>Session context</summary>\n\n${items}\n\n</details>`;
}
