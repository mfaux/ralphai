/**
 * Shared state label constants for GitHub issue tracking.
 *
 * Ralphai uses two kinds of labels on GitHub issues:
 *
 * 1. **Family labels** (configurable per repo):
 *    - `ralphai-standalone`  — standalone issues
 *    - `ralphai-subissue`    — PRD sub-issues
 *    - `ralphai-prd`         — PRD parent issues
 *
 * 2. **State labels** (fixed, shared across all families):
 *    - `in-progress`  — issue is being worked on
 *    - `done`         — issue completed successfully
 *    - `stuck`        — agent is stuck on this issue
 *
 * An issue carries its family label through all states. When a state
 * transition occurs, only the state label changes — the family label
 * stays. For example, a standalone issue that gets picked up will have
 * both `ralphai-standalone` and `in-progress` labels.
 */

// ---------------------------------------------------------------------------
// Shared state labels
// ---------------------------------------------------------------------------

/** Label added when an issue is picked up and work begins. */
export const IN_PROGRESS_LABEL = "in-progress";

/** Label added when work completes successfully. */
export const DONE_LABEL = "done";

/** Label added when the agent gets stuck on an issue. */
export const STUCK_LABEL = "stuck";

/** All state labels that can be removed during a reset. */
export const STATE_LABELS = [IN_PROGRESS_LABEL, DONE_LABEL, STUCK_LABEL];
