/**
 * Issue lifecycle module — single source of truth for all issue-related
 * operations: label constants, label transitions, GitHub issue pulling,
 * PRD discovery, dispatch classification, HITL helpers, and reset logic.
 *
 * Also re-exports pure naming utilities from issue-naming.ts.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execQuiet, checkGhAvailable } from "./exec.ts";
import type { ExecOptions } from "./exec.ts";
// Re-export so consumers that imported checkGhAvailable from issues.ts still work
export { checkGhAvailable } from "./exec.ts";
import { DEFAULTS } from "./config.ts";
import { extractIssueFrontmatter } from "./plan-lifecycle.ts";

// Re-export all naming utilities
export {
  slugify,
  commitTypeFromTitle,
  issueBranchName,
  issueDepSlug,
} from "./issue-naming.ts";

// Import naming functions used internally
import { slugify, issueDepSlug } from "./issue-naming.ts";

// ===========================================================================
// Labels — shared state label constants
// ===========================================================================

/**
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
 * stays.
 */

/** Label added when an issue is picked up and work begins. */
export const IN_PROGRESS_LABEL = "in-progress";

/** Label added when work completes successfully. */
export const DONE_LABEL = "done";

/** Label added when the agent gets stuck on an issue. */
export const STUCK_LABEL = "stuck";

// ===========================================================================
// Label lifecycle — centralised label transitions
// ===========================================================================

/**
 * Labels use a two-label scheme: a family label (e.g. `ralphai-standalone`)
 * persists through all states, while a shared state label (`in-progress`,
 * `done`, `stuck`) is added/removed as the issue progresses.
 *
 * Every label transition in the system flows through these functions:
 *   pull:  add in-progress  (family label stays)
 *   done:  remove in-progress + stuck, add done
 *   stuck: remove in-progress, add stuck
 *   reset: remove in-progress + stuck  (family label stays)
 *
 * PRD parent propagation helpers:
 *   prdInProgress: add in-progress label to PRD parent
 *   prdDone:       add done label (remove in-progress + stuck) on PRD parent
 *   prdStuck:      add stuck label on PRD parent
 *
 * All functions are best-effort: failures are logged but never thrown.
 *
 * Dry-run safety: every transition function accepts an optional `dryRun`
 * parameter. When true, the function logs what would have been done and
 * returns a successful result without executing any `gh issue edit` calls.
 */

// ---------------------------------------------------------------------------
// Label lifecycle types
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
// Label lifecycle internal helpers
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
// Core label transitions
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

  // Guard: refuse to add in-progress if the issue already has the done label.
  // This prevents a duplicate/retry pull from corrupting the label state of
  // a completed issue.  Fail-open: if the label fetch fails we proceed — the
  // worst case is the same as the previous (unguarded) behavior.
  const labelsRaw = execQuiet(
    `gh issue view ${issue.number} --repo "${issue.repo}" --json labels`,
    cwd,
  );
  if (labelsRaw) {
    try {
      const data: { labels?: Array<{ name: string }> } = JSON.parse(labelsRaw);
      const labels = (data.labels ?? []).map((l) => l.name);
      if (labels.includes(DONE_LABEL)) {
        return {
          ok: false,
          message:
            `Refused to add ${IN_PROGRESS_LABEL} to issue #${issue.number}: ` +
            `already has ${DONE_LABEL} label`,
        };
      }
    } catch {
      // JSON parse failure — proceed with the edit (fail-open)
    }
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
 * Done transition: in-progress -> done.
 *
 * Used when work completes successfully and the plan is archived.
 * Removes both in-progress and stuck labels to ensure a clean state.
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
      `--add-label "${DONE_LABEL}" --remove-label "${IN_PROGRESS_LABEL}" --remove-label "${STUCK_LABEL}"`,
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
 * Stuck transition: in-progress -> stuck.
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
// PRD parent label propagation
// ---------------------------------------------------------------------------

/**
 * PRD parent -> in-progress.
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
 * PRD parent -> done.
 *
 * Called when all sub-issues under a PRD are completed.
 * Adds the done label and removes both in-progress and stuck labels.
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
      `--add-label "${DONE_LABEL}" --remove-label "${IN_PROGRESS_LABEL}" --remove-label "${STUCK_LABEL}"`,
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
 * PRD parent -> stuck.
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

// ===========================================================================
// Issue dispatch — label-driven classification and validation
// ===========================================================================

/**
 * Given an issue's labels, determines which dispatch path to take:
 * - `standalone` — create dedicated branch, process as single issue
 * - `subissue`   — discover parent PRD, fold into shared branch
 * - `prd`        — discover sub-issues, process sequentially on shared branch
 * - `none`       — no recognized label, error with guidance
 *
 * With shared state labels, classification only needs to check for family
 * labels (which persist through all states).
 */

// ---------------------------------------------------------------------------
// Dispatch types
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
// Dispatch classification
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
  if (issueLabels.includes(config.standaloneLabel)) {
    return { ok: true, family: "standalone" };
  }
  if (issueLabels.includes(config.subissueLabel)) {
    return { ok: true, family: "subissue" };
  }
  if (issueLabels.includes(config.prdLabel)) {
    return { ok: true, family: "prd" };
  }
  return {
    ok: false,
    reason: "no-label",
    message:
      `Issue has no recognized ralphai label. ` +
      `Add one of: ${config.standaloneLabel}, ${config.subissueLabel}, or ${config.prdLabel}.`,
  };
}

// ---------------------------------------------------------------------------
// Dispatch validation
// ---------------------------------------------------------------------------

/**
 * Validate a standalone issue before dispatch.
 *
 * Rule: standalone + has parent PRD -> skip with warning.
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
 * - subissue + no parent PRD -> skip with warning
 * - subissue + parent exists but lacks ralphai-prd label -> skip with warning
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

// ===========================================================================
// Issue types
// ===========================================================================

/** Options for pulling a GitHub issue into the backlog. */
export interface PullIssueOptions {
  /** The backlog directory where plan files are written. */
  backlogDir: string;
  /** The in-progress directory — checked for de-duplication to avoid double-pulling an issue. */
  wipDir?: string;
  /** Working directory (for git remote detection). */
  cwd: string;
  /** Configured issue source — must be "github" to proceed. */
  issueSource: string;
  /** Family label to filter open standalone issues by (e.g. "ralphai-standalone"). */
  standaloneLabel: string;
  /** Sub-issue family label (e.g. "ralphai-subissue"). Used by pullPrdSubIssue(). */
  subissueLabel?: string;
  /** Explicit owner/repo (empty = auto-detect from git remote). */
  issueRepo: string;
  /** Whether to post a progress comment on the issue. */
  issueCommentProgress: boolean;
  /** Family label that marks an issue as a PRD (e.g. "ralphai-prd"). */
  issuePrdLabel?: string;
  /** Label that marks a sub-issue as requiring human-in-the-loop review (e.g. "ralphai-subissue-hitl"). */
  issueHitlLabel?: string;
}

/** Result of a pullGithubIssues() call. */
export interface PullIssueResult {
  /** Whether a plan file was created. */
  pulled: boolean;
  /** Path to the created plan file, if any. */
  planPath?: string;
  /** Human-readable status message. */
  message: string;
}

/** Options for the read-only peekGithubIssues(). */
export interface PeekIssueOptions {
  /** Working directory (for git remote detection). */
  cwd: string;
  /** Configured issue source — must be "github" to proceed. */
  issueSource: string;
  /** Label to filter open issues by (e.g. "ralphai-standalone"). */
  standaloneLabel: string;
  /** Explicit owner/repo (empty = auto-detect from git remote). */
  issueRepo: string;
  /** Label that marks an issue as a PRD (e.g. "ralphai-prd"). */
  issuePrdLabel?: string;
  /**
   * Subprocess timeout in milliseconds. When set, `gh` and `git`
   * subprocess calls are killed after this many milliseconds.
   * Useful for TUI contexts where a hung CLI must not block the
   * event loop. Omit for no timeout (default).
   */
  timeout?: number;
}

/** Result of a peekGithubIssues() call. */
export interface PeekIssueResult {
  /** Whether matching issues were found. */
  found: boolean;
  /** Number of matching issues (0 when not found). */
  count: number;
  /** The oldest matching issue (picked first by the runner). */
  oldest?: { number: number; title: string };
  /** Detected repo (owner/repo). */
  repo?: string;
  /** Human-readable status message. */
  message: string;
}

/** Input for building plan file content from a GitHub issue. */
export interface BuildIssuePlanContentOptions {
  issueNumber: string;
  title: string;
  body: string;
  url: string;
  /** Parent PRD issue number (when the issue has a parent with `ralphai-prd` label). */
  prd?: number;
  /** Blocker issue numbers from the GraphQL `blockedBy` query. */
  blockers?: number[];
}

/** Result of fetching an issue with its labels. */
export interface IssueWithLabels {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

/** Result of parent issue discovery. */
export interface ParentIssueResult {
  /** Whether a parent issue exists. */
  hasParent: boolean;
  /** The parent issue number, if it exists. */
  parentNumber: number | undefined;
  /** Whether the parent has the PRD label. Only meaningful when hasParent is true. */
  parentHasPrdLabel: boolean;
  /** The parent issue title, if it exists. */
  parentTitle: string | undefined;
}

/** Minimal PRD data model threaded through the system. */
export interface PrdIssue {
  number: number;
  title: string;
}

// ===========================================================================
// Core issue functions
// ===========================================================================

/**
 * Detect the GitHub repository (owner/repo) from config or the git remote.
 *
 * - If `configRepo` is non-empty, returns it as-is.
 * - Otherwise, parses `git remote get-url origin` for SSH or HTTPS patterns.
 *
 * Returns null if detection fails.
 */
export function detectIssueRepo(
  cwd: string,
  configRepo?: string,
  options?: ExecOptions,
): string | null {
  if (configRepo && configRepo.length > 0) {
    return configRepo;
  }

  const url = execQuiet("git remote get-url origin", cwd, options);
  if (!url) return null;

  // Handle SSH: git@<host>:owner/repo.git  (supports host aliases like github-work)
  // Handle HTTPS: https://<host>/owner/repo.git
  const cleaned = url
    .replace(/^git@[^:]+:/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/\.git$/, "");

  // Validate it looks like owner/repo
  if (/^[^/]+\/[^/]+$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Blocker discovery via GitHub GraphQL API (Issue.blockedBy)
// ---------------------------------------------------------------------------

/**
 * Query native GitHub blocking relationships for an issue via GraphQL.
 *
 * Calls `gh api graphql` with the `Issue.blockedBy` connection to discover
 * which issues block the given one. Returns a sorted array of blocker issue
 * numbers.
 *
 * Fail-open: returns an empty array (with a console.warn) if the query
 * fails for any reason — the plan will proceed without `depends-on` entries.
 */
export function fetchBlockersViaGraphQL(
  repo: string,
  issueNumber: string,
  cwd: string,
): number[] {
  const [owner, name] = repo.split("/");
  if (!owner || !name) return [];

  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){blockedBy(first:50){nodes{number}}}}}`;

  const raw = execQuiet(
    `gh api graphql -f query='${query}' -F owner='${owner}' -F name='${name}' -F number=${issueNumber}`,
    cwd,
  );

  if (!raw) {
    console.warn(
      `Warning: GraphQL blockedBy query failed for issue #${issueNumber} — treating as no blockers`,
    );
    return [];
  }

  let parsed: {
    data?: {
      repository?: {
        issue?: { blockedBy?: { nodes?: Array<{ number: number }> } };
      };
    };
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      `Warning: failed to parse GraphQL blockedBy response for issue #${issueNumber} — treating as no blockers`,
    );
    return [];
  }

  const nodes = parsed.data?.repository?.issue?.blockedBy?.nodes;
  if (!nodes || nodes.length === 0) return [];

  return nodes.map((n) => n.number).sort((a, b) => a - b);
}

/**
 * Build the markdown content for a plan file from a GitHub issue.
 * If `blockers` contains issue numbers (from the GraphQL `blockedBy` query),
 * a `depends-on` field is included in the frontmatter.
 */
export function buildIssuePlanContent(
  opts: BuildIssuePlanContentOptions,
): string {
  const { issueNumber, title, body, url, prd, blockers = [] } = opts;

  let frontmatter = `source: github\nissue: ${issueNumber}\nissue-url: ${url}`;
  if (prd !== undefined) {
    frontmatter += `\nprd: ${prd}`;
  }
  if (blockers.length > 0) {
    const depSlugs = blockers.map(issueDepSlug).join(", ");
    frontmatter += `\ndepends-on: [${depSlugs}]`;
  }

  return `---\n${frontmatter}\n---\n\n# ${title}\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Shared peek helper — used by peekGithubIssues() and peekPrdIssues()
// ---------------------------------------------------------------------------

interface PeekParams {
  cwd: string;
  issueSource: string;
  issueRepo: string;
  label: string;
  limit: number;
  /**
   * Message fragments that differ between standalone and PRD peeks.
   * Keeps all human-readable strings identical to the originals.
   */
  msg: {
    skipPeek: string; // e.g. "issue peek" or "PRD peek"
    listFailed: string; // e.g. "issues" or "PRD issues"
    parseFailed: string; // e.g. "issue list" or "PRD issue list"
    emptyLabel: string; // e.g. "issues" or "PRD issues"
    countLabel: string; // e.g. "GitHub issue(s)" or "PRD issue(s)"
  };
  timeoutOpt: ExecOptions;
}

function peekIssuesByLabel(p: PeekParams): PeekIssueResult {
  if (p.issueSource !== "github") {
    return { found: false, count: 0, message: "Issue source is not 'github'" };
  }

  if (!checkGhAvailable(p.timeoutOpt)) {
    return {
      found: false,
      count: 0,
      message: `gh CLI not available or not authenticated — skipping ${p.msg.skipPeek}`,
    };
  }

  const repo = detectIssueRepo(p.cwd, p.issueRepo, p.timeoutOpt);
  if (!repo) {
    return {
      found: false,
      count: 0,
      message: `Could not detect GitHub repo — skipping ${p.msg.skipPeek}`,
    };
  }

  const raw = execQuiet(
    `gh issue list --repo "${repo}" --label "${p.label}" --state open ` +
      `--limit ${p.limit} --json number,title`,
    p.cwd,
    p.timeoutOpt,
  );

  if (!raw) {
    return {
      found: false,
      count: 0,
      repo,
      message: `Could not list ${p.msg.listFailed} in ${repo}`,
    };
  }

  let issues: Array<{ number: number; title: string }>;
  try {
    issues = JSON.parse(raw);
  } catch {
    return {
      found: false,
      count: 0,
      repo,
      message: `Failed to parse ${p.msg.parseFailed} from ${repo}`,
    };
  }

  if (issues.length === 0) {
    return {
      found: false,
      count: 0,
      repo,
      message: `No open ${p.msg.emptyLabel} with label '${p.label}' in ${repo}`,
    };
  }

  // gh issue list returns newest first; last element is the oldest.
  const oldest = issues[issues.length - 1]!;

  return {
    found: true,
    count: issues.length,
    oldest,
    repo,
    message:
      `${issues.length} ${p.msg.countLabel} with label '${p.label}' in ${repo}` +
      ` (oldest: #${oldest.number} — ${oldest.title})`,
  };
}

/**
 * Read-only check for open GitHub issues matching the configured label.
 *
 * This is safe for dry-run mode: it queries the GitHub API but never writes
 * files, edits labels, or posts comments.
 */
export function peekGithubIssues(options: PeekIssueOptions): PeekIssueResult {
  return peekIssuesByLabel({
    cwd: options.cwd,
    issueSource: options.issueSource,
    issueRepo: options.issueRepo,
    label: options.standaloneLabel,
    limit: 100,
    msg: {
      skipPeek: "issue peek",
      listFailed: "issues",
      parseFailed: "issue list",
      emptyLabel: "issues",
      countLabel: "GitHub issue(s)",
    },
    timeoutOpt: options.timeout != null ? { timeout: options.timeout } : {},
  });
}

/**
 * Read-only check for open PRD issues (configured PRD label).
 * Safe for dry-run mode.
 */
export function peekPrdIssues(options: PeekIssueOptions): PeekIssueResult {
  return peekIssuesByLabel({
    cwd: options.cwd,
    issueSource: options.issueSource,
    issueRepo: options.issueRepo,
    label: options.issuePrdLabel ?? DEFAULTS.prdLabel,
    limit: 10,
    msg: {
      skipPeek: "PRD peek",
      listFailed: "PRD issues",
      parseFailed: "PRD issue list",
      emptyLabel: "PRD issues",
      countLabel: "PRD issue(s)",
    },
    timeoutOpt: options.timeout != null ? { timeout: options.timeout } : {},
  });
}

// ---------------------------------------------------------------------------
// Parent PRD discovery via REST API
// ---------------------------------------------------------------------------

/**
 * Discover the parent PRD issue number for a given issue.
 *
 * Calls `gh api repos/{owner}/{repo}/issues/{N}/parent` which returns the
 * parent issue object (including labels) or 404 if no parent exists.
 *
 * Returns the parent issue number only if the parent has the configured PRD
 * label. Returns `undefined` when:
 * - the issue has no parent (404)
 * - the parent does not have the PRD label
 * - the API call fails for any reason (non-fatal)
 *
 * Logs a warning to stderr on API failure so the plan is still usable.
 */
export function discoverParentPrd(
  repo: string,
  issueNumber: string,
  cwd: string,
  prdLabel?: string,
): number | undefined {
  const label = prdLabel ?? DEFAULTS.prdLabel;
  const raw = execQuiet(
    `gh api repos/${repo}/issues/${issueNumber}/parent`,
    cwd,
  );

  if (!raw) {
    return undefined;
  }

  let parent: { number: number; labels: Array<{ name: string }> };
  try {
    parent = JSON.parse(raw);
  } catch {
    console.warn(
      `Warning: failed to parse parent response for issue #${issueNumber} — skipping PRD discovery`,
    );
    return undefined;
  }

  const hasPrdLabel = parent.labels?.some((l) => l.name === label);
  if (!hasPrdLabel) {
    return undefined;
  }

  return parent.number;
}

// ---------------------------------------------------------------------------
// Fetch issue with labels (for label-driven dispatch)
// ---------------------------------------------------------------------------

/**
 * Fetch a GitHub issue by number, returning title, body, and labels.
 *
 * Used by label-driven dispatch to classify which dispatch path to take.
 * Read-only — does not write files or mutate labels.
 *
 * Throws a descriptive error if:
 * - `gh` is not available or not authenticated
 * - the issue is not found or is inaccessible
 */
export function fetchIssueWithLabels(
  repo: string,
  issueNumber: number,
  cwd: string,
): IssueWithLabels {
  if (!checkGhAvailable()) {
    throw new Error(
      "gh CLI not available or not authenticated — cannot fetch issue",
    );
  }

  const raw = execQuiet(
    `gh issue view ${issueNumber} --repo "${repo}" --json title,body,labels`,
    cwd,
  );

  if (!raw) {
    throw new Error(
      `Could not fetch issue #${issueNumber} from ${repo}. ` +
        `Check that the issue exists and you have access.`,
    );
  }

  let data: { title: string; body: string; labels: Array<{ name: string }> };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse response for issue #${issueNumber} from ${repo}`,
    );
  }

  return {
    number: issueNumber,
    title: data.title,
    body: data.body ?? "",
    labels: data.labels.map((l) => l.name),
  };
}

// ---------------------------------------------------------------------------
// Discover parent issue (richer than discoverParentPrd)
// ---------------------------------------------------------------------------

/**
 * Discover the parent issue for a given issue, returning both the parent
 * number and whether it has the PRD label.
 *
 * Unlike `discoverParentPrd()`, this function distinguishes between:
 * - no parent (404)
 * - parent exists but lacks PRD label
 * - parent exists with PRD label
 *
 * Used for label-driven dispatch validation where we need to differentiate
 * these cases to provide appropriate warnings.
 */
export function discoverParentIssue(
  repo: string,
  issueNumber: number,
  cwd: string,
  prdLabel?: string,
): ParentIssueResult {
  const label = prdLabel ?? DEFAULTS.prdLabel;
  const raw = execQuiet(
    `gh api repos/${repo}/issues/${issueNumber}/parent`,
    cwd,
  );

  if (!raw) {
    return {
      hasParent: false,
      parentNumber: undefined,
      parentHasPrdLabel: false,
      parentTitle: undefined,
    };
  }

  let parent: {
    number: number;
    title?: string;
    labels: Array<{ name: string }>;
  };
  try {
    parent = JSON.parse(raw);
  } catch {
    return {
      hasParent: false,
      parentNumber: undefined,
      parentHasPrdLabel: false,
      parentTitle: undefined,
    };
  }

  const hasPrdLabel = parent.labels?.some((l) => l.name === label) ?? false;
  return {
    hasParent: true,
    parentNumber: parent.number,
    parentHasPrdLabel: hasPrdLabel,
    parentTitle: parent.title,
  };
}

// ---------------------------------------------------------------------------
// Internal: shared pull logic
// ---------------------------------------------------------------------------

/**
 * Check whether a plan file for the given issue number already exists in a
 * directory. Scans both flat files and slug-folders matching the
 * `gh-{N}-` prefix. Returns the matching entry name or undefined.
 */
function findExistingPlanForIssue(
  dir: string,
  issueNumber: string,
): string | undefined {
  if (!existsSync(dir)) return undefined;
  const prefix = `gh-${issueNumber}-`;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(prefix)) {
        return entry.name;
      }
    }
  } catch {
    // ignore read errors (permission, etc.)
  }
  return undefined;
}

interface FetchAndWriteOptions {
  repo: string;
  issueNumber: string;
  backlogDir: string;
  wipDir?: string;
  cwd: string;
  issueCommentProgress: boolean;
  issuePrdLabel?: string;
}

/**
 * Fetch a single issue by number, write a plan file, swap labels, and
 * optionally post a progress comment. Shared by both pullGithubIssues()
 * and pullGithubIssueByNumber().
 */
function fetchAndWriteIssuePlan(opts: FetchAndWriteOptions): PullIssueResult {
  const { repo, issueNumber, backlogDir, cwd, issueCommentProgress } = opts;

  // De-duplication: reject if a plan for this issue already exists in
  // backlog or in-progress. Archive is intentionally not checked so that
  // completed issues can be re-pulled.
  for (const dir of [backlogDir, opts.wipDir]) {
    if (!dir) continue;
    const existing = findExistingPlanForIssue(dir, issueNumber);
    if (existing) {
      return {
        pulled: false,
        message: `Issue #${issueNumber} already has a plan in the pipeline: ${existing}`,
      };
    }
  }

  const title = execQuiet(
    `gh issue view ${issueNumber} --repo "${repo}" --json title --jq '.title'`,
    cwd,
  );
  const body = execQuiet(
    `gh issue view ${issueNumber} --repo "${repo}" --json body --jq '.body'`,
    cwd,
  );
  const url = execQuiet(
    `gh issue view ${issueNumber} --repo "${repo}" --json url --jq '.url'`,
    cwd,
  );

  if (!title) {
    return {
      pulled: false,
      message: `Failed to fetch details for issue #${issueNumber}`,
    };
  }

  // Discover parent PRD (non-fatal — plan is still usable without it)
  const prd = discoverParentPrd(repo, issueNumber, cwd, opts.issuePrdLabel);

  // Query native GitHub blocking relationships via GraphQL (fail-open)
  const blockers = fetchBlockersViaGraphQL(repo, issueNumber, cwd);

  const slug = slugify(title);
  const filename = `gh-${issueNumber}-${slug}.md`;
  const planPath = join(backlogDir, filename);

  if (!existsSync(backlogDir)) {
    mkdirSync(backlogDir, { recursive: true });
  }

  const planContent = buildIssuePlanContent({
    issueNumber: String(issueNumber),
    title,
    body: body ?? "",
    url: url ?? "",
    prd,
    blockers,
  });
  writeFileSync(planPath, planContent, "utf-8");

  // Update issue labels: add in-progress (family label stays)
  transitionPull({ number: Number(issueNumber), repo }, cwd);

  if (issueCommentProgress) {
    execQuiet(
      `gh issue comment ${issueNumber} --repo "${repo}" ` +
        `--body "Ralphai picked up this issue and created a plan file. Working on it now."`,
      cwd,
    );
  }

  return {
    pulled: true,
    planPath,
    message: `Pulled GitHub issue #${issueNumber}: ${title} → ${filename}`,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Iterate an ordered list of candidate issue numbers, fetch the labels for
 * each via `gh issue view`, and return the first one whose labels do not
 * include any of the `skipLabels`. Returns `undefined` when all candidates
 * should be skipped.
 *
 * Used by both `pullGithubIssues()` (standalone) and `pullPrdSubIssue()`
 * (PRD sub-issues) to avoid re-pulling issues that are already in-progress,
 * done, stuck, or awaiting human review.
 */
function findFirstEligibleIssue(
  candidates: Array<{ number: number }>,
  skipLabels: string[],
  repo: string,
  cwd: string,
): number | undefined {
  for (const candidate of candidates) {
    const labelsRaw = execQuiet(
      `gh issue view ${candidate.number} --repo "${repo}" --json labels --jq '[.labels[].name] | join(",")'`,
      cwd,
    );
    const labels = labelsRaw ? labelsRaw.split(",") : [];
    if (skipLabels.some((skip) => labels.includes(skip))) {
      continue;
    }
    return candidate.number;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public pull functions
// ---------------------------------------------------------------------------

/**
 * Pull the oldest open GitHub issue matching the configured label and
 * convert it to a plan file in the backlog directory.
 *
 * Returns a result indicating whether a plan was created.
 */
export function pullGithubIssues(options: PullIssueOptions): PullIssueResult {
  const {
    backlogDir,
    cwd,
    issueSource,
    standaloneLabel: issueLabel,
    issueRepo,
    issueCommentProgress,
  } = options;

  if (issueSource !== "github") {
    return { pulled: false, message: "Issue source is not 'github'" };
  }

  if (!checkGhAvailable()) {
    return {
      pulled: false,
      message:
        "gh CLI not available or not authenticated — skipping issue pull",
    };
  }

  const repo = detectIssueRepo(cwd, issueRepo);
  if (!repo) {
    return {
      pulled: false,
      message: "Could not detect GitHub repo — skipping issue pull",
    };
  }

  // Get all open issues with the configured label (newest first from gh).
  const raw = execQuiet(
    `gh issue list --repo "${repo}" --label "${issueLabel}" --state open ` +
      `--limit 100 --json number`,
    cwd,
  );

  if (!raw) {
    return {
      pulled: false,
      message: `No open issues found with label '${issueLabel}' in ${repo}`,
    };
  }

  let candidates: Array<{ number: number }>;
  try {
    candidates = JSON.parse(raw);
  } catch {
    return {
      pulled: false,
      message: `No open issues found with label '${issueLabel}' in ${repo}`,
    };
  }

  if (candidates.length === 0) {
    return {
      pulled: false,
      message: `No open issues found with label '${issueLabel}' in ${repo}`,
    };
  }

  // Iterate oldest-first (gh returns newest first, so reverse).
  // Skip any candidate that already has a state label.
  const skipLabels = [IN_PROGRESS_LABEL, DONE_LABEL, STUCK_LABEL];
  const reversed = [...candidates].reverse();
  const issueNumber = findFirstEligibleIssue(reversed, skipLabels, repo, cwd);

  if (issueNumber === undefined) {
    return {
      pulled: false,
      message: `All open '${issueLabel}' issues in ${repo} already in-progress, done, or stuck`,
    };
  }

  return fetchAndWriteIssuePlan({
    repo,
    issueNumber: String(issueNumber),
    backlogDir,
    wipDir: options.wipDir,
    cwd,
    issueCommentProgress,
    issuePrdLabel: options.issuePrdLabel,
  });
}

// ---------------------------------------------------------------------------
// PRD sub-issue pull (for priority chain: PRDs before regular issues)
// ---------------------------------------------------------------------------

/**
 * Discover the oldest open `ralphai-prd` issue, fetch its sub-issues via the
 * native REST API, and pull the first eligible open sub-issue into the backlog
 * as a plan file (with `prd` and `depends-on` frontmatter populated by the
 * parent and blocker APIs inside `fetchAndWriteIssuePlan()`).
 *
 * Returns `{ pulled: true }` when a sub-issue was written to the backlog.
 * Returns `{ pulled: false }` when no PRD or no eligible sub-issues exist.
 */
export function pullPrdSubIssue(options: PullIssueOptions): PullIssueResult {
  const { backlogDir, cwd, issueSource, issueRepo, issueCommentProgress } =
    options;

  const prdLabel = options.issuePrdLabel ?? DEFAULTS.prdLabel;

  if (issueSource !== "github") {
    return { pulled: false, message: "Issue source is not 'github'" };
  }

  if (!checkGhAvailable()) {
    return {
      pulled: false,
      message:
        "gh CLI not available or not authenticated — skipping PRD discovery",
    };
  }

  const repo = detectIssueRepo(cwd, issueRepo);
  if (!repo) {
    return {
      pulled: false,
      message: "Could not detect GitHub repo — skipping PRD discovery",
    };
  }

  // Look for open issues with the configured PRD label (body no longer needed)
  const raw = execQuiet(
    `gh issue list --repo "${repo}" --label "${prdLabel}" --state open ` +
      `--limit 10 --json number,title`,
    cwd,
  );

  if (!raw) {
    return { pulled: false, message: "No open PRD issues found" };
  }

  let prdIssues: Array<{ number: number; title: string }>;
  try {
    prdIssues = JSON.parse(raw);
  } catch {
    return { pulled: false, message: "Failed to parse PRD issue response" };
  }

  if (prdIssues.length === 0) {
    return { pulled: false, message: "No open PRD issues found" };
  }

  // Pick the oldest PRD (gh returns newest first, so last element)
  const prd = prdIssues[prdIssues.length - 1]!;

  // Fetch sub-issues via the native REST API (replaces body-text parsing)
  const subIssuesRaw = execQuiet(
    `gh api repos/${repo}/issues/${prd.number}/sub_issues`,
    cwd,
  );

  if (subIssuesRaw === null) {
    return {
      pulled: false,
      message: `PRD #${prd.number} — failed to fetch sub-issues via REST API`,
    };
  }

  let allSubIssues: Array<{ number: number; state: string }>;
  try {
    allSubIssues = JSON.parse(subIssuesRaw);
  } catch {
    return {
      pulled: false,
      message: `PRD #${prd.number} — failed to parse sub-issues response`,
    };
  }

  if (!Array.isArray(allSubIssues)) {
    return {
      pulled: false,
      message: `PRD #${prd.number} — unexpected sub-issues response (expected an array)`,
    };
  }

  // Filter to open sub-issues only (the API returns both open and closed)
  const openSubIssues = allSubIssues.filter((si) => si.state === "open");

  if (openSubIssues.length === 0) {
    return {
      pulled: false,
      message: `PRD #${prd.number} has no open sub-issues`,
    };
  }

  // Find the first open sub-issue that hasn't already been picked up
  // or completed (label check prevents re-pulling issues that were
  // already processed by a prior drain iteration).
  const hitlLabel = options.issueHitlLabel ?? DEFAULTS.issueHitlLabel;
  const skipLabels = [IN_PROGRESS_LABEL, DONE_LABEL, STUCK_LABEL, hitlLabel];
  const subIssueNumber = findFirstEligibleIssue(
    openSubIssues,
    skipLabels,
    repo,
    cwd,
  );

  if (subIssueNumber === undefined) {
    return {
      pulled: false,
      message: `PRD #${prd.number} — all open sub-issues already in-progress, done, or awaiting human review`,
    };
  }

  console.log(
    `PRD #${prd.number} — pulling sub-issue #${subIssueNumber} into backlog`,
  );

  // Best-effort: mark the PRD parent as in-progress when we first pull a sub-issue.
  prdTransitionInProgress({ number: prd.number, repo }, cwd);

  return fetchAndWriteIssuePlan({
    repo,
    issueNumber: String(subIssueNumber),
    backlogDir,
    wipDir: options.wipDir,
    cwd,
    issueCommentProgress,
    issuePrdLabel: options.issuePrdLabel,
  });
}

// ---------------------------------------------------------------------------
// PRD (Product Requirements Document) support
// ---------------------------------------------------------------------------

/**
 * Fetch a specific GitHub issue by number and verify it has the `ralphai-prd`
 * label. Returns `{ number, title }` on success.
 *
 * Throws a descriptive error if:
 * - `gh` is not available or not authenticated
 * - the issue is not found
 * - the issue does not have the configured PRD label
 */
export function fetchPrdIssueByNumber(
  repo: string,
  issueNumber: number,
  cwd: string,
  prdLabel?: string,
): PrdIssue {
  const label = prdLabel ?? DEFAULTS.prdLabel;
  if (!checkGhAvailable()) {
    throw new Error(
      "gh CLI not available or not authenticated — cannot fetch PRD issue",
    );
  }

  const raw = execQuiet(
    `gh issue view ${issueNumber} --repo "${repo}" --json title,labels`,
    cwd,
  );

  if (!raw) {
    throw new Error(
      `Could not fetch issue #${issueNumber} from ${repo}. ` +
        `Check that the issue exists and you have access.`,
    );
  }

  let data: { title: string; labels: Array<{ name: string }> };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse response for issue #${issueNumber} from ${repo}`,
    );
  }

  const hasLabel = data.labels.some((l) => l.name === label);
  if (!hasLabel) {
    throw new Error(
      `Issue #${issueNumber} does not have the '${label}' label. ` +
        `Add the label to the issue and try again.`,
    );
  }

  return { number: issueNumber, title: data.title };
}

/**
 * Auto-detect a single open PRD issue in the repo.
 *
 * Uses `gh issue list --label <prdLabel> --state open --limit 10 --json number,title`.
 *
 * - Returns `{ number, title }` if exactly one result.
 * - Returns `null` if zero results (caller should fall back to default naming).
 * - Throws with a descriptive error listing all matches if multiple results,
 *   suggesting `--prd=<number>` or `ralphai prd <number>`.
 */
export function fetchPrdIssue(
  repo: string,
  cwd: string,
  prdLabel?: string,
): PrdIssue | null {
  const label = prdLabel ?? DEFAULTS.prdLabel;
  if (!checkGhAvailable()) {
    throw new Error(
      "gh CLI not available or not authenticated — cannot auto-detect PRD issue",
    );
  }

  const raw = execQuiet(
    `gh issue list --repo "${repo}" --label "${label}" --state open --limit 10 --json number,title`,
    cwd,
  );

  if (!raw) {
    return null;
  }

  let issues: Array<{ number: number; title: string }>;
  try {
    issues = JSON.parse(raw);
  } catch {
    return null;
  }

  if (issues.length === 0) {
    return null;
  }

  if (issues.length === 1) {
    return { number: issues[0]!.number, title: issues[0]!.title };
  }

  // Multiple PRD issues found — throw a descriptive error
  const listing = issues.map((i) => `  #${i.number} — ${i.title}`).join("\n");
  throw new Error(
    `Multiple open PRD issues found with label '${label}':\n${listing}\n\n` +
      `Specify which PRD to use:\n` +
      `  ralphai run --prd=<number>\n` +
      `  ralphai prd <number>`,
  );
}

// ---------------------------------------------------------------------------
// Fetch issue title (for branch naming, no plan file written)
// ---------------------------------------------------------------------------

/**
 * Fetch a GitHub issue by number and return its title.
 *
 * Used by `ralphai run <number>` to derive the branch name
 * before pulling the issue into a plan file. Does not write files or
 * mutate labels — read-only and safe for dry-run.
 *
 * Throws a descriptive error if:
 * - `gh` is not available or not authenticated
 * - the issue is not found or is inaccessible
 */
export function fetchIssueTitleByNumber(
  repo: string,
  issueNumber: number,
  cwd: string,
): { number: number; title: string } {
  if (!checkGhAvailable()) {
    throw new Error(
      "gh CLI not available or not authenticated — cannot fetch issue",
    );
  }

  const raw = execQuiet(
    `gh issue view ${issueNumber} --repo "${repo}" --json title`,
    cwd,
  );

  if (!raw) {
    throw new Error(
      `Could not fetch issue #${issueNumber} from ${repo}. ` +
        `Check that the issue exists and you have access.`,
    );
  }

  let data: { title: string };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse response for issue #${issueNumber} from ${repo}`,
    );
  }

  return { number: issueNumber, title: data.title };
}

// ---------------------------------------------------------------------------
// Pull specific issue by number
// ---------------------------------------------------------------------------

/**
 * Pull a specific GitHub issue by number and convert it to a plan file.
 *
 * Same as pullGithubIssues() but targets a known issue instead of searching
 * for the oldest one. Used by the "pull & run" action.
 */
export function pullGithubIssueByNumber(
  options: PullIssueOptions & { issueNumber: number },
): PullIssueResult {
  const {
    backlogDir,
    cwd,
    issueSource,
    issueRepo,
    issueCommentProgress,
    issueNumber,
  } = options;

  if (issueSource !== "github") {
    return { pulled: false, message: "Issue source is not 'github'" };
  }

  if (!checkGhAvailable()) {
    return {
      pulled: false,
      message:
        "gh CLI not available or not authenticated — skipping issue pull",
    };
  }

  const repo = detectIssueRepo(cwd, issueRepo);
  if (!repo) {
    return {
      pulled: false,
      message: "Could not detect GitHub repo — skipping issue pull",
    };
  }

  return fetchAndWriteIssuePlan({
    repo,
    issueNumber: String(issueNumber),
    backlogDir,
    wipDir: options.wipDir,
    cwd,
    issueCommentProgress,
    issuePrdLabel: options.issuePrdLabel,
  });
}

// ---------------------------------------------------------------------------
// PRD done detection
// ---------------------------------------------------------------------------

/**
 * Check whether ALL sub-issues of a PRD parent have reached the done state.
 *
 * Queries the native sub_issues REST API to get all sub-issues, then
 * checks each open sub-issue's labels. Returns true only when every
 * sub-issue is either closed OR has the done label.
 *
 * Best-effort: returns false on any API failure (fail-closed — we
 * won't prematurely mark a PRD as done).
 */
export function checkAllPrdSubIssuesDone(
  repo: string,
  prdNumber: number,
  cwd: string,
): boolean {
  // Fetch all sub-issues via the native REST API
  const subIssuesRaw = execQuiet(
    `gh api repos/${repo}/issues/${prdNumber}/sub_issues`,
    cwd,
  );

  if (subIssuesRaw === null) return false;

  let allSubIssues: Array<{ number: number; state: string }>;
  try {
    allSubIssues = JSON.parse(subIssuesRaw);
  } catch {
    return false;
  }

  if (!Array.isArray(allSubIssues) || allSubIssues.length === 0) return false;

  // Check each open sub-issue for the done label
  for (const si of allSubIssues) {
    // Closed sub-issues are considered done regardless of labels
    if (si.state !== "open") continue;

    const labelsRaw = execQuiet(
      `gh issue view ${si.number} --repo "${repo}" --json labels --jq '[.labels[].name] | join(",")'`,
      cwd,
    );
    const labels = labelsRaw ? labelsRaw.split(",") : [];
    if (!labels.includes(DONE_LABEL)) {
      return false;
    }
  }

  return true;
}

// ===========================================================================
// PRD discovery — fetch issue, check label, discover sub-issues
// ===========================================================================

/** A sub-issue object returned by the REST API. */
export interface PrdSubIssue {
  number: number;
  title: string;
  state: string;
  node_id: string;
}

/** Structured result when the issue IS a PRD. */
export interface PrdDiscoveryResultPrd {
  isPrd: true;
  prd: { number: number; title: string };
  /** Open sub-issue numbers (for backward compatibility). */
  subIssues: number[];
  /** Full sub-issue objects for open sub-issues. */
  subIssueDetails: PrdSubIssue[];
  /** True when all sub-issues are closed. */
  allCompleted: boolean;
  /** The raw PRD body. */
  body: string;
}

/** Structured result when the issue is NOT a PRD. */
export interface PrdDiscoveryResultIssue {
  isPrd: false;
  issue: { number: number; title: string; body: string };
}

export type PrdDiscoveryResult =
  | PrdDiscoveryResultPrd
  | PrdDiscoveryResultIssue;

/**
 * Fetch a GitHub issue by number and determine whether it is a PRD.
 *
 * - If the issue has the `ralphai-prd` label, fetches sub-issues via
 *   the REST API and returns a PRD result.
 * - If the issue does NOT have the label, returns a non-PRD result
 *   with the issue's number, title, and body.
 *
 * Throws a descriptive error if:
 * - `gh` CLI is not available or not authenticated
 * - the issue is not found or inaccessible
 * - the response cannot be parsed
 * - the sub-issues API call fails
 */
export function discoverPrdTarget(
  repo: string,
  issueNumber: number,
  cwd: string,
  prdLabel?: string,
): PrdDiscoveryResult {
  if (!checkGhAvailable()) {
    throw new Error(
      "gh CLI not available or not authenticated — cannot fetch issue",
    );
  }

  const raw = execQuiet(
    `gh issue view ${issueNumber} --repo "${repo}" --json title,body,labels`,
    cwd,
  );

  if (!raw) {
    throw new Error(
      `Could not fetch issue #${issueNumber} from ${repo}. ` +
        `Check that the issue exists and you have access.`,
    );
  }

  let data: { title: string; body: string; labels: Array<{ name: string }> };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse response for issue #${issueNumber} from ${repo}`,
    );
  }

  const hasLabel = data.labels.some(
    (l) => l.name === (prdLabel ?? DEFAULTS.prdLabel),
  );

  if (!hasLabel) {
    return {
      isPrd: false,
      issue: {
        number: issueNumber,
        title: data.title,
        body: data.body ?? "",
      },
    };
  }

  // It's a PRD — fetch sub-issues via the REST API
  const subIssuesRaw = execQuiet(
    `gh api repos/${repo}/issues/${issueNumber}/sub_issues`,
    cwd,
  );

  if (subIssuesRaw === null) {
    throw new Error(
      `Failed to fetch sub-issues for PRD #${issueNumber} from ${repo}. ` +
        `This may be a rate limit, auth failure, or network issue. ` +
        `Run "gh api repos/${repo}/issues/${issueNumber}/sub_issues" manually to diagnose.`,
    );
  }

  let allSubIssues: Array<{
    number: number;
    title: string;
    state: string;
    node_id: string;
  }>;
  try {
    allSubIssues = JSON.parse(subIssuesRaw);
  } catch {
    throw new Error(
      `Failed to parse sub-issues response for PRD #${issueNumber} from ${repo}`,
    );
  }

  if (!Array.isArray(allSubIssues)) {
    throw new Error(
      `Unexpected sub-issues response for PRD #${issueNumber} from ${repo} — expected an array`,
    );
  }

  const openSubIssues: PrdSubIssue[] = allSubIssues.filter(
    (si) => si.state === "open",
  );

  const allCompleted = allSubIssues.length > 0 && openSubIssues.length === 0;

  return {
    isPrd: true,
    prd: { number: issueNumber, title: data.title },
    subIssues: openSubIssues.map((si) => si.number),
    subIssueDetails: openSubIssues,
    allCompleted,
    body: data.body ?? "",
  };
}

// ===========================================================================
// HITL (human-in-the-loop) sub-issue helpers
// ===========================================================================

/** A sub-issue blocked by one or more HITL dependencies. */
export interface BlockedSubIssue {
  number: number;
  blockedBy: number[];
}

/** Data bag for the PRD HITL summary section. */
export interface PrdHitlSummaryInput {
  prdNumber: number;
  totalSubIssues: number;
  completedCount: number;
  stuckSubIssues: number[];
  hitlSubIssues: number[];
  blockedSubIssues: BlockedSubIssue[];
}

/**
 * Given a list of `depends-on` slugs (e.g. `["gh-42", "gh-50"]`) and a set
 * of HITL issue numbers, return the subset that are HITL blockers.
 *
 * Slugs must match the exact pattern `gh-<number>`.
 */
export function findHitlBlockers(
  deps: string[],
  hitlIssueNumbers: Set<number>,
): number[] {
  const blockers: number[] = [];
  for (const dep of deps) {
    const m = dep.match(/^gh-(\d+)$/);
    if (m) {
      const depNum = parseInt(m[1]!, 10);
      if (hitlIssueNumbers.has(depNum)) {
        blockers.push(depNum);
      }
    }
  }
  return blockers;
}

/**
 * Format the HITL-related lines for the PRD exit summary.
 * Returns an array of lines (without trailing newlines) to be printed.
 */
export function formatPrdHitlSummary(input: PrdHitlSummaryInput): string[] {
  const lines: string[] = [];

  lines.push("========================================");
  lines.push(`  PRD #${input.prdNumber} — summary`);
  lines.push("========================================");
  lines.push(
    `Completed: ${input.completedCount}/${input.totalSubIssues} sub-issue(s)`,
  );

  if (input.stuckSubIssues.length > 0) {
    lines.push(
      `Stuck/skipped: ${input.stuckSubIssues.map((n) => `#${n}`).join(", ")}`,
    );
  }

  if (input.hitlSubIssues.length > 0) {
    lines.push(
      `HITL (waiting on human): ${input.hitlSubIssues.map((n) => `#${n}`).join(", ")}`,
    );
  }

  if (input.blockedSubIssues.length > 0) {
    for (const b of input.blockedSubIssues) {
      lines.push(
        `Blocked by HITL: #${b.number} (depends on ${b.blockedBy.map((n) => `#${n}`).join(", ")})`,
      );
    }
  }

  return lines;
}

// ===========================================================================
// Reset labels — label restoration on plan reset
// ===========================================================================

// ---------------------------------------------------------------------------
// Reset types
// ---------------------------------------------------------------------------

export interface RestoreIssueLabelsOptions {
  /** Path to the plan .md file (must still exist on disk). */
  planPath: string;
  /** Configured issue repo (owner/repo), or "" to auto-detect from issue-url. */
  issueRepo: string;
  /** Working directory for gh CLI calls. */
  cwd: string;
}

export interface RestoreIssueLabelsResult {
  restored: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Reset internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract owner/repo from an issue URL.
 * e.g. "https://github.com/acme/widgets/issues/42" -> "acme/widgets"
 */
function repoFromUrl(issueUrl: string): string | null {
  const m = issueUrl.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\//);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Reset public API
// ---------------------------------------------------------------------------

/**
 * Restore labels on a GitHub issue when its plan is reset.
 *
 * Reads frontmatter from the plan file. If the plan is GitHub-sourced
 * (`source: github` with an issue number), calls `gh issue edit` to
 * remove the in-progress and stuck state labels (shared labels).
 * The family label is left untouched since it was never removed.
 *
 * Best-effort: failures are reported in the result but never thrown.
 */
export function restoreIssueLabels(
  options: RestoreIssueLabelsOptions,
): RestoreIssueLabelsResult {
  const { planPath, issueRepo, cwd } = options;

  // Read frontmatter to check if this is a GitHub-sourced plan
  const fm = extractIssueFrontmatter(planPath);

  if (fm.source !== "github" || !fm.issue) {
    return { restored: false, message: "not a GitHub-sourced plan" };
  }

  // Check gh CLI availability
  if (!checkGhAvailable()) {
    return {
      restored: false,
      message: "gh CLI not available — cannot restore issue labels",
    };
  }

  // Determine repo: prefer config, fall back to issue-url, then git remote
  let repo = issueRepo || null;
  if (!repo && fm.issueUrl) {
    repo = repoFromUrl(fm.issueUrl);
  }
  if (!repo) {
    return {
      restored: false,
      message: `Could not determine repo for issue #${fm.issue}`,
    };
  }

  // Remove shared state labels (in-progress and stuck).
  // The family label stays — it was never removed during pull.
  const transitionResult = transitionReset({ number: fm.issue, repo }, cwd);

  return {
    restored: transitionResult.ok,
    message: transitionResult.message,
  };
}
