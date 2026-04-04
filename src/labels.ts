/**
 * Label derivation module — pure functions for deriving state-suffixed
 * GitHub labels from a base label name.
 *
 * Given a base name like "ralphai-standalone", deriveLabels returns:
 *   { intake: "ralphai-standalone",
 *     inProgress: "ralphai-standalone:in-progress",
 *     done: "ralphai-standalone:done",
 *     stuck: "ralphai-standalone:stuck" }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The four state labels derived from a single base name. */
export interface DerivedLabels {
  /** The intake/triage label (the base name itself). */
  intake: string;
  /** The in-progress state label. */
  inProgress: string;
  /** The done state label. */
  done: string;
  /** The stuck state label. */
  stuck: string;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive the four state labels from a base label name.
 *
 * The intake label is the base name itself. State suffixes are appended
 * with a colon separator: `:in-progress`, `:done`, `:stuck`.
 */
export function deriveLabels(baseName: string): DerivedLabels {
  return {
    intake: baseName,
    inProgress: `${baseName}:in-progress`,
    done: `${baseName}:done`,
    stuck: `${baseName}:stuck`,
  };
}
