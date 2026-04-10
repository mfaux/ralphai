/**
 * clean command — unified cleanup for archived plans and orphaned worktrees.
 *
 * Replaces `ralphai purge` and `ralphai worktree clean` with a single verb.
 *
 *   ralphai clean             — clean both archived plans and orphaned worktrees
 *   ralphai clean --worktrees — clean only orphaned worktrees
 *   ralphai clean --archive   — clean only archived plans
 *   ralphai clean -y          — skip confirmation prompt
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "fs";
import { join } from "path";
import * as clack from "@clack/prompts";
import { RESET, DIM, TEXT } from "./utils.ts";
import { getConfigFilePath } from "./config.ts";
import {
  getRepoPipelineDirs,
  planPathForSlug,
  planExistsForSlug,
  findPlansByBranch,
} from "./plan-lifecycle.ts";
import { listRalphaiWorktrees } from "./worktree/index.ts";

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function showCleanHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai clean [options]`);
  console.log();
  console.log(`${DIM}Remove archived plans and orphaned worktrees.${RESET}`);
  console.log(
    `${DIM}By default both are cleaned. Use flags to scope to one type.${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--worktrees${RESET}  ${DIM}Clean only orphaned worktrees${RESET}`,
  );
  console.log(
    `  ${TEXT}--archive${RESET}   ${DIM}Clean only archived plans${RESET}`,
  );
  console.log(
    `  ${TEXT}--yes, -y${RESET}   ${DIM}Skip confirmation prompt${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CleanOptions {
  cwd: string;
  yes: boolean;
  worktrees: boolean;
  archive: boolean;
}

export interface ArchiveSummary {
  planDirCount: number;
  planFiles: number;
  progressFiles: number;
  receiptFiles: number;
}

// ---------------------------------------------------------------------------
// Archive (purge) cleanup
// ---------------------------------------------------------------------------

export function scanArchive(archiveDir: string): ArchiveSummary | null {
  if (!existsSync(archiveDir)) return null;

  const entries = readdirSync(archiveDir, { withFileTypes: true });
  const planDirs = entries.filter((e) => e.isDirectory());
  if (planDirs.length === 0) return null;

  const planFiles = planDirs.filter((e) => {
    const planPath = planPathForSlug(archiveDir, e.name);
    return existsSync(planPath);
  }).length;
  const progressFiles = planDirs.filter((e) =>
    existsSync(join(archiveDir, e.name, "progress.md")),
  ).length;
  const receiptFiles = planDirs.filter((e) =>
    existsSync(join(archiveDir, e.name, "receipt.txt")),
  ).length;

  return {
    planDirCount: planDirs.length,
    planFiles,
    progressFiles,
    receiptFiles,
  };
}

export function deleteArchive(archiveDir: string): void {
  const entries = readdirSync(archiveDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      rmSync(join(archiveDir, entry.name), { recursive: true, force: true });
    }
  }
}

function printArchiveSummary(label: string, summary: ArchiveSummary): void {
  if (summary.planFiles > 0) {
    console.log(
      `  ${TEXT}Plans${RESET}       ${DIM}${summary.planFiles} archived plan${summary.planFiles !== 1 ? "s" : ""}${RESET}`,
    );
  }
  if (summary.progressFiles > 0) {
    console.log(
      `  ${TEXT}Progress${RESET}    ${DIM}${summary.progressFiles} progress file${summary.progressFiles !== 1 ? "s" : ""}${RESET}`,
    );
  }
  if (summary.receiptFiles > 0) {
    console.log(
      `  ${TEXT}Receipts${RESET}    ${DIM}${summary.receiptFiles} receipt${summary.receiptFiles !== 1 ? "s" : ""}${RESET}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Worktree cleanup
// ---------------------------------------------------------------------------

export interface WorktreeCleanResult {
  orphanCount: number;
  cleaned: number;
}

/**
 * Count orphaned worktrees without any side effects.
 *
 * Used by the TUI to show a preview before confirmation.
 * Returns 0 if not in a git repo or git is unavailable.
 */
export function countOrphanedWorktrees(cwd: string): number {
  try {
    const worktrees = listRalphaiWorktrees(cwd);
    const { wipDir: inProgressDir } = getRepoPipelineDirs(cwd);
    let count = 0;
    for (const wt of worktrees) {
      let hasActivePlan: boolean;
      if (wt.branch.startsWith("ralphai/")) {
        const slug = wt.branch.replace("ralphai/", "");
        hasActivePlan = planExistsForSlug(inProgressDir, slug);
      } else {
        hasActivePlan = findPlansByBranch(inProgressDir, wt.branch).length > 0;
      }
      if (!hasActivePlan) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

export function cleanOrphanedWorktrees(cwd: string): WorktreeCleanResult {
  // Prune stale worktree entries first
  execSync("git worktree prune", { cwd, stdio: "inherit" });

  const worktrees = listRalphaiWorktrees(cwd);
  if (worktrees.length === 0) {
    return { orphanCount: 0, cleaned: 0 };
  }

  const { wipDir: inProgressDir, archiveDir } = getRepoPipelineDirs(cwd);
  let orphanCount = 0;
  let cleaned = 0;

  for (const wt of worktrees) {
    let hasActivePlan: boolean;
    let matchedSlugs: string[];

    if (wt.branch.startsWith("ralphai/")) {
      const slug = wt.branch.replace("ralphai/", "");
      hasActivePlan = planExistsForSlug(inProgressDir, slug);
      matchedSlugs = [slug];
    } else {
      // feat/ or other managed branches: use receipt-based lookup
      matchedSlugs = findPlansByBranch(inProgressDir, wt.branch);
      hasActivePlan = matchedSlugs.length > 0;
    }

    if (!hasActivePlan) {
      orphanCount++;
      console.log(`Removing: ${wt.path} (${wt.branch})`);
      try {
        execSync(`git worktree remove --force "${wt.path}"`, {
          cwd,
          stdio: "inherit",
        });
        try {
          execSync(`git branch -D "${wt.branch}"`, {
            cwd,
            stdio: "pipe",
          });
        } catch {
          // Branch deletion failure is not critical
        }

        // Archive receipts for matched slugs
        for (const slug of matchedSlugs) {
          const planDir = join(inProgressDir, slug);
          const receiptFile = join(planDir, "receipt.txt");
          if (existsSync(receiptFile)) {
            const destDir = join(archiveDir, slug);
            mkdirSync(destDir, { recursive: true });
            const dest = join(destDir, "receipt.txt");
            renameSync(receiptFile, dest);
            console.log(`  Archived receipt: ${slug}/receipt.txt`);
          }
        }

        cleaned++;
      } catch {
        console.log(`  Warning: Could not remove ${wt.path}. Remove manually.`);
      }
    } else {
      console.log(
        `Keeping: ${wt.path} (${wt.branch}) — plan still in progress`,
      );
    }
  }

  return { orphanCount, cleaned };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function runClean(options: CleanOptions): Promise<void> {
  const { cwd, yes } = options;

  // Guard: config must exist
  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  // Determine scope: default is both
  const cleanArchive = !options.worktrees || options.archive;
  const cleanWorktrees = !options.archive || options.worktrees;

  // --- Scan for work ---
  const { archiveDir } = getRepoPipelineDirs(cwd);
  const archiveSummary = cleanArchive ? scanArchive(archiveDir) : null;

  // For worktrees we only count — actual removal happens after confirmation.
  // We can't easily scan without prune side-effects, so we list them cheaply.
  let worktreeCount = 0;
  if (cleanWorktrees) {
    worktreeCount = countOrphanedWorktrees(cwd);
  }

  // Nothing to clean?
  if (!archiveSummary && worktreeCount === 0) {
    console.log("Nothing to clean.");
    return;
  }

  // --- Show what will be cleaned ---
  console.log();
  console.log(`${TEXT}The following will be cleaned:${RESET}`);
  console.log();
  if (archiveSummary) {
    printArchiveSummary("Archive", archiveSummary);
  }
  if (worktreeCount > 0) {
    console.log(
      `  ${TEXT}Worktrees${RESET}   ${DIM}${worktreeCount} orphaned worktree${worktreeCount !== 1 ? "s" : ""}${RESET}`,
    );
  }
  console.log();

  // --- Confirm ---
  if (!yes) {
    clack.intro("Ralphai Clean");
    const confirmed = await clack.confirm({
      message: "Proceed with cleanup? This cannot be undone.",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Clean cancelled.");
      return;
    }
  }

  // --- Execute ---
  if (archiveSummary) {
    deleteArchive(archiveDir);
  }

  let worktreeResult: WorktreeCleanResult | null = null;
  if (cleanWorktrees && worktreeCount > 0) {
    worktreeResult = cleanOrphanedWorktrees(cwd);
  }

  // --- Summary ---
  console.log(`${TEXT}Cleaned.${RESET}`);
  console.log();
  console.log(`${DIM}Deleted:${RESET}`);
  if (archiveSummary) {
    if (archiveSummary.planFiles > 0) {
      console.log(
        `  ${archiveSummary.planFiles} archived plan${archiveSummary.planFiles !== 1 ? "s" : ""}`,
      );
    }
    if (archiveSummary.progressFiles > 0) {
      console.log(
        `  ${archiveSummary.progressFiles} progress file${archiveSummary.progressFiles !== 1 ? "s" : ""}`,
      );
    }
    if (archiveSummary.receiptFiles > 0) {
      console.log(
        `  ${archiveSummary.receiptFiles} receipt${archiveSummary.receiptFiles !== 1 ? "s" : ""}`,
      );
    }
  }
  if (worktreeResult && worktreeResult.cleaned > 0) {
    console.log(
      `  ${worktreeResult.cleaned} worktree${worktreeResult.cleaned !== 1 ? "s" : ""}`,
    );
  }
  console.log();
}
