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
