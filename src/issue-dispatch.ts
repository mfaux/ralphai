/**
 * Issue dispatch module — pure classification and validation for
 * label-driven dispatch in `ralphai run <number>`.
 *
 * Given an issue's labels, determines which dispatch path to take:
 * - `standalone` — create dedicated branch, process as single issue
 * - `subissue`   — discover parent PRD, fold into shared branch
 * - `prd`        — discover sub-issues, process sequentially on shared branch
 * - `none`       — no recognized label, error with guidance
 *
 * With shared state labels, classification only needs to check for family
 * labels (which persist through all states). The `in-progress` label is
 * shared and doesn't affect family classification.
 *
 * Validation catches misconfigurations early with skip-with-warning:
 * - standalone + has parent PRD → skip
 * - subissue + no parent PRD → skip
 * - subissue + parent lacks ralphai-prd label → skip
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three recognized dispatch families. */
export type DispatchFamily = "standalone" | "subissue" | "prd";

/** Successful classification result. */
export interface DispatchClassified {
  ok: true;
  family: DispatchFamily;
}

/** No recognized label found. */
export interface DispatchUnrecognized {
  ok: false;
  reason: "no-label";
  message: string;
}

export type DispatchResult = DispatchClassified | DispatchUnrecognized;

/** Validation passed — proceed with dispatch. */
export interface ValidationPassed {
  valid: true;
}

/** Validation failed — skip with warning. */
export interface ValidationFailed {
  valid: false;
  message: string;
}

export type ValidationResult = ValidationPassed | ValidationFailed;

/** Label configuration for the three families. */
export interface LabelConfig {
  standaloneLabel: string;
  subissueLabel: string;
  prdLabel: string;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify an issue into a dispatch family based on its labels.
 *
 * Checks for family labels only — since family labels persist through
 * all states, an issue with `ralphai-standalone` (with or without
 * `in-progress`, `done`, etc.) is classified as standalone.
 *
 * The old unified `ralphai` label is NOT recognized (hard cutover).
 */
export function classifyIssue(
  issueLabels: string[],
  config: LabelConfig,
): DispatchResult {
  // Check standalone family
  if (issueLabels.includes(config.standaloneLabel)) {
    return { ok: true, family: "standalone" };
  }

  // Check subissue family
  if (issueLabels.includes(config.subissueLabel)) {
    return { ok: true, family: "subissue" };
  }

  // Check PRD family
  if (issueLabels.includes(config.prdLabel)) {
    return { ok: true, family: "prd" };
  }

  // No recognized label
  return {
    ok: false,
    reason: "no-label",
    message:
      `Issue has no recognized ralphai label. ` +
      `Add one of: ${config.standaloneLabel}, ${config.subissueLabel}, or ${config.prdLabel}.`,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a standalone issue before dispatch.
 *
 * Rule: standalone + has parent PRD → skip with warning.
 */
export function validateStandalone(
  issueNumber: number,
  parentPrdNumber: number | undefined,
): ValidationResult {
  if (parentPrdNumber !== undefined) {
    return {
      valid: false,
      message:
        `Skipping issue #${issueNumber}: labeled standalone but has parent PRD #${parentPrdNumber}. ` +
        `Use the subissue label instead, or remove the parent relationship.`,
    };
  }
  return { valid: true };
}

/**
 * Validate a sub-issue before dispatch.
 *
 * Rules:
 * - subissue + no parent PRD → skip with warning
 * - subissue + parent exists but lacks ralphai-prd label → skip with warning
 */
export function validateSubissue(
  issueNumber: number,
  parentPrdNumber: number | undefined,
  parentHasPrdLabel: boolean,
): ValidationResult {
  if (parentPrdNumber === undefined) {
    return {
      valid: false,
      message:
        `Skipping issue #${issueNumber}: labeled as sub-issue but has no parent PRD. ` +
        `Add a parent PRD relationship on GitHub, or use the standalone label instead.`,
    };
  }

  if (!parentHasPrdLabel) {
    return {
      valid: false,
      message:
        `Skipping issue #${issueNumber}: parent issue #${parentPrdNumber} does not have the PRD label. ` +
        `Add the PRD label to #${parentPrdNumber}, or use the standalone label instead.`,
    };
  }

  return { valid: true };
}
