/**
 * Plan loading for the dashboard — backlog, in-progress, and completed plans.
 */
import { existsSync, readFileSync } from "fs";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { getRepoPipelineDirs } from "../../global-state.ts";
import {
  listPlanFiles,
  listPlanFolders,
  resolvePlanPath,
  countPlanTasks,
  countPlanTasksFromContent,
} from "../../plan-detection.ts";
import { parseReceipt } from "../../receipt.ts";
import { extractScope, extractDependsOn } from "../../frontmatter.ts";
import type { PlanInfo } from "../types.ts";
import {
  fileExists,
  yieldToEventLoop,
  getCachedPipelineDirs,
} from "./shared.ts";
import {
  parseIssueFromContent,
  parseScopeFromContent,
  parseDependsOnFromContent,
  parseReceiptFromContent,
} from "./parsing.ts";

// Internal helpers

async function readReceiptAsync(path: string) {
  if (!(await fileExists(path))) return undefined;
  try {
    return parseReceiptFromContent(await readFile(path, "utf-8"));
  } catch {
    return undefined;
  }
}

async function readRunnerPidAsync(path: string): Promise<number | undefined> {
  if (!(await fileExists(path))) return undefined;
  try {
    const n = parseInt((await readFile(path, "utf8")).trim(), 10);
    return isNaN(n) ? undefined : n;
  } catch {
    return undefined;
  }
}

function readIssueFieldsSync(p: string) {
  try {
    return parseIssueFromContent(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

/** Return deps only if non-empty, otherwise undefined. */
function normDeps(deps: string[] | undefined): string[] | undefined {
  return deps && deps.length > 0 ? deps : undefined;
}

function resolvePlanPathForState(
  dirs: ReturnType<typeof getRepoPipelineDirs>,
  plan: PlanInfo,
): string | null {
  const { backlogDir, wipDir: inProgressDir, archiveDir } = dirs;
  if (plan.state === "backlog") return resolvePlanPath(backlogDir, plan.slug);
  if (plan.state === "in-progress")
    return join(inProgressDir, plan.slug, plan.filename);
  return join(archiveDir, plan.slug, plan.filename);
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

  for (const file of listPlanFiles(backlogDir, true)) {
    const slug = file.replace(/\.md$/, "");
    const p = resolvePlanPath(backlogDir, slug);
    plans.push({
      filename: file,
      slug,
      state: "backlog",
      scope: (p ? extractScope(p) : undefined) || undefined,
      deps: p ? normDeps(extractDependsOn(p)) : undefined,
      ...(p ? readIssueFieldsSync(p) : {}),
    });
  }

  for (const file of listPlanFiles(inProgressDir)) {
    const slug = file.replace(/\.md$/, "");
    const fp = join(inProgressDir, slug, file);
    const receipt = parseReceipt(join(inProgressDir, slug, "receipt.txt"));
    let runnerPid: number | undefined;
    const pidPath = join(inProgressDir, slug, "runner.pid");
    if (existsSync(pidPath)) {
      const n = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
      if (!isNaN(n)) runnerPid = n;
    }
    plans.push({
      filename: file,
      slug,
      state: "in-progress",
      scope: extractScope(fp) || undefined,
      deps: normDeps(extractDependsOn(fp)),
      tasksCompleted: receipt?.tasks_completed,
      totalTasks: countPlanTasks(fp),
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.worktree_path ? "worktree" : undefined,
      startedAt: receipt?.started_at ?? undefined,
      branch: receipt?.branch ?? undefined,
      worktreePath: receipt?.worktree_path ?? undefined,
      runnerPid,
      ...readIssueFieldsSync(fp),
    });
  }

  for (const slug of listPlanFolders(archiveDir)) {
    const fp = join(archiveDir, slug, `${slug}.md`);
    const receipt = parseReceipt(join(archiveDir, slug, "receipt.txt"));
    plans.push({
      filename: `${slug}.md`,
      slug,
      state: "completed",
      scope: extractScope(fp) || undefined,
      deps: normDeps(extractDependsOn(fp)),
      tasksCompleted: receipt?.tasks_completed,
      totalTasks: countPlanTasks(fp),
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.worktree_path ? "worktree" : undefined,
      startedAt: receipt?.started_at ?? undefined,
      branch: receipt?.branch ?? undefined,
      worktreePath: receipt?.worktree_path ?? undefined,
      ...readIssueFieldsSync(fp),
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
  const planPath = resolvePlanPathForState(dirs, plan);
  if (!planPath || !existsSync(planPath)) return null;
  try {
    return readFileSync(planPath, "utf-8");
  } catch {
    return null;
  }
}

/** Async version of loadPlanContent. */
export async function loadPlanContentAsync(
  cwd: string,
  plan: PlanInfo,
): Promise<string | null> {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getCachedPipelineDirs(cwd);
  } catch {
    return null;
  }
  const planPath = resolvePlanPathForState(dirs, plan);
  if (!planPath || !(await fileExists(planPath))) return null;
  try {
    return await readFile(planPath, "utf-8");
  } catch {
    return null;
  }
}

/** Async version of loadPlans. Yields between groups for event-loop breathing room. */
export async function loadPlansAsync(cwd: string): Promise<PlanInfo[]> {
  const plans: PlanInfo[] = [];
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getCachedPipelineDirs(cwd);
  } catch {
    return plans;
  }
  const { backlogDir, wipDir: inProgressDir, archiveDir } = dirs;

  for (const file of listPlanFiles(backlogDir, true)) {
    const slug = file.replace(/\.md$/, "");
    const planPath = resolvePlanPath(backlogDir, slug);
    let scope: string | undefined;
    let deps: string[] | undefined;
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    if (planPath) {
      try {
        const c = await readFile(planPath, "utf-8");
        scope = parseScopeFromContent(c);
        deps = parseDependsOnFromContent(c);
        issueFields = parseIssueFromContent(c);
      } catch {
        /* ignore */
      }
    }
    plans.push({
      filename: file,
      slug,
      state: "backlog",
      scope,
      deps,
      ...issueFields,
    });
    await yieldToEventLoop();
  }
  await yieldToEventLoop();

  for (const file of listPlanFiles(inProgressDir)) {
    const slug = file.replace(/\.md$/, "");
    const fp = join(inProgressDir, slug, file);
    let scope: string | undefined;
    let deps: string[] | undefined;
    let totalTasks: number | undefined;
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    try {
      const c = await readFile(fp, "utf-8");
      scope = parseScopeFromContent(c);
      deps = parseDependsOnFromContent(c);
      totalTasks = countPlanTasksFromContent(c);
      issueFields = parseIssueFromContent(c);
    } catch {
      /* ignore */
    }
    const receipt = await readReceiptAsync(
      join(inProgressDir, slug, "receipt.txt"),
    );
    const runnerPid = await readRunnerPidAsync(
      join(inProgressDir, slug, "runner.pid"),
    );
    plans.push({
      filename: file,
      slug,
      state: "in-progress",
      scope,
      deps,
      tasksCompleted: receipt?.tasksCompleted,
      totalTasks,
      outcome: receipt?.outcome,
      receiptSource: receipt?.receiptSource,
      startedAt: receipt?.startedAt,
      branch: receipt?.branch,
      worktreePath: receipt?.worktreePath,
      runnerPid,
      ...issueFields,
    });
    await yieldToEventLoop();
  }
  await yieldToEventLoop();

  for (const slug of listPlanFolders(archiveDir)) {
    const fp = join(archiveDir, slug, `${slug}.md`);
    let scope: string | undefined;
    let deps: string[] | undefined;
    let totalTasks: number | undefined;
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    try {
      const c = await readFile(fp, "utf-8");
      scope = parseScopeFromContent(c);
      deps = parseDependsOnFromContent(c);
      totalTasks = countPlanTasksFromContent(c);
      issueFields = parseIssueFromContent(c);
    } catch {
      /* ignore */
    }
    const receipt = await readReceiptAsync(
      join(archiveDir, slug, "receipt.txt"),
    );
    plans.push({
      filename: `${slug}.md`,
      slug,
      state: "completed",
      scope,
      deps,
      tasksCompleted: receipt?.tasksCompleted,
      totalTasks,
      outcome: receipt?.outcome,
      receiptSource: receipt?.receiptSource,
      startedAt: receipt?.startedAt,
      branch: receipt?.branch,
      worktreePath: receipt?.worktreePath,
      ...issueFields,
    });
    await yieldToEventLoop();
  }

  return plans;
}
