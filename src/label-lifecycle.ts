/**
 * Label lifecycle module — centralises all `gh issue edit` label
 * transitions for GitHub issues tracked by Ralphai.
 *
 * Labels use a two-label scheme: a family label (e.g. `ralphai-standalone`)
 * persists through all states, while a shared state label (`in-progress`,
 * `done`, `stuck`) is added/removed as the issue progresses.
 *
 * Every label transition in the system flows through this module:
 *   pull:  add in-progress  (family label stays)
 *   done:  remove in-progress, add done
 *   stuck: remove in-progress, add stuck
 *   reset: remove in-progress + stuck  (family label stays)
 *
 * PRD parent propagation helpers:
 *   prdInProgress: add in-progress label to PRD parent
 *   prdDone:       add done label (remove in-progress) on PRD parent
 *   prdStuck:      add stuck label on PRD parent
 *
 * All functions are best-effort: failures are logged but never thrown.
 *
 * Dry-run safety: every transition function accepts an optional `dryRun`
 * parameter. When true, the function logs what would have been done and
 * returns a successful result without executing any `gh issue edit` calls.
 */
import { execQuiet } from "./exec.ts";
import { IN_PROGRESS_LABEL, DONE_LABEL, STUCK_LABEL } from "./labels.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identifies a GitHub issue for label operations. */
export interface IssueMeta {
  /** The issue number. */
  number: number;
  /** The owner/repo string (e.g. "acme/widgets"). */
  repo: string;
}

/** Result of a label transition attempt. */
export interface LabelTransitionResult {
  /** Whether the gh CLI call succeeded. */
  ok: boolean;
  /** Human-readable status message. */
  message: string;
  /** Whether the operation was skipped due to dry-run mode. */
  skipped?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a dry-run skip result. Logs what would have been done and returns
 * a successful result with `skipped: true`.
 */
function dryRunSkip(description: string): LabelTransitionResult {
  console.log(`[dry-run] Would execute label operation: ${description}`);
  return { ok: true, message: `[dry-run] ${description}`, skipped: true };
}

// ---------------------------------------------------------------------------
// Core transitions
// ---------------------------------------------------------------------------

/**
 * Pull transition: add in-progress.
 *
 * Used when an issue is picked up from the backlog. The family label
 * stays; only the shared `in-progress` label is added.
 */
export function transitionPull(
  issue: IssueMeta,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(`Issue #${issue.number}: add ${IN_PROGRESS_LABEL}`);
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${IN_PROGRESS_LABEL}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Label add failed for issue #${issue.number} (pull: add ${IN_PROGRESS_LABEL})`,
    };
  }
  return {
    ok: true,
    message: `Issue #${issue.number}: added ${IN_PROGRESS_LABEL}`,
  };
}

/**
 * Done transition: in-progress → done.
 *
 * Used when work completes successfully and the plan is archived.
 */
export function transitionDone(
  issue: IssueMeta,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(
      `Issue #${issue.number}: ${IN_PROGRESS_LABEL} → ${DONE_LABEL}`,
    );
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${DONE_LABEL}" --remove-label "${IN_PROGRESS_LABEL}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Label swap failed for issue #${issue.number} (done: ${IN_PROGRESS_LABEL} → ${DONE_LABEL})`,
    };
  }
  return {
    ok: true,
    message: `Issue #${issue.number}: ${IN_PROGRESS_LABEL} → ${DONE_LABEL}`,
  };
}

/**
 * Stuck transition: in-progress → stuck.
 *
 * Used when stuck detection fires after consecutive no-progress iterations.
 */
export function transitionStuck(
  issue: IssueMeta,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(
      `Issue #${issue.number}: ${IN_PROGRESS_LABEL} → ${STUCK_LABEL}`,
    );
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${STUCK_LABEL}" --remove-label "${IN_PROGRESS_LABEL}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Label swap failed for issue #${issue.number} (stuck: ${IN_PROGRESS_LABEL} → ${STUCK_LABEL})`,
    };
  }
  return {
    ok: true,
    message: `Issue #${issue.number}: ${IN_PROGRESS_LABEL} → ${STUCK_LABEL}`,
  };
}

/**
 * Reset transition: remove in-progress + stuck.
 *
 * Used by `ralphai reset` to return an issue to the pickup queue.
 * Removes both in-progress and stuck labels. The family label stays
 * (it was never removed during pull).
 */
export function transitionReset(
  issue: IssueMeta,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(`Issue #${issue.number}: remove state labels`);
  }
  const cmd =
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
    `--remove-label "${IN_PROGRESS_LABEL}" --remove-label "${STUCK_LABEL}"`;
  const result = execQuiet(cmd, cwd);
  if (result === null) {
    return {
      ok: false,
      message: `Label restoration failed for issue #${issue.number}`,
    };
  }
  return {
    ok: true,
    message: `Restored labels on issue #${issue.number} (${issue.repo})`,
  };
}

// ---------------------------------------------------------------------------
// PRD parent propagation
// ---------------------------------------------------------------------------

/**
 * PRD parent → in-progress.
 *
 * Called when the first sub-issue is pulled from a PRD.
 * Adds the in-progress label to the PRD parent (idempotent — GitHub
 * silently ignores adding a label that already exists).
 */
export function prdTransitionInProgress(
  issue: IssueMeta,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(`PRD #${issue.number}: add ${IN_PROGRESS_LABEL}`);
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${IN_PROGRESS_LABEL}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Failed to add ${IN_PROGRESS_LABEL} to PRD #${issue.number}`,
    };
  }
  return {
    ok: true,
    message: `PRD #${issue.number}: added ${IN_PROGRESS_LABEL}`,
  };
}

/**
 * PRD parent → done.
 *
 * Called when all sub-issues under a PRD are completed.
 * Adds the done label and removes the in-progress label.
 */
export function prdTransitionDone(
  issue: IssueMeta,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(
      `PRD #${issue.number}: ${IN_PROGRESS_LABEL} → ${DONE_LABEL}`,
    );
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${DONE_LABEL}" --remove-label "${IN_PROGRESS_LABEL}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Failed to transition PRD #${issue.number} to done`,
    };
  }
  return {
    ok: true,
    message: `PRD #${issue.number}: ${IN_PROGRESS_LABEL} → ${DONE_LABEL}`,
  };
}

/**
 * PRD parent → stuck.
 *
 * Called when any sub-issue under a PRD gets stuck.
 * Adds the stuck label (does not remove in-progress — the PRD may still
 * have other sub-issues being processed).
 */
export function prdTransitionStuck(
  issue: IssueMeta,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(`PRD #${issue.number}: add ${STUCK_LABEL}`);
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${STUCK_LABEL}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Failed to add ${STUCK_LABEL} to PRD #${issue.number}`,
    };
  }
  return {
    ok: true,
    message: `PRD #${issue.number}: added ${STUCK_LABEL}`,
  };
}
