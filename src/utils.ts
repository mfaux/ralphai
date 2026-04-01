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
 * Strip ANSI escape sequences (colors, cursor movement, etc.) from a string.
 * Used to sanitize agent output before inserting into PR descriptions.
 */
export function stripAnsi(str: string): string {
  return str.replace(
    /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    "",
  );
}

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
