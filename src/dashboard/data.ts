/**
 * Data loading for the dashboard — reads pipeline state from disk.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  listAllRepos,
  getRepoPipelineDirs,
  type RepoSummary,
} from "../global-state.ts";
import {
  listPlanFiles,
  listPlanFolders,
  resolvePlanPath,
  countPlanTasks,
} from "../plan-detection.ts";
import { parseReceipt } from "../receipt.ts";
import { extractScope, extractDependsOn } from "../frontmatter.ts";
import type { PlanInfo } from "./types.ts";

export { type RepoSummary };

/**
 * Load known repos, filtering out stale empties (dead temp dirs with no plans).
 */
export function loadRepos(): RepoSummary[] {
  return listAllRepos().filter((r) => {
    // Keep repos that still exist on disk
    if (r.pathExists) return true;
    // Keep stale repos that still have plans (user may want to see them)
    if (r.backlogCount > 0 || r.inProgressCount > 0 || r.completedCount > 0)
      return true;
    // Drop stale, empty repos (test leftovers, deleted projects)
    return false;
  });
}

/** Load detailed plan info for a specific repo (by cwd path). */
export function loadPlans(cwd: string): PlanInfo[] {
  const plans: PlanInfo[] = [];

  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getRepoPipelineDirs(cwd);
  } catch {
    return plans;
  }

  const { backlogDir, wipDir: inProgressDir, archiveDir } = dirs;

  // Backlog plans
  for (const file of listPlanFiles(backlogDir, true)) {
    const slug = file.replace(/\.md$/, "");
    const planPath = resolvePlanPath(backlogDir, slug);
    const scope = planPath ? extractScope(planPath) : undefined;
    const deps = planPath ? extractDependsOn(planPath) : undefined;

    plans.push({
      filename: file,
      slug,
      state: "backlog",
      scope: scope || undefined,
      deps: deps && deps.length > 0 ? deps : undefined,
    });
  }

  // In-progress plans
  for (const file of listPlanFiles(inProgressDir)) {
    const slug = file.replace(/\.md$/, "");
    const planFilePath = join(inProgressDir, slug, file);
    const scope = extractScope(planFilePath);
    const totalTasks = countPlanTasks(planFilePath);

    // Parse receipt
    const receiptPath = join(inProgressDir, slug, "receipt.txt");
    const receipt = parseReceipt(receiptPath);

    plans.push({
      filename: file,
      slug,
      state: "in-progress",
      scope: scope || undefined,
      turnsCompleted: receipt?.turns_completed,
      turnsBudget: receipt?.turns_budget,
      tasksCompleted: receipt?.tasks_completed,
      totalTasks: totalTasks > 0 ? totalTasks : undefined,
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.source as "main" | "worktree" | undefined,
    });
  }

  // Completed plans
  for (const slug of listPlanFolders(archiveDir)) {
    plans.push({
      filename: `${slug}.md`,
      slug,
      state: "completed",
    });
  }

  return plans;
}

/** Read the raw plan markdown content for preview. */
export function loadPlanContent(cwd: string, plan: PlanInfo): string | null {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getRepoPipelineDirs(cwd);
  } catch {
    return null;
  }

  const { backlogDir, wipDir: inProgressDir, archiveDir } = dirs;

  let planPath: string | null = null;
  switch (plan.state) {
    case "backlog":
      planPath = resolvePlanPath(backlogDir, plan.slug);
      break;
    case "in-progress":
      planPath = join(inProgressDir, plan.slug, plan.filename);
      break;
    case "completed":
      planPath = join(archiveDir, plan.slug, plan.filename);
      break;
  }

  if (!planPath || !existsSync(planPath)) return null;

  try {
    return readFileSync(planPath, "utf-8");
  } catch {
    return null;
  }
}
