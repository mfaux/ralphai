/**
 * Color support detection and configuration for the TUI.
 *
 * Ink uses chalk internally for all text styling (`<Text bold>`,
 * `<Text color="cyan">`, `<Text dimColor>`, etc.). Chalk's vendored
 * `supports-color` already checks the `--no-color` CLI flag, but
 * does NOT check the `NO_COLOR` environment variable
 * (https://no-color.org/). This module bridges that gap.
 *
 * Call `applyNoColorOverride()` before mounting the Ink app to ensure
 * the `NO_COLOR` env var disables all ANSI color output in the TUI.
 *
 * Pure helpers are exported for unit testing:
 * - `shouldDisableColor` — checks env + CLI args for color disable signals
 */

import chalk from "chalk";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Determine whether color should be disabled based on environment
 * variables and CLI flags.
 *
 * Returns `true` when:
 * - `NO_COLOR` env var is set (any value, per https://no-color.org/)
 * - `--no-color` is in the process argv
 *
 * The `--no-color` flag is already handled by chalk's `supports-color`,
 * but we include it here for completeness and to make the function
 * a single source of truth for "should TUI colors be off?"
 *
 * Parameters allow dependency injection for testing.
 */
export function shouldDisableColor(
  env: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  // NO_COLOR spec: command-line software which outputs text with ANSI
  // color added should check for the presence of a NO_COLOR environment
  // variable that, when present (regardless of value), prevents
  // ANSI color escape codes from being output.
  if ("NO_COLOR" in env) {
    return true;
  }

  // --no-color flag (belt-and-suspenders — chalk's supports-color
  // already handles this, but we check it explicitly so the function
  // is a complete predicate).
  if (argv.includes("--no-color")) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * Apply the NO_COLOR override to chalk before Ink mounts.
 *
 * When `NO_COLOR` is set or `--no-color` is passed, this sets
 * `chalk.level = 0`, which disables all ANSI color/style codes
 * (including bold, dim, underline, etc.) for the Ink rendering tree.
 *
 * Returns the previous chalk level so it can be restored if needed
 * (e.g. in tests).
 */
export function applyNoColorOverride(
  env?: Record<string, string | undefined>,
  argv?: readonly string[],
): 0 | 1 | 2 | 3 {
  const previousLevel = chalk.level;

  if (shouldDisableColor(env, argv)) {
    chalk.level = 0;
  }

  return previousLevel;
}
