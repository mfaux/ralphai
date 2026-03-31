/**
 * Worktree loading and parsing for the dashboard.
 */

import { execSync } from "child_process";
import type { PlanInfo, WorktreeInfo } from "../types.ts";
import { execAsync } from "./shared.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawWorktreeEntry {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse the porcelain output of `git worktree list --porcelain`.
 */
export function parseWorktreeList(output: string): RawWorktreeEntry[] {
  const entries: RawWorktreeEntry[] = [];
  let current: Partial<RawWorktreeEntry> = {};

  for (const line of output.split("\n")) {
    if (line === "") {
      if (current.path) {
        entries.push({
          path: current.path,
          branch: current.branch ?? "",
          head: current.head ?? "",
          bare: current.bare ?? false,
        });
      }
      current = {};
    } else if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.bare = true;
    }
  }

  // Handle last entry if no trailing newline
  if (current.path) {
    entries.push({
      path: current.path,
      branch: current.branch ?? "",
      head: current.head ?? "",
      bare: current.bare ?? false,
    });
  }

  return entries;
}

/**
 * Check whether a branch is managed by ralphai (ralphai/* or feat/*).
 */
export function isRalphaiManagedBranch(branch: string): boolean {
  return branch.startsWith("ralphai/") || branch.startsWith("feat/");
}

/**
 * Enrich raw worktree entries with status and linked plan data.
 */
export function enrichWorktrees(
  raw: RawWorktreeEntry[],
  plans: PlanInfo[],
): WorktreeInfo[] {
  const activeSlugs = new Set(
    plans.filter((p) => p.state === "in-progress").map((p) => p.slug),
  );

  return raw.map((wt) => {
    // For ralphai/ branches, strip the prefix to get the slug.
    // For feat/ branches, keep the full branch name as shortBranch
    // and rely on receipt-based plan matching.
    const shortBranch = wt.branch.startsWith("ralphai/")
      ? wt.branch.replace(/^ralphai\//, "")
      : wt.branch;
    const linkedPlan = plans.find(
      (p) => p.branch === wt.branch || p.slug === shortBranch,
    );

    // For feat/ branches, check if any in-progress plan references this branch
    const isActive = wt.branch.startsWith("ralphai/")
      ? activeSlugs.has(shortBranch)
      : plans.some((p) => p.state === "in-progress" && p.branch === wt.branch);

    return {
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      bare: wt.bare,
      shortBranch,
      status: isActive ? ("active" as const) : ("idle" as const),
      linkedPlan: linkedPlan?.slug,
    };
  });
}

// ---------------------------------------------------------------------------
// Sync loader
// ---------------------------------------------------------------------------

/**
 * Load worktrees for a repo, filtered to ralphai-managed branches.
 * Returns enriched WorktreeInfo with status and linked plan data.
 */
export function loadWorktrees(cwd: string, plans?: PlanInfo[]): WorktreeInfo[] {
  let output: string;
  try {
    output = execSync("git worktree list --porcelain", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return [];
  }

  const raw = parseWorktreeList(output).filter((wt) =>
    isRalphaiManagedBranch(wt.branch),
  );

  return enrichWorktrees(raw, plans ?? []);
}

// ---------------------------------------------------------------------------
// Async loader
// ---------------------------------------------------------------------------

/**
 * Async version of loadWorktrees. Uses child_process.exec (callback-based,
 * wrapped in a Promise) instead of execSync, so the git subprocess runs
 * without blocking the event loop.
 */
export async function loadWorktreesAsync(
  cwd: string,
  plans?: PlanInfo[],
): Promise<WorktreeInfo[]> {
  let output: string;
  try {
    output = await execAsync("git worktree list --porcelain", cwd);
  } catch {
    return [];
  }

  const raw = parseWorktreeList(output).filter((wt) =>
    isRalphaiManagedBranch(wt.branch),
  );

  return enrichWorktrees(raw, plans ?? []);
}
