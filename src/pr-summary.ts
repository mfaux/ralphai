/**
 * PR summary extraction: extracts `<pr-summary>` blocks from agent output.
 *
 * The agent is instructed to include a `<pr-summary>` block when it
 * signals COMPLETE. This provides a human-friendly description for the
 * pull request, written by the agent that did the work.
 *
 * Follows the same extraction pattern as `extractProgressBlock()` in
 * `src/progress.ts` and `extractLearningsBlock()` in `src/learnings.ts`.
 */

/**
 * Extract the first `<pr-summary>...</pr-summary>` block from agent output.
 * Returns the content between the tags, or null if not found.
 */
export function extractPrSummary(text: string): string | null {
  const startTag = "<pr-summary>";
  const endTag = "</pr-summary>";

  const startIdx = text.indexOf(startTag);
  if (startIdx === -1) return null;

  const endIdx = text.indexOf(endTag, startIdx);
  if (endIdx === -1) return null;

  const content = text.slice(startIdx + startTag.length, endIdx).trim();
  return content.length > 0 ? content : null;
}
