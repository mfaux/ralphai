/**
 * Dashboard actions — side-effect functions for running, resetting,
 * and purging plans from the dashboard.
 *
 * These spawn detached child processes (for run) or perform filesystem
 * operations (for reset/purge) so the dashboard remains responsive.
 */

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { getRepoPipelineDirs } from "../global-state.ts";
import { parseConfigFile, getConfigFilePath } from "../config.ts";
import {
  pullGithubIssues,
  pullGithubIssueByNumber,
  type PullIssueOptions,
} from "../issues.ts";

/**
 * Directory of this file at runtime. Uses `import.meta.url` which works
 * in both native ESM and bundled output (unlike `__dirname` which is
 * only available in CJS).
 */
const THIS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Find the project root by walking up from a starting directory
 * looking for package.json. Returns null if not found.
 */
export function findProjectRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the path to the ralphai CLI entry point.
 *
 * Anchors to the project root (nearest ancestor with package.json) so it
 * works both when running from source (THIS_DIR = src/dashboard/) and from
 * the bundle (THIS_DIR = dist/_chunks/ or dist/).
 */
export function resolveCliBin(): { command: string; args: string[] } {
  const root = findProjectRoot(THIS_DIR);

  if (root) {
    // Check for the built dist entry first (installed or after `bun run build`)
    const distCli = join(root, "dist", "cli.mjs");
    if (existsSync(distCli)) {
      return { command: "node", args: [distCli] };
    }

    // Fallback: use the source entry with --experimental-strip-types
    const srcCli = join(root, "src", "cli.ts");
    if (existsSync(srcCli)) {
      return {
        command: "node",
        args: ["--experimental-strip-types", srcCli],
      };
    }
  }

  // Last resort: assume `ralphai` is in PATH
  return { command: "ralphai", args: [] };
}

/**
 * Spawn a ralphai runner as a detached background process.
 * The process is unref'd so the dashboard can exit without killing it.
 *
 * @returns The spawned child's PID, or null on failure.
 */
export function spawnRunner(cwd: string, slug: string): number | null {
  try {
    const { command, args } = resolveCliBin();
    const child = spawn(command, [...args, "run", `--plan=${slug}`], {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

/**
 * Reset a single in-progress plan back to the backlog.
 * Moves the plan .md file back and deletes progress.md + receipt.txt.
 *
 * @returns true if the plan was successfully reset.
 */
export function resetPlan(cwd: string, slug: string): boolean {
  try {
    const { backlogDir, wipDir: inProgressDir } = getRepoPipelineDirs(cwd);
    const slugDir = join(inProgressDir, slug);

    if (!existsSync(slugDir)) return false;

    const planFile = join(slugDir, `${slug}.md`);
    const dest = join(backlogDir, `${slug}.md`);

    mkdirSync(backlogDir, { recursive: true });
    rmSync(join(slugDir, "progress.md"), { force: true });
    rmSync(join(slugDir, "receipt.txt"), { force: true });
    rmSync(join(slugDir, "runner.pid"), { force: true });

    if (existsSync(planFile)) {
      renameSync(planFile, dest);
    }

    rmSync(slugDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a running agent by PID. Uses signal-0 to verify the process
 * exists before sending SIGTERM. Cleans up the PID file on success
 * or if the process is already gone.
 *
 * @returns "stopped" | "already-exited" | "failed"
 */
export function stopRunner(
  pid: number,
  slugDir: string,
): "stopped" | "already-exited" | "failed" {
  const pidFile = join(slugDir, "runner.pid");
  try {
    // Signal 0: check if process exists (throws ESRCH if not)
    process.kill(pid, 0);
  } catch {
    // Process is gone — clean up stale PID file
    rmSync(pidFile, { force: true });
    return "already-exited";
  }

  try {
    process.kill(pid, "SIGTERM");
    // Don't delete PID file here — the runner will delete it on exit
    return "stopped";
  } catch {
    return "failed";
  }
}

/**
 * Purge a single completed plan from the archive.
 * Deletes the entire slug directory from pipeline/out/.
 *
 * @returns true if the plan was successfully purged.
 */
export function purgePlan(cwd: string, slug: string): boolean {
  try {
    const { archiveDir } = getRepoPipelineDirs(cwd);
    const slugDir = join(archiveDir, slug);

    if (!existsSync(slugDir)) return false;

    rmSync(slugDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a git worktree and its associated branch.
 *
 * Mirrors the logic in `cleanWorktrees()` (ralphai.ts):
 * 1. Prune stale worktree entries
 * 2. Force-remove the worktree directory
 * 3. Force-delete the branch (ralphai branches are typically unmerged)
 *
 * @returns true if the worktree was successfully removed.
 */
export function removeWorktree(
  cwd: string,
  worktreePath: string,
  branch: string,
): boolean {
  try {
    execSync("git worktree prune", { cwd, stdio: "pipe" });
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd,
      stdio: "pipe",
    });
    execSync(`git branch -D "${branch}"`, { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pull & run GitHub issues
// ---------------------------------------------------------------------------

/** Load issue-related config values for a repo. Returns null on failure. */
function loadPullIssueOptions(
  cwd: string,
): Omit<PullIssueOptions, "issueNumber"> | null {
  try {
    const configPath = getConfigFilePath(cwd);
    const parsed = parseConfigFile(configPath);
    if (!parsed) return null;
    const v = parsed.values;
    const { backlogDir } = getRepoPipelineDirs(cwd);
    return {
      backlogDir,
      cwd,
      issueSource: v.issueSource ?? "none",
      issueLabel: v.issueLabel ?? "ralphai",
      issueInProgressLabel: v.issueInProgressLabel ?? "ralphai:in-progress",
      issueRepo: v.issueRepo ?? "",
      issueCommentProgress: v.issueCommentProgress === "true",
    };
  } catch {
    return null;
  }
}

/** Extract the plan slug from a plan file path (e.g. "gh-42-my-plan"). */
function slugFromPlanPath(planPath: string): string {
  return basename(planPath, ".md");
}

/**
 * Pull a specific GitHub issue by number, then spawn a runner for it.
 *
 * @returns A result message for the toast.
 */
export function pullAndRunIssue(
  cwd: string,
  issueNumber: number,
): { ok: boolean; message: string } {
  const opts = loadPullIssueOptions(cwd);
  if (!opts) return { ok: false, message: "Could not load issue config" };

  const result = pullGithubIssueByNumber({ ...opts, issueNumber });
  if (!result.pulled || !result.planPath) {
    return { ok: false, message: result.message };
  }

  const slug = slugFromPlanPath(result.planPath);
  const pid = spawnRunner(cwd, slug);
  return pid
    ? {
        ok: true,
        message: `Pulled #${issueNumber} and started run (pid ${pid})`,
      }
    : {
        ok: false,
        message: `Pulled #${issueNumber} but failed to start runner`,
      };
}

/**
 * Pull the oldest open GitHub issue, then spawn a runner for it.
 *
 * @returns A result message for the toast.
 */
export function pullAndRunOldest(cwd: string): {
  ok: boolean;
  message: string;
} {
  const opts = loadPullIssueOptions(cwd);
  if (!opts) return { ok: false, message: "Could not load issue config" };

  const result = pullGithubIssues(opts);
  if (!result.pulled || !result.planPath) {
    return { ok: false, message: result.message };
  }

  const slug = slugFromPlanPath(result.planPath);
  const pid = spawnRunner(cwd, slug);
  return pid
    ? { ok: true, message: `${result.message} — started run (pid ${pid})` }
    : { ok: false, message: `${result.message} — failed to start runner` };
}
