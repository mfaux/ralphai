/**
 * GitHub Issues integration: pull issues as plan files, detect repos, slugify.
 *
 * Uses child_process.execSync for `gh` CLI calls, matching the sequential
 * nature of the runner loop. The `read_issue_frontmatter()` function is
 * already in frontmatter.ts.
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DEFAULTS } from "./config.ts";
import { deriveLabels } from "./labels.ts";
import { transitionPull, prdTransitionInProgress } from "./label-lifecycle.ts";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for pulling a GitHub issue into the backlog. */
export interface PullIssueOptions {
  /** The backlog directory where plan files are written. */
  backlogDir: string;
  /** Working directory (for git remote detection). */
  cwd: string;
  /** Configured issue source — must be "github" to proceed. */
  issueSource: string;
  /** Label to filter open issues by (e.g. "ralphai-standalone"). */
  standaloneLabel: string;
  /** Label applied when an issue is picked up (e.g. "ralphai-standalone:in-progress"). */
  standaloneInProgressLabel: string;
  /** Label applied when an issue is completed (e.g. "ralphai-standalone:done"). */
  standaloneDoneLabel: string;
  /** Label applied when an issue is stuck (e.g. "ralphai-standalone:stuck"). */
  standaloneStuckLabel?: string;
  /** Sub-issue intake label (e.g. "ralphai-subissue"). Used by pullPrdSubIssue(). */
  subissueLabel?: string;
  /** Sub-issue in-progress label (e.g. "ralphai-subissue:in-progress"). */
  subissueInProgressLabel?: string;
  /** Sub-issue done label (e.g. "ralphai-subissue:done"). */
  subissueDoneLabel?: string;
  /** Sub-issue stuck label (e.g. "ralphai-subissue:stuck"). */
  subissueStuckLabel?: string;
  /** Explicit owner/repo (empty = auto-detect from git remote). */
  issueRepo: string;
  /** Whether to post a progress comment on the issue. */
  issueCommentProgress: boolean;
  /** Label that marks an issue as a PRD (e.g. "ralphai-prd"). */
  issuePrdLabel?: string;
  /** Label applied to PRD parent when drain processing starts (e.g. "ralphai-prd:in-progress"). */
  issuePrdInProgressLabel?: string;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command and return trimmed stdout, or null on any error. */
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

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Check whether the `gh` CLI is installed and authenticated.
 * Returns true if both checks pass.
 */
export function checkGhAvailable(): boolean {
  try {
    execSync("gh --version", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return false;
  }
  try {
    execSync("gh auth status", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return false;
  }
  return true;
}

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
): string | null {
  if (configRepo && configRepo.length > 0) {
    return configRepo;
  }

  const url = execQuiet("git remote get-url origin", cwd);
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

/**
 * Convert a string to a filename-safe lowercase slug (max 60 chars).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
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
 * Generate a dependency slug for a GitHub issue number.
 * The slug follows the pattern `gh-{N}` and is used in `depends-on`
 * frontmatter to reference the plan file for that issue.
 */
export function issueDepSlug(issueNumber: number): string {
  return `gh-${issueNumber}`;
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

/**
 * Read-only check for open GitHub issues matching the configured label.
 *
 * This is safe for dry-run mode: it queries the GitHub API but never writes
 * files, edits labels, or posts comments.
 */
export function peekGithubIssues(options: PeekIssueOptions): PeekIssueResult {
  const { cwd, issueSource, standaloneLabel: issueLabel, issueRepo } = options;

  if (issueSource !== "github") {
    return { found: false, count: 0, message: "Issue source is not 'github'" };
  }

  if (!checkGhAvailable()) {
    return {
      found: false,
      count: 0,
      message:
        "gh CLI not available or not authenticated — skipping issue peek",
    };
  }

  const repo = detectIssueRepo(cwd, issueRepo);
  if (!repo) {
    return {
      found: false,
      count: 0,
      message: "Could not detect GitHub repo — skipping issue peek",
    };
  }

  // Fetch up to 100 matching issues (number + title) — read-only.
  const raw = execQuiet(
    `gh issue list --repo "${repo}" --label "${issueLabel}" --state open ` +
      `--limit 100 --json number,title`,
    cwd,
  );

  if (!raw) {
    return {
      found: false,
      count: 0,
      repo,
      message: `Could not list issues in ${repo}`,
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
      message: `Failed to parse issue list from ${repo}`,
    };
  }

  if (issues.length === 0) {
    return {
      found: false,
      count: 0,
      repo,
      message: `No open issues with label '${issueLabel}' in ${repo}`,
    };
  }

  // gh issue list returns newest first; last element is the oldest.
  // Length is guaranteed > 0 by the guard above.
  const oldest = issues[issues.length - 1]!;

  return {
    found: true,
    count: issues.length,
    oldest,
    repo,
    message:
      `${issues.length} GitHub issue(s) with label '${issueLabel}' in ${repo}` +
      ` (oldest: #${oldest.number} — ${oldest.title})`,
  };
}

/**
 * Read-only check for open PRD issues (configured PRD label).
 * Safe for dry-run mode.
 */
export function peekPrdIssues(options: PeekIssueOptions): PeekIssueResult {
  const { cwd, issueSource, issueRepo } = options;
  const prdLabel = options.issuePrdLabel ?? DEFAULTS.prdLabel;

  if (issueSource !== "github") {
    return { found: false, count: 0, message: "Issue source is not 'github'" };
  }

  if (!checkGhAvailable()) {
    return {
      found: false,
      count: 0,
      message: "gh CLI not available or not authenticated — skipping PRD peek",
    };
  }

  const repo = detectIssueRepo(cwd, issueRepo);
  if (!repo) {
    return {
      found: false,
      count: 0,
      message: "Could not detect GitHub repo — skipping PRD peek",
    };
  }

  const raw = execQuiet(
    `gh issue list --repo "${repo}" --label "${prdLabel}" --state open ` +
      `--limit 10 --json number,title`,
    cwd,
  );

  if (!raw) {
    return {
      found: false,
      count: 0,
      repo,
      message: `Could not list PRD issues in ${repo}`,
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
      message: `Failed to parse PRD issue list from ${repo}`,
    };
  }

  if (issues.length === 0) {
    return {
      found: false,
      count: 0,
      repo,
      message: `No open PRD issues with label '${prdLabel}' in ${repo}`,
    };
  }

  const oldest = issues[issues.length - 1]!;
  return {
    found: true,
    count: issues.length,
    oldest,
    repo,
    message:
      `${issues.length} PRD issue(s) with label '${prdLabel}' in ${repo}` +
      ` (oldest: #${oldest.number} — ${oldest.title})`,
  };
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
    // 404 (no parent) or network error — both non-fatal.
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

/** Result of fetching an issue with its labels. */
export interface IssueWithLabels {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

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

interface FetchAndWriteOptions {
  repo: string;
  issueNumber: string;
  backlogDir: string;
  cwd: string;
  standaloneInProgressLabel: string;
  standaloneLabel: string;
  issueCommentProgress: boolean;
  issuePrdLabel?: string;
}

/**
 * Fetch a single issue by number, write a plan file, swap labels, and
 * optionally post a progress comment. Shared by both pullGithubIssues()
 * and pullGithubIssueByNumber().
 */
function fetchAndWriteIssuePlan(opts: FetchAndWriteOptions): PullIssueResult {
  const {
    repo,
    issueNumber,
    backlogDir,
    cwd,
    standaloneInProgressLabel: issueInProgressLabel,
    standaloneLabel: issueLabel,
    issueCommentProgress,
  } = opts;

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

  // Update issue labels: add in-progress, remove intake label
  transitionPull(
    { number: Number(issueNumber), repo },
    issueLabel,
    issueInProgressLabel,
    cwd,
  );

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
    standaloneInProgressLabel: issueInProgressLabel,
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

  // Get the oldest open issue with the configured label.
  // gh issue list returns newest first; use jq 'last' to pick the oldest.
  const number = execQuiet(
    `gh issue list --repo "${repo}" --label "${issueLabel}" --state open ` +
      `--limit 100 --json number --jq 'if length == 0 then empty else last.number end'`,
    cwd,
  );

  if (!number) {
    return {
      pulled: false,
      message: `No open issues found with label '${issueLabel}' in ${repo}`,
    };
  }

  return fetchAndWriteIssuePlan({
    repo,
    issueNumber: number,
    backlogDir,
    cwd,
    standaloneInProgressLabel: issueInProgressLabel,
    standaloneLabel: issueLabel,
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

  // Sub-issues use the subissue label family when provided, falling back
  // to the standalone labels for backward compatibility.
  const subissueLabels = options.subissueLabel
    ? deriveLabels(options.subissueLabel)
    : null;
  const issueLabel = subissueLabels?.intake ?? options.standaloneLabel;
  const issueInProgressLabel =
    subissueLabels?.inProgress ?? options.standaloneInProgressLabel;
  const issueDoneLabel = subissueLabels?.done ?? options.standaloneDoneLabel;
  const issueStuckLabel = subissueLabels?.stuck ?? options.standaloneStuckLabel;

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
  const skipLabels = [issueInProgressLabel, issueDoneLabel];
  if (issueStuckLabel) skipLabels.push(issueStuckLabel);
  let subIssueNumber: number | undefined;
  for (const candidate of openSubIssues) {
    const labelsRaw = execQuiet(
      `gh issue view ${candidate.number} --repo "${repo}" --json labels --jq '[.labels[].name] | join(",")'`,
      cwd,
    );
    const labels = labelsRaw ? labelsRaw.split(",") : [];
    if (skipLabels.some((skip) => labels.includes(skip))) {
      continue;
    }
    subIssueNumber = candidate.number;
    break;
  }

  if (subIssueNumber === undefined) {
    return {
      pulled: false,
      message: `PRD #${prd.number} — all open sub-issues already in-progress or done`,
    };
  }

  console.log(
    `PRD #${prd.number} — pulling sub-issue #${subIssueNumber} into backlog`,
  );

  // Best-effort: mark the PRD parent as in-progress when we first pull a sub-issue.
  const prdInProgressLabel =
    options.issuePrdInProgressLabel ??
    deriveLabels(DEFAULTS.prdLabel).inProgress;
  prdTransitionInProgress(
    { number: prd.number, repo },
    prdInProgressLabel,
    cwd,
  );

  return fetchAndWriteIssuePlan({
    repo,
    issueNumber: String(subIssueNumber),
    backlogDir,
    cwd,
    standaloneInProgressLabel: issueInProgressLabel,
    standaloneLabel: issueLabel,
    issueCommentProgress,
    issuePrdLabel: options.issuePrdLabel,
  });
}

// ---------------------------------------------------------------------------
// PRD (Product Requirements Document) support
// ---------------------------------------------------------------------------

/** Minimal PRD data model threaded through the system. */
export interface PrdIssue {
  number: number;
  title: string;
}

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

/**
 * Derive a branch name from a PRD title: `feat/<slugify(title)>`.
 */
export function prdBranchName(title: string): string {
  return `feat/${slugify(title)}`;
}

// ---------------------------------------------------------------------------
// Fetch issue title (for branch naming, no plan file written)
// ---------------------------------------------------------------------------

/**
 * Fetch a GitHub issue by number and return its title.
 *
 * Used by `ralphai run <number>` to derive the `feat/<slug>` branch name
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
    standaloneLabel: issueLabel,
    standaloneInProgressLabel: issueInProgressLabel,
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
    cwd,
    standaloneInProgressLabel: issueInProgressLabel,
    standaloneLabel: issueLabel,
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
  subissueDoneLabel: string,
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
    if (!labels.includes(subissueDoneLabel)) {
      return false;
    }
  }

  return true;
}
