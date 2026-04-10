/**
 * Progress extraction: extracts `<progress>` blocks from agent output
 * and appends them to the global progress file.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

/**
 * Extract the first `<progress>...</progress>` block from agent output.
 * Returns the content between the tags, or null if not found.
 */
export function extractProgressBlock(text: string): string | null {
  const startTag = "<progress>";
  const endTag = "</progress>";

  const startIdx = text.indexOf(startTag);
  if (startIdx === -1) return null;

  const endIdx = text.indexOf(endTag, startIdx);
  if (endIdx === -1) return null;

  const content = text.slice(startIdx + startTag.length, endIdx).trim();
  return content.length > 0 ? content : null;
}

// ---------------------------------------------------------------------------
// Append to progress file
// ---------------------------------------------------------------------------

/**
 * Append extracted progress content to the global progress file with an
 * iteration header. No-op if content is null.
 *
 * Format appended:
 * ```
 * ### Iteration N
 * <content>
 * ```
 */
export function appendProgressBlock(
  progressFile: string,
  iterationNumber: number,
  content: string,
): void {
  const block = `\n### Iteration ${iterationNumber}\n${content}\n`;

  if (existsSync(progressFile)) {
    const existing = readFileSync(progressFile, "utf-8");
    writeFileSync(progressFile, existing + block, "utf-8");
  } else {
    writeFileSync(progressFile, `## Progress Log\n${block}`, "utf-8");
  }
}
