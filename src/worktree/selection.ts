import { TEXT, RESET } from "../utils.ts";
import {
  getRepoPipelineDirs,
  findPlansByBranch,
  resolvePlanPath,
  listPlanFiles,
} from "../plan-lifecycle.ts";
import { isPlanRunnerAlive } from "../process-utils.ts";
import type {
  WorktreeEntry,
  SelectedWorktreePlan,
  GitHubFallbackOptions,
} from "./types.ts";

export function selectPlanForWorktree(
  cwd: string,
  specificPlan?: string,
  activeWorktrees: WorktreeEntry[] = [],
  githubOptions?: GitHubFallbackOptions,
  /**
   * Liveness check for in-progress plans.
   * Returns true if a runner process is alive for the given slug.
   * Defaults to `isPlanRunnerAlive` from process-utils.
   * Inject a custom function in tests to control behavior.
   */
  isRunnerAlive: (
    inProgressDir: string,
    slug: string,
  ) => boolean = isPlanRunnerAlive,
): SelectedWorktreePlan | null {
  const { backlogDir, wipDir: inProgressDir } = getRepoPipelineDirs(cwd);

  // Build set of slugs that already have an active worktree
  const activeSlugs = new Set<string>();
  for (const wt of activeWorktrees) {
    if (wt.branch.startsWith("ralphai/")) {
      activeSlugs.add(wt.branch.replace("ralphai/", ""));
    } else {
      // feat/ or other managed branches: look up plans by receipt
      for (const slug of findPlansByBranch(inProgressDir, wt.branch)) {
        activeSlugs.add(slug);
      }
    }
  }

  const resolvePlanInDir = (
    baseDir: string,
    planFile: string,
  ): string | null => {
    const slug = planFile.replace(/\.md$/, "");
    return resolvePlanPath(baseDir, slug);
  };

  // --- Specific plan requested ---
  if (specificPlan) {
    const slug = specificPlan.replace(/\.md$/, "");
    const inProgressPath = resolvePlanInDir(inProgressDir, specificPlan);
    if (inProgressPath) {
      return { planFile: specificPlan, slug, source: "in-progress" };
    }
    const backlogPath = resolvePlanInDir(backlogDir, specificPlan);
    if (backlogPath) {
      return { planFile: specificPlan, slug, source: "backlog" };
    }
    console.error(
      `Plan '${specificPlan}' not found in backlog or in-progress.`,
    );
    return null;
  }

  // --- Auto-detect plan ---

  const inProgressPlans = listPlanFiles(inProgressDir);

  // Plans without an active worktree are "unattended" — resume first.
  // Also filter out plans with a live runner process to avoid conflicts
  // with another runner working on the same plan.
  const unattendedPlans = inProgressPlans.filter((f) => {
    const slug = f.replace(/\.md$/, "");
    if (activeSlugs.has(slug)) return false;
    if (isRunnerAlive(inProgressDir, slug)) return false;
    return true;
  });

  if (unattendedPlans.length === 1) {
    const planFile = unattendedPlans[0]!;
    const slug = planFile.replace(/\.md$/, "");
    return { planFile, slug, source: "in-progress" };
  }

  if (unattendedPlans.length > 1) {
    console.error(
      `Multiple unattended in-progress plans. Use ${TEXT}ralphai run --plan=<file>${RESET} to choose which one to resume.`,
    );
    for (const planFile of unattendedPlans) {
      console.error(`  ${planFile}`);
    }
    return null;
  }

  // No unattended plans — check backlog for new work
  const backlogPlans = listPlanFiles(backlogDir, true);

  if (backlogPlans.length > 0) {
    const firstPlan = backlogPlans[0]!;
    const slug = firstPlan.replace(/\.md$/, "");
    return { planFile: firstPlan, slug, source: "backlog" };
  }

  // No backlog — try resuming an in-progress plan that has a worktree
  // but no live runner (stale/crashed runner). Plans with an active runner
  // are excluded to avoid conflicts with parallel runs.
  const attendedPlans = inProgressPlans.filter((f) => {
    const slug = f.replace(/\.md$/, "");
    if (!activeSlugs.has(slug)) return false;
    if (isRunnerAlive(inProgressDir, slug)) return false;
    return true;
  });

  if (attendedPlans.length === 1) {
    const planFile = attendedPlans[0]!;
    const slug = planFile.replace(/\.md$/, "");
    return { planFile, slug, source: "in-progress" };
  }

  if (attendedPlans.length > 1) {
    console.error(
      `Multiple in-progress plans with active worktrees. Use ${TEXT}ralphai run --plan=<file>${RESET} to choose which one to resume.`,
    );
    for (const planFile of attendedPlans) {
      console.error(`  ${planFile}`);
    }
    return null;
  }

  // --- GitHub issue fallback: pull an issue if configured ---
  if (githubOptions?.issueSource === "github") {
    const result = githubOptions.pullFn();
    if (result.pulled) {
      // Re-check backlog after pulling
      const newBacklogPlans = listPlanFiles(backlogDir, true);
      if (newBacklogPlans.length > 0) {
        const firstPlan = newBacklogPlans[0]!;
        const slug = firstPlan.replace(/\.md$/, "");
        return { planFile: firstPlan, slug, source: "backlog" };
      }
    }
    console.error(`No plans in backlog and no GitHub issues available.`);
    return null;
  }

  console.error(
    `No plans in backlog. Add a plan to the pipeline backlog first.`,
  );
  return null;
}
