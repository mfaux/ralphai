/**
 * Nonce-aware sentinel detection: provides robust detection of agent
 * sentinel tags that cannot be spoofed by tool output (test runners,
 * grep, cat, etc.) containing the same tag strings.
 *
 * Each iteration of the runner loop generates a unique nonce (UUID) that
 * is injected into the agent prompt. The agent must echo this nonce back
 * inside sentinel tags for the pipeline to recognize them. Bare tags
 * without the correct nonce are ignored.
 *
 * Exported functions:
 * - `generateNonce()` — create a per-iteration nonce
 * - `detectCompletion(output, nonce)` — check for nonce-stamped COMPLETE signal
 * - `extractNoncedBlock(output, tagName, nonce)` — extract content from nonce-stamped XML blocks
 */
import { randomUUID } from "crypto";
import { stripAnsi } from "./utils.ts";

/**
 * Generate a unique nonce for a single runner iteration.
 * Uses a cryptographic UUID to ensure unguessability.
 */
export function generateNonce(): string {
  return randomUUID();
}

/**
 * Detect whether the agent output contains a genuine nonce-stamped
 * completion signal: `<promise nonce="NONCE">COMPLETE</promise>`.
 *
 * Returns `false` for bare `<promise>COMPLETE</promise>` tags (which may
 * originate from test output, source files, or other tool noise) and for
 * tags with a mismatched nonce.
 *
 * @param output - Full agent stdout+stderr buffer.
 * @param nonce  - The nonce that was injected into the agent's prompt.
 */
export function detectCompletion(output: string, nonce: string): boolean {
  const sentinel = `<promise nonce="${nonce}">COMPLETE</promise>`;
  return output.includes(sentinel);
}

/**
 * Extract the content of a nonce-stamped XML block from agent output.
 *
 * Looks for `<tagName nonce="NONCE">...content...</tagName>` and returns
 * the trimmed content between the tags, or `null` if no matching block
 * is found.
 *
 * Bare tags (without the nonce attribute) and tags with a mismatched
 * nonce are ignored — they may originate from tool output noise.
 *
 * ANSI escape codes are stripped from the extracted content so terminal
 * colors don't leak into PR descriptions or persisted files.
 *
 * @param output  - Full agent stdout+stderr buffer.
 * @param tagName - The XML tag name (e.g., "learnings", "progress", "pr-summary").
 * @param nonce   - The nonce that was injected into the agent's prompt.
 */
export function extractNoncedBlock(
  output: string,
  tagName: string,
  nonce: string,
): string | null {
  const startTag = `<${tagName} nonce="${nonce}">`;
  const endTag = `</${tagName}>`;

  const startIdx = output.indexOf(startTag);
  if (startIdx === -1) return null;

  const contentStart = startIdx + startTag.length;
  const endIdx = output.indexOf(endTag, contentStart);
  if (endIdx === -1) return null;

  const content = stripAnsi(output.slice(contentStart, endIdx)).trim();
  return content.length > 0 ? content : null;
}
