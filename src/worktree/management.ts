import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync, renameSync } from "fs";
import { join, resolve } from "path";
import { TEXT, RESET } from "../utils.ts";
import { getRepoPipelineDirs } from "../global-state.ts";
import { planExistsForSlug } from "../plan-detection.ts";
import { findPlansByBranch } from "../receipt.ts";
import { extractExecStderr } from "../git-helpers.ts";
import type { RalphaiOptions } from "../parse-options.ts";
import { listRalphaiWorktrees } from "./parsing.ts";

export function isGitWorktree(dir: string): boolean {
  try {
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    // In a worktree, --git-common-dir points to the main repo's .git
    // while --git-dir points to .git/worktrees/<name>
    return commonDir !== gitDir;
  } catch {
    return false;
  }
}

export function resolveWorktreeInfo(dir: string): {
  isWorktree: boolean;
  mainWorktree: string;
} {
  try {
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    if (commonDir !== gitDir) {
      // In a worktree: --git-common-dir points to the main .git
      const mainRoot = resolve(dir, commonDir, "..");
      return { isWorktree: true, mainWorktree: mainRoot };
    }
  } catch {
    // Not in a git repo or git not available
  }
  return { isWorktree: false, mainWorktree: "" };
}

/**
 * Run a setup command inside a freshly-created worktree directory.
 * Called only when a new worktree is created (not reused).
 * On failure the process exits with code 1.
 */
export function executeSetupCommand(
  setupCommand: string,
  worktreeDir: string,
): void {
  if (!setupCommand) return;
  console.log(`Running setup command: ${setupCommand}`);
  try {
    execSync(setupCommand, {
      cwd: worktreeDir,
      stdio: "inherit",
    });
  } catch (err: unknown) {
    const stderr = extractExecStderr(err);
    console.error(
      `${TEXT}Error:${RESET} Setup command failed: ${setupCommand}`,
    );
    if (stderr) console.error(`  ${stderr}`);
    console.error(
      `\nFix the issue and re-run, or set ${TEXT}setupCommand${RESET} to "" in config to disable.`,
    );
    process.exit(1);
  }
}

/** Ensure the repo has at least one commit (required for worktrees). */
export function ensureRepoHasCommit(cwd: string): void {
  try {
    execSync("git rev-parse HEAD", { cwd, stdio: "ignore" });
  } catch {
    console.error(
      "This repository has no commits yet. Git worktrees require at least one commit.",
    );
    console.error(
      `\n  ${TEXT}git add . && git commit -m "initial commit"${RESET}`,
    );
    console.error(`\nThen re-run ${TEXT}ralphai run${RESET}.`);
    process.exit(1);
  }
}

/**
 * Create or reuse a worktree for a given slug/branch.
 * Returns the resolved worktree directory path.
 */
export function prepareWorktree(
  cwd: string,
  slug: string,
  branch: string,
  baseBranch: string,
  setupCommand: string,
): string {
  const worktreeBase = join(cwd, "..", ".ralphai-worktrees");
  const desiredWorktreeDir = join(worktreeBase, slug);
  mkdirSync(worktreeBase, { recursive: true });

  const activeWorktrees = listRalphaiWorktrees(cwd);
  const activeWorktree = activeWorktrees.find((wt) => wt.branch === branch);

  let resolvedWorktreeDir = desiredWorktreeDir;
  if (activeWorktree) {
    resolvedWorktreeDir = activeWorktree.path;
    console.log(`Reusing existing worktree: ${resolvedWorktreeDir}`);
    console.log(`Branch: ${branch}`);
  } else {
    if (existsSync(resolvedWorktreeDir)) {
      console.log(
        `Cleaning up orphaned worktree directory: ${resolvedWorktreeDir}`,
      );
      execSync("git worktree prune", { cwd, stdio: "ignore" });
      rmSync(resolvedWorktreeDir, { recursive: true, force: true });
    }

    let branchExists = false;
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
        cwd,
        stdio: "ignore",
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    try {
      if (branchExists) {
        console.log(`Recreating worktree: ${resolvedWorktreeDir}`);
        console.log(`Branch: ${branch}`);
        execSync(`git worktree add "${resolvedWorktreeDir}" "${branch}"`, {
          cwd,
          stdio: ["inherit", "pipe", "pipe"],
        });
      } else {
        console.log(`Creating worktree: ${resolvedWorktreeDir}`);
        console.log(`Branch: ${branch} (from ${baseBranch})`);
        execSync(
          `git worktree add "${resolvedWorktreeDir}" -b "${branch}" "${baseBranch}"`,
          { cwd, stdio: ["inherit", "pipe", "pipe"] },
        );
      }
    } catch (err: unknown) {
      const stderr = extractExecStderr(err);
      console.error(`${TEXT}Error:${RESET} Failed to prepare worktree.`);
      if (stderr) console.error(`  git: ${stderr}`);
      process.exit(1);
    }
  }

  // Run setup command in freshly-created worktrees (not reused ones)
  if (!activeWorktree) {
    executeSetupCommand(setupCommand, resolvedWorktreeDir);
  }

  return resolvedWorktreeDir;
}

export function listWorktrees(cwd: string): void {
  const worktrees = listRalphaiWorktrees(cwd);

  if (worktrees.length === 0) {
    console.log("No active ralphai worktrees.");
    return;
  }

  console.log("Active ralphai worktrees:\n");
  const { wipDir: inProgressDir } = getRepoPipelineDirs(cwd);
  for (const wt of worktrees) {
    let hasActivePlan: boolean;
    if (wt.branch.startsWith("ralphai/")) {
      const slug = wt.branch.replace("ralphai/", "");
      hasActivePlan = planExistsForSlug(inProgressDir, slug);
    } else {
      // feat/ or other managed branches: use receipt-based lookup
      hasActivePlan = findPlansByBranch(inProgressDir, wt.branch).length > 0;
    }
    const status = hasActivePlan ? "in-progress" : "idle";
    console.log(`  ${wt.branch}  ${wt.path}  [${status}]`);
  }
}

export function cleanWorktrees(cwd: string): void {
  // Prune stale worktree entries first
  execSync("git worktree prune", { cwd, stdio: "inherit" });

  const worktrees = listRalphaiWorktrees(cwd);

  if (worktrees.length === 0) {
    console.log("No ralphai worktrees to clean.");
    return;
  }

  const { wipDir: inProgressDir, archiveDir } = getRepoPipelineDirs(cwd);
  let cleaned = 0;

  for (const wt of worktrees) {
    let hasActivePlan: boolean;
    let matchedSlugs: string[];

    if (wt.branch.startsWith("ralphai/")) {
      const slug = wt.branch.replace("ralphai/", "");
      hasActivePlan = planExistsForSlug(inProgressDir, slug);
      matchedSlugs = hasActivePlan ? [slug] : [slug]; // always try archiving the slug
    } else {
      // feat/ or other managed branches: use receipt-based lookup
      matchedSlugs = findPlansByBranch(inProgressDir, wt.branch);
      hasActivePlan = matchedSlugs.length > 0;
    }

    if (!hasActivePlan) {
      console.log(`Removing: ${wt.path} (${wt.branch})`);
      try {
        // Use --force because the worktree may have uncommitted changes
        // from interrupted agent work.
        execSync(`git worktree remove --force "${wt.path}"`, {
          cwd,
          stdio: "inherit",
        });
        // Force-delete branch (-D) because ralphai/* branches are typically
        // not merged to main yet. Non-force -d would silently fail, leaving
        // stale branches that cause dirty-state errors on the next run.
        try {
          execSync(`git branch -D "${wt.branch}"`, {
            cwd,
            stdio: "pipe",
          });
        } catch {
          // Branch deletion failure is not critical
        }

        // Archive receipts for matched slugs (ralphai/ has one slug,
        // feat/ may have multiple from receipt scan)
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

  console.log(`\nCleaned ${cleaned} worktree(s).`);
}

export async function runRalphaiWorktree(
  options: RalphaiOptions,
  cwd: string,
  showHelp: () => void,
): Promise<void> {
  const wtOpts = options.worktreeOptions ?? {
    subcommand: "run",
    runArgs: [],
  };

  // Handle --help
  if (wtOpts.runArgs.includes("--help") || wtOpts.runArgs.includes("-h")) {
    showHelp();
    return;
  }

  // Dispatch worktree sub-subcommands
  switch (wtOpts.subcommand) {
    case "list":
      listWorktrees(cwd);
      return;
    case "clean":
      cleanWorktrees(cwd);
      return;
    case "run":
      console.error("'ralphai worktree' no longer starts runs.");
      console.error(
        "Use 'ralphai run' to create or reuse a worktree and execute work.",
      );
      process.exit(1);
  }
}
