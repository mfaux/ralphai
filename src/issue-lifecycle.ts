/**
 * Issue lifecycle facade — single entry point for all issue-related operations.
 *
 * Re-exports every public function, type, and constant from the 7 modules
 * that currently own issue logic:
 *
 *   issues.ts, label-lifecycle.ts, labels.ts, issue-dispatch.ts,
 *   prd-discovery.ts, prd-hitl.ts, reset-labels.ts
 *
 * Callers still import from the old modules — this facade exists so that
 * future slices can migrate callers one at a time to the unified path.
 */

// ---------------------------------------------------------------------------
// issues.ts — GitHub issue pulling, slug generation, label fetching
// ---------------------------------------------------------------------------
export {
  checkGhAvailable,
  detectIssueRepo,
  slugify,
  commitTypeFromTitle,
  fetchBlockersViaGraphQL,
  issueDepSlug,
  buildIssuePlanContent,
  peekGithubIssues,
  peekPrdIssues,
  discoverParentPrd,
  fetchIssueWithLabels,
  discoverParentIssue,
  pullGithubIssues,
  pullPrdSubIssue,
  fetchPrdIssueByNumber,
  fetchPrdIssue,
  issueBranchName,
  prdBranchName,
  fetchIssueTitleByNumber,
  pullGithubIssueByNumber,
  checkAllPrdSubIssuesDone,
} from "./issues.ts";

export type {
  PullIssueOptions,
  PullIssueResult,
  PeekIssueOptions,
  PeekIssueResult,
  BuildIssuePlanContentOptions,
  IssueWithLabels,
  ParentIssueResult,
  PrdIssue,
} from "./issues.ts";

// ---------------------------------------------------------------------------
// label-lifecycle.ts — centralised label transitions
// ---------------------------------------------------------------------------
export {
  transitionPull,
  transitionDone,
  transitionStuck,
  transitionReset,
  prdTransitionInProgress,
  prdTransitionDone,
  prdTransitionStuck,
} from "./label-lifecycle.ts";

export type { IssueMeta, LabelTransitionResult } from "./label-lifecycle.ts";

// ---------------------------------------------------------------------------
// labels.ts — shared state label constants
// ---------------------------------------------------------------------------
export {
  IN_PROGRESS_LABEL,
  DONE_LABEL,
  STUCK_LABEL,
  STATE_LABELS,
} from "./labels.ts";

// ---------------------------------------------------------------------------
// issue-dispatch.ts — label-driven dispatch classification
// ---------------------------------------------------------------------------
export {
  classifyIssue,
  validateStandalone,
  validateSubissue,
} from "./issue-dispatch.ts";

export type {
  DispatchFamily,
  DispatchClassified,
  DispatchUnrecognized,
  DispatchResult,
  ValidationPassed,
  ValidationFailed,
  ValidationResult,
  LabelConfig,
} from "./issue-dispatch.ts";

// ---------------------------------------------------------------------------
// prd-discovery.ts — PRD issue discovery and sub-issue routing
// ---------------------------------------------------------------------------
export { discoverPrdTarget } from "./prd-discovery.ts";

export type {
  PrdSubIssue,
  PrdDiscoveryResultPrd,
  PrdDiscoveryResultIssue,
  PrdDiscoveryResult,
} from "./prd-discovery.ts";

// ---------------------------------------------------------------------------
// prd-hitl.ts — HITL dependency detection and summary formatting
// ---------------------------------------------------------------------------
export { findHitlBlockers, formatPrdHitlSummary } from "./prd-hitl.ts";

export type { BlockedSubIssue, PrdHitlSummaryInput } from "./prd-hitl.ts";

// ---------------------------------------------------------------------------
// reset-labels.ts — label restoration on plan reset
// ---------------------------------------------------------------------------
export { restoreIssueLabels } from "./reset-labels.ts";

export type {
  RestoreIssueLabelsOptions,
  RestoreIssueLabelsResult,
} from "./reset-labels.ts";
