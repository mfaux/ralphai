/**
 * Formatting helpers for the dashboard.
 */

/**
 * Truncate a slug at the last `-` boundary before `maxLen`, appending `…`.
 * If the slug fits within `maxLen`, it is returned unchanged.
 * If there is no `-` in the truncatable portion, hard-truncates at `maxLen - 1`.
 */
export function truncateSlug(slug: string, maxLen: number): string {
  if (slug.length <= maxLen) return slug;

  const truncatable = slug.slice(0, maxLen);
  const lastDash = truncatable.lastIndexOf("-");

  if (lastDash > 0) {
    return slug.slice(0, lastDash) + "\u2026";
  }

  return slug.slice(0, maxLen - 1) + "\u2026";
}

/**
 * Word-wrap a single line to fit within `width` columns.
 * Splits at the last space before the limit. If a single word exceeds
 * `width`, it is hard-broken at the boundary.
 * Returns an array of wrapped sub-lines.
 */
function wrapLine(line: string, width: number): string[] {
  if (width < 1) return [line];
  if (line.length <= width) return [line];

  const result: string[] = [];
  let remaining = line;

  while (remaining.length > width) {
    // Look for the last space within the allowed width
    let breakAt = remaining.lastIndexOf(" ", width);
    if (breakAt <= 0) {
      // No space found — hard-break at width
      breakAt = width;
    }
    result.push(remaining.slice(0, breakAt));
    // Skip the space if we broke at one; otherwise keep position
    remaining = remaining.slice(breakAt).replace(/^ /, "");
  }

  if (remaining.length > 0) {
    result.push(remaining);
  }

  return result;
}

/**
 * Word-wrap text content to fit within `width` columns.
 * Respects existing newlines. Each logical line is independently wrapped.
 * Returns a flat array of display lines ready for rendering.
 */
export function wrapText(text: string, width: number): string[] {
  if (width < 1) return text.split("\n");

  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    if (line.length === 0) {
      result.push("");
    } else {
      result.push(...wrapLine(line, width));
    }
  }

  return result;
}
