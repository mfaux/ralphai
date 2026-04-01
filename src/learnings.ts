/**
 * Learnings parser and formatter: extracts `<learnings>` blocks from agent
 * output and provides pure functions for parsing, prompt formatting, and
 * PR-body formatting.
 *
 * This module has NO filesystem dependencies — all functions are pure.
 */
import { stripAnsi } from "./utils.ts";

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the first `<learnings>...</learnings>` block from agent output.
 * Returns the content between the tags, or null if not found.
 * Strips ANSI escape codes so terminal colors don't leak into PR bodies.
 */
export function extractLearningsBlock(text: string): string | null {
  const startTag = "<learnings>";
  const endTag = "</learnings>";

  const startIdx = text.indexOf(startTag);
  if (startIdx === -1) return null;

  const endIdx = text.indexOf(endTag, startIdx);
  if (endIdx === -1) return null;

  const content = stripAnsi(
    text.slice(startIdx + startTag.length, endIdx),
  ).trim();
  return content.length > 0 ? content : null;
}

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
