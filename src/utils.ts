// ANSI color constants used by ralphai output
// Respect NO_COLOR (https://no-color.org/) and --no-color flag
const useColor = !process.env.NO_COLOR && !process.argv.includes("--no-color");
export const RESET = useColor ? "\x1b[0m" : "";
export const BOLD = useColor ? "\x1b[1m" : "";
/** Darker gray for secondary text (256-color). */
export const DIM = useColor ? "\x1b[38;5;102m" : "";
/** Lighter gray for primary text (256-color). */
export const TEXT = useColor ? "\x1b[38;5;145m" : "";

/**
 * Compare two semver version strings (major.minor.patch).
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
