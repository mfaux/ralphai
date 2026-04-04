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
 * Validation catches misconfigurations early with skip-with-warning:
 * - standalone + has parent PRD → skip
 * - subissue + no parent PRD → skip
 * - subissue + parent lacks ralphai-prd label → skip
 */

import { deriveLabels } from "./labels.ts";

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
 * Matches against the intake and in-progress state for each family.
 * The old unified `ralphai` label is NOT recognized (hard cutover).
 */
export function classifyIssue(
  issueLabels: string[],
  config: LabelConfig,
): DispatchResult {
  const standaloneLabels = deriveLabels(config.standaloneLabel);
  const subissueLabels = deriveLabels(config.subissueLabel);
  const prdLabels = deriveLabels(config.prdLabel);

  // Check standalone family (intake or in-progress)
  if (
    issueLabels.includes(standaloneLabels.intake) ||
    issueLabels.includes(standaloneLabels.inProgress)
  ) {
    return { ok: true, family: "standalone" };
  }

  // Check subissue family (intake or in-progress)
  if (
    issueLabels.includes(subissueLabels.intake) ||
    issueLabels.includes(subissueLabels.inProgress)
  ) {
    return { ok: true, family: "subissue" };
  }

  // Check PRD family (intake or in-progress)
  if (
    issueLabels.includes(prdLabels.intake) ||
    issueLabels.includes(prdLabels.inProgress)
  ) {
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
