/**
 * Git helpers: dirty-state detection, branch collision, preflight checks.
 *
 * Uses child_process.execSync for git commands, matching the sequential
 * nature of the runner loop.
 */
import { createHash } from "crypto";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollisionResult {
  /** True if a collision was detected. */
  collision: boolean;
  /** Human-readable explanation (empty when no collision). */
  reason: string;
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

/** Run a command, returning true if it exits 0. */
function execOk(cmd: string, cwd: string): boolean {
  try {
    execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/** Check whether the `gh` CLI is available on PATH. */
function ghAvailable(): boolean {
  try {
    execSync("gh --version", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Check if the working tree has uncommitted changes.
 *
 * Returns true if the tree is dirty, false if clean.
 */
export function isTreeDirty(cwd: string): boolean {
  // 1. Unstaged changes
  if (!execOk("git diff --quiet HEAD", cwd)) {
    return true;
  }

  // 2. Staged changes
  if (!execOk("git diff --cached --quiet", cwd)) {
    return true;
  }

  // 3. Untracked files
  const untracked = execQuiet("git ls-files --others --exclude-standard", cwd);
  if (untracked && untracked.length > 0) {
    return true;
  }

  return false;
}

/**
 * Detect whether a branch already has open work (local branch, remote
 * branch, or open PR). Used to prevent branch/PR collisions when starting
 * a new plan.
 */
export function branchHasOpenWork(
  branch: string,
  cwd: string,
): CollisionResult {
  const hasGh = ghAvailable();

  // Helper: look up an open PR number for this branch
  const findPrNumber = (): string | null => {
    if (!hasGh) return null;
    const result = execQuiet(
      `gh pr list --head "${branch}" --state open --json number --jq '.[0].number'`,
      cwd,
    );
    return result && result.length > 0 ? result : null;
  };

  // 1. Local branch exists
  if (execOk(`git show-ref --verify --quiet "refs/heads/${branch}"`, cwd)) {
    const prNum = findPrNumber();
    if (prNum) {
      return {
        collision: true,
        reason: `Local branch '${branch}' exists with open PR #${prNum}`,
      };
    }
    return {
      collision: true,
      reason: `Local branch '${branch}' already exists`,
    };
  }

  // 2. Remote branch exists (local may have been deleted)
  if (
    execOk(`git show-ref --verify --quiet "refs/remotes/origin/${branch}"`, cwd)
  ) {
    const prNum = findPrNumber();
    if (prNum) {
      return {
        collision: true,
        reason: `Remote branch '${branch}' exists with open PR #${prNum}`,
      };
    }
    return {
      collision: true,
      reason: `Remote branch 'origin/${branch}' exists (possibly from a previous run)`,
    };
  }

  // 3. No branches found, but check for open PR (edge case: branches deleted,
  //    PR still open)
  if (hasGh) {
    const prNum = findPrNumber();
    if (prNum) {
      return {
        collision: true,
        reason: `Open PR #${prNum} exists for branch '${branch}'`,
      };
    }
  }

  return { collision: false, reason: "" };
}

/**
 * Verify that the `gh` CLI is installed and authenticated.
 * Returns an error message string, or null if everything is OK.
 */
export function validateGhCli(cwd: string): string | null {
  if (!ghAvailable()) {
    return (
      "PR mode requires the GitHub CLI (gh).\n" +
      "Install it: https://cli.github.com\n" +
      "Or use --branch to create a branch without pushing or creating a PR."
    );
  }

  if (!execOk("gh auth status", cwd)) {
    return (
      "gh is installed but not authenticated.\n" +
      "Run 'gh auth login' first, or use --branch to skip PR creation."
    );
  }

  return null;
}

/**
 * Verify that a branch exists locally.
 * Returns an error message string, or null if it exists.
 */
export function validateBaseBranch(
  baseBranch: string,
  cwd: string,
): string | null {
  if (
    !execOk(`git show-ref --verify --quiet "refs/heads/${baseBranch}"`, cwd)
  ) {
    return `Base branch '${baseBranch}' not found.`;
  }
  return null;
}

/**
 * Return the current HEAD commit hash (full SHA).
 */
export function getCurrentCommitHash(cwd: string): string | null {
  return execQuiet("git rev-parse HEAD", cwd);
}

/**
 * Compute a hash of the current working-tree diff against HEAD.
 * Used for stuck detection in patch mode, where commits are not created.
 */
export function getWorkingTreeDiffHash(cwd: string): string {
  const diff = execQuiet("git diff HEAD", cwd) ?? "";
  return createHash("sha256").update(diff).digest("hex");
}
