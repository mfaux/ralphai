/**
 * Target detection: classifies the positional argument to `ralphai run`
 * into a discriminated union of issue number, plan path, or auto-detect.
 *
 * This module has NO I/O dependencies -- all functions are pure.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunTarget =
  | { type: "issue"; number: number }
  | { type: "plan"; path: string }
  | { type: "auto" };

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Matches a positive integer (one or more digits, no leading sign). */
const POSITIVE_INTEGER_RE = /^\d+$/;

/**
 * Classify a positional target argument into a `RunTarget`.
 *
 * Detection rules (from PRD #203 -- Target Detection):
 * - `undefined` or absent argument -> `{ type: 'auto' }`
 * - Positive integer (regex `^\d+$`) -> `{ type: 'issue', number: N }`
 * - Ends with `.md` or contains a path separator (`/` or `\`) ->
 *   `{ type: 'plan', path: string }`
 * - Anything else -> throws with an actionable error message.
 *
 * Edge cases:
 * - `"0"` is accepted as issue number 0 (GitHub rejects it, but detection
 *   is not responsible for validation against the API).
 * - Leading zeros like `"042"` are parsed as decimal 42.
 * - Empty string `""` is an error -- it is not equivalent to `undefined`.
 */
export function detectRunTarget(arg: string | undefined): RunTarget {
  if (arg === undefined) {
    return { type: "auto" };
  }

  // Issue number: string of digits only (e.g. "42", "007").
  if (POSITIVE_INTEGER_RE.test(arg)) {
    return { type: "issue", number: Number.parseInt(arg, 10) };
  }

  // Plan file: ends with .md or contains a path separator.
  if (arg.endsWith(".md") || arg.includes("/") || arg.includes("\\")) {
    return { type: "plan", path: arg };
  }

  // Unrecognised target -- provide an actionable error.
  throw new Error(
    `Invalid run target "${arg}". Expected an issue number (e.g. 42), ` +
      `a plan path ending in .md (e.g. backlog/my-feature.md), or omit ` +
      `the argument for auto-detection.`,
  );
}
