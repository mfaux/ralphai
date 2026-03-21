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
  /** Label to filter open issues by (e.g. "ralphai"). */
  issueLabel: string;
  /** Label applied when an issue is picked up (e.g. "ralphai:in-progress"). */
  issueInProgressLabel: string;
  /** Explicit owner/repo (empty = auto-detect from git remote). */
  issueRepo: string;
  /** Whether to post a progress comment on the issue. */
  issueCommentProgress: boolean;
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

  // Handle SSH: git@github.com:owner/repo.git
  // Handle HTTPS: https://github.com/owner/repo.git
  const cleaned = url
    .replace(/^(?:git@|https:\/\/)github\.com[:/]/, "")
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
    issueLabel,
    issueInProgressLabel,
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

  // Fetch full issue details
  const title = execQuiet(
    `gh issue view ${number} --repo "${repo}" --json title --jq '.title'`,
    cwd,
  );
  const body = execQuiet(
    `gh issue view ${number} --repo "${repo}" --json body --jq '.body'`,
    cwd,
  );
  const url = execQuiet(
    `gh issue view ${number} --repo "${repo}" --json url --jq '.url'`,
    cwd,
  );

  if (!title) {
    return {
      pulled: false,
      message: `Failed to fetch details for issue #${number}`,
    };
  }

  const slug = slugify(title);
  const filename = `gh-${number}-${slug}.md`;
  const planPath = join(backlogDir, filename);

  // Write plan file with frontmatter
  if (!existsSync(backlogDir)) {
    mkdirSync(backlogDir, { recursive: true });
  }

  const planContent = `---\nsource: github\nissue: ${number}\nissue-url: ${url ?? ""}\n---\n\n# ${title}\n\n${body ?? ""}\n`;
  writeFileSync(planPath, planContent, "utf-8");

  // Update issue labels: add in-progress, remove intake label
  execQuiet(
    `gh issue edit ${number} --repo "${repo}" ` +
      `--add-label "${issueInProgressLabel}" --remove-label "${issueLabel}"`,
    cwd,
  );

  // Optionally post a progress comment
  if (issueCommentProgress) {
    execQuiet(
      `gh issue comment ${number} --repo "${repo}" ` +
        `--body "Ralphai picked up this issue and created a plan file. Working on it now."`,
      cwd,
    );
  }

  return {
    pulled: true,
    planPath,
    message: `Pulled GitHub issue #${number}: ${title} → ${filename}`,
  };
}
