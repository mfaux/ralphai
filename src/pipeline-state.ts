/**
 * Pipeline state module.
 *
 * Provides a pure data-gathering function (`gatherPipelineState`) that
 * aggregates plan, receipt, worktree, and liveness data into a typed
 * `PipelineState` structure. No console output or side effects beyond
 * filesystem reads.
 *
 * This module is the foundation for both `ralphai status` rendering and
 * the interactive mode's context-aware menu.
 */

import { existsSync } from "fs";
import { join } from "path";
import { extractScope, extractDependsOn } from "./frontmatter.ts";
import {
  listPlanFiles,
  listPlanFolders,
  listPlanSlugs,
  resolvePlanPath,
  planExistsForSlug,
  countPlanTasks,
} from "./plan-detection.ts";
import { parseReceipt, findPlansByBranch, type Receipt } from "./receipt.ts";
import { getRepoPipelineDirs } from "./global-state.ts";
import { isPidAlive, readRunnerPid } from "./process-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Liveness status for an in-progress plan. */
export type LivenessStatus =
  | { tag: "running"; pid: number }
  | { tag: "stalled" }
  | { tag: "in_progress" }
  | { tag: "outcome"; outcome: string };

/** A backlog plan with its metadata. */
export interface BacklogPlan {
  filename: string;
  scope: string;
  dependsOn: string[];
}

/** An in-progress plan with receipt data and liveness. */
export interface InProgressPlan {
  filename: string;
  slug: string;
  scope: string;
  totalTasks: number | undefined;
  tasksCompleted: number;
  hasWorktree: boolean;
  liveness: LivenessStatus;
  sandbox?: string;
}

/** Minimal worktree entry shape expected by gatherPipelineState. */
export interface WorktreeEntry {
  path: string;
  branch: string;
}

/** State of a worktree relative to the pipeline. */
export interface WorktreeState {
  entry: WorktreeEntry;
  hasActivePlan: boolean;
}

/** A detected problem in the pipeline. */
export interface PipelineProblem {
  message: string;
}

/** Complete pipeline state — the single source of truth for status display. */
export interface PipelineState {
  backlog: BacklogPlan[];
  inProgress: InProgressPlan[];
  completedSlugs: string[];
  worktrees: WorktreeState[];
  problems: PipelineProblem[];
}

// ---------------------------------------------------------------------------
// Liveness detection
// ---------------------------------------------------------------------------

/**
 * Determine the liveness status for an in-progress plan.
 *
 * Priority:
 * 1. Receipt has an outcome → use outcome (done, stuck, etc.)
 * 2. runner.pid exists and process is alive → running
 * 3. runner.pid exists but process is dead → stalled
 * 4. No runner.pid → in_progress
 */
function determineLiveness(
  inProgressDir: string,
  slug: string,
  receipt: Receipt | undefined,
): LivenessStatus {
  if (receipt?.outcome) {
    return { tag: "outcome", outcome: receipt.outcome };
  }

  const slugDir = join(inProgressDir, slug);
  const pid = readRunnerPid(slugDir);
  if (pid !== null) {
    return isPidAlive(pid) ? { tag: "running", pid } : { tag: "stalled" };
  }

  return { tag: "in_progress" };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Gather the complete pipeline state from the filesystem.
 *
 * This is a pure data-gathering function — no console output, no side
 * effects beyond filesystem reads. Multiple consumers (status dashboard,
 * interactive mode) can format the returned data differently.
 *
 * @param cwd - The working directory (used to resolve pipeline dirs).
 * @param opts.env - Optional environment variable overrides.
 * @param opts.worktrees - Pre-fetched worktree entries. When omitted the
 *   worktrees section is left empty (callers that need worktree data should
 *   pass them in to avoid a circular dependency on ralphai.ts).
 */
export function gatherPipelineState(
  cwd: string,
  opts?: {
    env?: Record<string, string | undefined>;
    worktrees?: WorktreeEntry[];
  },
): PipelineState {
  const {
    backlogDir,
    wipDir: inProgressDir,
    archiveDir,
  } = getRepoPipelineDirs(cwd, opts?.env);

  // --- Backlog plans ---
  const backlogFiles = listPlanFiles(backlogDir, true);
  const backlog: BacklogPlan[] = backlogFiles.map((filename) => {
    const slug = filename.replace(/\.md$/, "");
    const planPath = resolvePlanPath(backlogDir, slug);
    return {
      filename,
      scope: planPath ? extractScope(planPath) : "",
      dependsOn: planPath ? extractDependsOn(planPath) : [],
    };
  });

  // --- In-progress plans ---
  const inProgressFiles = listPlanFiles(inProgressDir);
  const receiptSlugs = listPlanFolders(inProgressDir).filter((slug) =>
    existsSync(join(inProgressDir, slug, "receipt.txt")),
  );

  // Build receipt lookup: plan filename → Receipt
  const receiptsByPlan = new Map<string, Receipt>();
  for (const slug of receiptSlugs) {
    const receipt = parseReceipt(join(inProgressDir, slug, "receipt.txt"));
    if (receipt) {
      const planFile = receipt.plan_file || `${slug}.md`;
      receiptsByPlan.set(planFile, receipt);
    }
  }

  const inProgress: InProgressPlan[] = inProgressFiles.map((filename) => {
    const slug = filename.replace(/\.md$/, "");
    const planFilePath = join(inProgressDir, slug, filename);
    const receipt = receiptsByPlan.get(filename);

    return {
      filename,
      slug,
      scope: extractScope(planFilePath),
      totalTasks: countPlanTasks(planFilePath),
      tasksCompleted: receipt?.tasks_completed ?? 0,
      hasWorktree: !!receipt?.worktree_path,
      liveness: determineLiveness(inProgressDir, slug, receipt),
      sandbox: receipt?.sandbox,
    };
  });

  // --- Completed plans ---
  const completedSlugs = [...new Set(listPlanSlugs(archiveDir))].sort();

  // --- Worktrees ---
  const rawWorktrees = opts?.worktrees ?? [];
  const worktrees: WorktreeState[] = rawWorktrees.map((entry) => {
    let hasActivePlan: boolean;
    if (entry.branch.startsWith("ralphai/")) {
      const slug = entry.branch.replace("ralphai/", "");
      hasActivePlan = planExistsForSlug(inProgressDir, slug);
    } else {
      hasActivePlan = findPlansByBranch(inProgressDir, entry.branch).length > 0;
    }
    return { entry, hasActivePlan };
  });

  // --- Problems ---
  const problems: PipelineProblem[] = [];

  // Orphaned receipts: receipt exists but no matching plan file
  for (const [planFile] of receiptsByPlan) {
    const slug = planFile.replace(/\.md$/, "");
    const planPath = join(inProgressDir, slug, planFile);
    if (!existsSync(planPath)) {
      problems.push({
        message: `Orphaned receipt: ${slug}/receipt.txt (no matching plan file)`,
      });
    }
  }

  // Stale worktree entries: worktree listed but directory missing
  for (const wt of rawWorktrees) {
    if (!existsSync(wt.path)) {
      problems.push({
        message: `Missing worktree directory: ${wt.path} (${wt.branch})`,
      });
    }
  }

  return { backlog, inProgress, completedSlugs, worktrees, problems };
}
