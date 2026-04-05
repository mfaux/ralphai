/**
 * Label lifecycle module — centralises all `gh issue edit` label
 * transitions for GitHub issues tracked by Ralphai.
 *
 * Every label transition in the system flows through this module:
 *   pull:  intake → in-progress
 *   done:  in-progress → done
 *   stuck: in-progress → stuck
 *   reset: in-progress/stuck → intake
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
import { execSync } from "child_process";

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
 * Run a command and return trimmed stdout, or null on any error.
 * Best-effort: callers treat null as a non-fatal failure.
 */
function execQuiet(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

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
 * Pull transition: intake → in-progress.
 *
 * Used when an issue is picked up from the backlog.
 */
export function transitionPull(
  issue: IssueMeta,
  intakeLabel: string,
  inProgressLabel: string,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(
      `Issue #${issue.number}: ${intakeLabel} → ${inProgressLabel}`,
    );
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${inProgressLabel}" --remove-label "${intakeLabel}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Label swap failed for issue #${issue.number} (pull: ${intakeLabel} → ${inProgressLabel})`,
    };
  }
  return {
    ok: true,
    message: `Issue #${issue.number}: ${intakeLabel} → ${inProgressLabel}`,
  };
}

/**
 * Done transition: in-progress → done.
 *
 * Used when work completes successfully and the plan is archived.
 */
export function transitionDone(
  issue: IssueMeta,
  inProgressLabel: string,
  doneLabel: string,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(
      `Issue #${issue.number}: ${inProgressLabel} → ${doneLabel}`,
    );
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${doneLabel}" --remove-label "${inProgressLabel}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Label swap failed for issue #${issue.number} (done: ${inProgressLabel} → ${doneLabel})`,
    };
  }
  return {
    ok: true,
    message: `Issue #${issue.number}: ${inProgressLabel} → ${doneLabel}`,
  };
}

/**
 * Stuck transition: in-progress → stuck.
 *
 * Used when stuck detection fires after consecutive no-progress iterations.
 */
export function transitionStuck(
  issue: IssueMeta,
  inProgressLabel: string,
  stuckLabel: string,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(
      `Issue #${issue.number}: ${inProgressLabel} → ${stuckLabel}`,
    );
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${stuckLabel}" --remove-label "${inProgressLabel}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Label swap failed for issue #${issue.number} (stuck: ${inProgressLabel} → ${stuckLabel})`,
    };
  }
  return {
    ok: true,
    message: `Issue #${issue.number}: ${inProgressLabel} → ${stuckLabel}`,
  };
}

/**
 * Reset transition: in-progress/stuck → intake.
 *
 * Used by `ralphai reset` to return an issue to the pickup queue.
 * Removes both in-progress and stuck labels, adds the intake label.
 *
 * The optional `extraRemoveLabels` parameter allows callers to defensively
 * remove labels from a second family (e.g. removing standalone state labels
 * when resetting a sub-issue, in case the wrong family was applied).
 * `gh issue edit --remove-label` is a no-op for labels that aren't present.
 */
export function transitionReset(
  issue: IssueMeta,
  intakeLabel: string,
  inProgressLabel: string,
  stuckLabel: string,
  cwd: string,
  dryRun = false,
  extraRemoveLabels: string[] = [],
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(`Issue #${issue.number}: reset to ${intakeLabel}`);
  }
  let cmd =
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
    `--add-label "${intakeLabel}" --remove-label "${inProgressLabel}" --remove-label "${stuckLabel}"`;
  for (const label of extraRemoveLabels) {
    cmd += ` --remove-label "${label}"`;
  }
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
  prdInProgressLabel: string,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(`PRD #${issue.number}: add ${prdInProgressLabel}`);
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${prdInProgressLabel}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Failed to add ${prdInProgressLabel} to PRD #${issue.number}`,
    };
  }
  return {
    ok: true,
    message: `PRD #${issue.number}: added ${prdInProgressLabel}`,
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
  prdInProgressLabel: string,
  prdDoneLabel: string,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(
      `PRD #${issue.number}: ${prdInProgressLabel} → ${prdDoneLabel}`,
    );
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${prdDoneLabel}" --remove-label "${prdInProgressLabel}"`,
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
    message: `PRD #${issue.number}: ${prdInProgressLabel} → ${prdDoneLabel}`,
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
  prdStuckLabel: string,
  cwd: string,
  dryRun = false,
): LabelTransitionResult {
  if (dryRun) {
    return dryRunSkip(`PRD #${issue.number}: add ${prdStuckLabel}`);
  }
  const result = execQuiet(
    `gh issue edit ${issue.number} --repo "${issue.repo}" ` +
      `--add-label "${prdStuckLabel}"`,
    cwd,
  );
  if (result === null) {
    return {
      ok: false,
      message: `Failed to add ${prdStuckLabel} to PRD #${issue.number}`,
    };
  }
  return {
    ok: true,
    message: `PRD #${issue.number}: added ${prdStuckLabel}`,
  };
}
