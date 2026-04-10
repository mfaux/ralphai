import { existsSync, mkdirSync, rmSync, renameSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { execQuiet, execOk, execRun, execInherit } from "../exec.ts";
import { DIM, TEXT, RESET } from "../utils.ts";
import { getRepoPipelineDirs } from "../global-state.ts";
import { planExistsForSlug } from "../plan-detection.ts";
import { findPlansByBranch } from "../receipt.ts";
import {
  generateFeedbackWrapper,
  FEEDBACK_WRAPPER_FILENAME,
} from "../feedback-wrapper.ts";
import {
  buildSetupDockerArgs,
  formatDockerCommand,
} from "../executor/docker.ts";
import type { DockerExecutorConfig } from "../executor/docker.ts";
import { listRalphaiWorktrees } from "./parsing.ts";

/**
 * Configuration for routing the setup command through Docker.
 * When provided, the setup command runs inside a container instead of
 * on the host. Requires `agentCommand` to resolve the image and
 * credential allowlist.
 */
export interface SetupSandboxConfig {
  /** The sandbox mode ("none" or "docker"). */
  sandbox: "none" | "docker";
  /** The agent command string — used for image resolution and credential selection. */
  agentCommand: string;
  /** Docker-specific config (image, mounts, env vars). */
  dockerConfig?: DockerExecutorConfig;
  /**
   * Path to the main repo's `.git` directory for worktree support.
   * When set, the setup Docker container mounts this path so git
   * operations inside the container can resolve the worktree's
   * object store, refs, and config.
   */
  mainGitDir?: string;
}

export function isGitWorktree(dir: string): boolean {
  return resolveWorktreeInfo(dir).isWorktree;
}

/**
 * If `dir` is inside a git worktree, resolve to the main repository root
 * and print a dim info line. Otherwise return `dir` unchanged.
 */
export function resolveMainRepo(dir: string): string {
  const info = resolveWorktreeInfo(dir);
  if (info.isWorktree) {
    console.error(
      `${DIM}Detected worktree — using main repo at ${info.mainWorktree}${RESET}`,
    );
    return info.mainWorktree;
  }
  return dir;
}

export function resolveWorktreeInfo(dir: string): {
  isWorktree: boolean;
  mainWorktree: string;
} {
  try {
    const commonDir = execQuiet("git rev-parse --git-common-dir", dir);
    const gitDir = execQuiet("git rev-parse --git-dir", dir);
    if (commonDir != null && gitDir != null && commonDir !== gitDir) {
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
 * Resolve the main `.git` directory path for a given working directory.
 *
 * If `dir` is a git worktree, returns the absolute path to the main
 * repo's `.git` directory (e.g., `/path/to/main-repo/.git`).
 * Returns `undefined` for non-worktree directories.
 *
 * Used by the Docker executor and setup command to mount the main
 * `.git` directory into containers so git operations work in worktrees.
 */
export function resolveMainGitDir(dir: string): string | undefined {
  const info = resolveWorktreeInfo(dir);
  if (info.isWorktree) {
    return join(info.mainWorktree, ".git");
  }
  return undefined;
}

/**
 * Run a setup command inside a freshly-created worktree directory.
 * Called only when a new worktree is created (not reused).
 *
 * When `sandboxConfig.sandbox` is `"docker"`, the command runs inside a
 * Docker container with the worktree bind-mounted, using the same image,
 * env vars, and credential mounts as agent execution. This ensures
 * platform-specific binaries (e.g., native npm modules) match the
 * container's OS/arch.
 *
 * When `sandboxConfig` is omitted or `sandbox` is `"none"`, the command
 * runs on the host via `exec.ts` (unchanged behavior).
 *
 * On failure the process exits with code 1.
 */
export function executeSetupCommand(
  setupCommand: string,
  worktreeDir: string,
  sandboxConfig?: SetupSandboxConfig,
): void {
  if (!setupCommand) return;

  if (sandboxConfig?.sandbox === "docker") {
    console.log(`Running setup command in Docker: ${setupCommand}`);
    const mainGitDir =
      sandboxConfig.mainGitDir ?? resolveMainGitDir(worktreeDir);
    const dockerArgs = buildSetupDockerArgs({
      agentCommand: sandboxConfig.agentCommand,
      setupCommand,
      cwd: worktreeDir,
      dockerImage: sandboxConfig.dockerConfig?.dockerImage,
      dockerEnvVars: sandboxConfig.dockerConfig?.dockerEnvVars,
      dockerMounts: sandboxConfig.dockerConfig?.dockerMounts,
      mainGitDir,
    });
    const dockerCmd = formatDockerCommand(dockerArgs);
    const result = execInherit(dockerCmd, worktreeDir);
    if (result.exitCode !== 0) {
      console.error(
        `${TEXT}Error:${RESET} Setup command failed in Docker container: ${setupCommand}`,
      );
      console.error(
        `\nThe sandbox image may be missing tools your project needs.`,
      );
      console.error(
        `Use ${TEXT}--docker-image${RESET} to specify a custom image with your project's dependencies,`,
      );
      console.error(
        `or set ${TEXT}setupCommand${RESET} to "" in config to disable setup.`,
      );
      process.exit(1);
    }
    return;
  }

  console.log(`Running setup command: ${setupCommand}`);
  const result = execInherit(setupCommand, worktreeDir);
  if (result.exitCode !== 0) {
    console.error(
      `${TEXT}Error:${RESET} Setup command failed: ${setupCommand}`,
    );
    console.error(
      `\nFix the issue and re-run, or set ${TEXT}setupCommand${RESET} to "" in config to disable.`,
    );
    process.exit(1);
  }
}

/** Ensure the repo has at least one commit (required for worktrees). */
export function ensureRepoHasCommit(cwd: string): void {
  if (!execOk("git rev-parse HEAD", cwd)) {
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
 *
 * When `feedbackCommands` is provided (and not on Windows), a feedback
 * wrapper script is written to the worktree root after the setup command.
 * When `sandboxConfig` is provided with `sandbox: "docker"`, the setup
 * command runs inside a Docker container instead of on the host.
 *
 * NOTE: The feedback wrapper script is NOT written here. The runner
 * writes it to the WIP slug directory (pipeline state) so it stays
 * out of the user's worktree.
 */
export function prepareWorktree(
  cwd: string,
  slug: string,
  branch: string,
  baseBranch: string,
  setupCommand: string,
  sandboxConfig?: SetupSandboxConfig,
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
      execOk("git worktree prune", cwd);
      try {
        rmSync(resolvedWorktreeDir, { recursive: true, force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EACCES") {
          // Retry after fixing permissions (common with node_modules/.bin)
          try {
            execOk(`chmod -R u+rwx "${resolvedWorktreeDir}"`, cwd);
            rmSync(resolvedWorktreeDir, { recursive: true, force: true });
          } catch {
            throw new Error(
              `Could not remove orphaned worktree directory: ${resolvedWorktreeDir}\n` +
                `Fix manually:\n\n` +
                `  sudo rm -rf "${resolvedWorktreeDir}"\n`,
            );
          }
        } else {
          throw err;
        }
      }
    }

    const branchExists = execOk(
      `git show-ref --verify --quiet refs/heads/${branch}`,
      cwd,
    );

    const worktreeCmd = branchExists
      ? `git worktree add "${resolvedWorktreeDir}" "${branch}"`
      : `git worktree add "${resolvedWorktreeDir}" -b "${branch}" "${baseBranch}"`;

    if (branchExists) {
      console.log(`Recreating worktree: ${resolvedWorktreeDir}`);
      console.log(`Branch: ${branch}`);
    } else {
      console.log(`Creating worktree: ${resolvedWorktreeDir}`);
      console.log(`Branch: ${branch} (from ${baseBranch})`);
    }

    const addResult = execRun(worktreeCmd, cwd);
    if (addResult.exitCode !== 0) {
      console.error(`${TEXT}Error:${RESET} Failed to prepare worktree.`);
      if (addResult.stderr) console.error(`  git: ${addResult.stderr}`);
      process.exit(1);
    }
  }

  // Run setup command in freshly-created worktrees (not reused ones)
  if (!activeWorktree) {
    executeSetupCommand(setupCommand, resolvedWorktreeDir, sandboxConfig);
  }

  return resolvedWorktreeDir;
}

/**
 * Write the feedback wrapper script to the given directory.
 * Typically called with the WIP slug directory so the script stays
 * out of the user's worktree (no untracked-file noise in git status).
 * Skipped on Windows (process.platform === "win32") and when no
 * feedback commands are configured.
 */
export function writeFeedbackWrapper(
  targetDir: string,
  feedbackCommands?: string[],
): void {
  if (process.platform === "win32") return;
  if (!feedbackCommands || feedbackCommands.length === 0) return;

  const script = generateFeedbackWrapper(feedbackCommands);
  const wrapperPath = join(targetDir, FEEDBACK_WRAPPER_FILENAME);
  writeFileSync(wrapperPath, script, { mode: 0o755 });
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
  execInherit("git worktree prune", cwd);

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
      matchedSlugs = [slug];
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
        execInherit(`git worktree remove --force "${wt.path}"`, cwd);
        // Force-delete branch (-D) because ralphai/* branches are typically
        // not merged to main yet. Non-force -d would silently fail, leaving
        // stale branches that cause dirty-state errors on the next run.
        execOk(`git branch -D "${wt.branch}"`, cwd);

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
