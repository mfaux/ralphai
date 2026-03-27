/**
 * Data loading for the dashboard — reads pipeline state from disk.
 *
 * Two sets of loaders:
 * - Sync versions (loadRepos, loadPlans, …) — kept for tests and fallback.
 * - Async versions (loadReposAsync, loadPlansAsync, …) — used by the
 *   dashboard via useAsyncAutoRefresh so heavy I/O never blocks the
 *   main thread (which stalls spinner animations and keyboard input).
 */

import { existsSync, readFileSync, statSync } from "fs";
import { readFile, stat, access, readdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { execSync } from "child_process";
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
import type { PlanInfo, WorktreeInfo } from "./types.ts";

export { type RepoSummary };

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

/** Promise-based check for file/dir existence. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Promise-based exec with string result. */
function execAsync(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, encoding: "utf-8" }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Yield to the event loop. Insert between batches of synchronous work
 * so spinner intervals and keyboard events can fire.
 */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Sync loaders (kept for tests / backward compat)
// ---------------------------------------------------------------------------

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

    // Read runner PID if present
    let runnerPid: number | undefined;
    const pidPath = join(inProgressDir, slug, "runner.pid");
    if (existsSync(pidPath)) {
      const raw = readFileSync(pidPath, "utf8").trim();
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed)) runnerPid = parsed;
    }

    plans.push({
      filename: file,
      slug,
      state: "in-progress",
      scope: scope || undefined,
      tasksCompleted: receipt?.tasks_completed,
      totalTasks: totalTasks > 0 ? totalTasks : undefined,
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.worktree_path ? "worktree" : undefined,
      startedAt: receipt?.started_at ?? undefined,
      branch: receipt?.branch ?? undefined,
      worktreePath: receipt?.worktree_path ?? undefined,
      runnerPid,
    });
  }

  // Completed plans
  for (const slug of listPlanFolders(archiveDir)) {
    const planFilePath = join(archiveDir, slug, `${slug}.md`);
    const receiptPath = join(archiveDir, slug, "receipt.txt");
    const receipt = parseReceipt(receiptPath);
    const totalTasks = countPlanTasks(planFilePath);

    plans.push({
      filename: `${slug}.md`,
      slug,
      state: "completed",
      tasksCompleted: receipt?.tasks_completed,
      totalTasks: totalTasks > 0 ? totalTasks : undefined,
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.worktree_path ? "worktree" : undefined,
      startedAt: receipt?.started_at ?? undefined,
      branch: receipt?.branch ?? undefined,
      worktreePath: receipt?.worktree_path ?? undefined,
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

/** Read progress.md for a plan. */
export function loadProgressContent(
  cwd: string,
  plan: PlanInfo,
): string | null {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getRepoPipelineDirs(cwd);
  } catch {
    return null;
  }

  const { wipDir: inProgressDir, archiveDir } = dirs;

  let progressPath: string | null = null;
  if (plan.state === "in-progress") {
    progressPath = join(inProgressDir, plan.slug, "progress.md");
  } else if (plan.state === "completed") {
    progressPath = join(archiveDir, plan.slug, "progress.md");
  }

  if (!progressPath || !existsSync(progressPath)) return null;

  try {
    return readFileSync(progressPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read the last `maxLines` of agent-output.log for a plan.
 * Returns null if the file does not exist.
 */
export function loadOutputTail(
  cwd: string,
  plan: PlanInfo,
  maxLines = 200,
): { content: string; totalLines: number; isLive: boolean } | null {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getRepoPipelineDirs(cwd);
  } catch {
    return null;
  }

  const { wipDir: inProgressDir, archiveDir } = dirs;

  let outputPath: string | null = null;
  if (plan.state === "in-progress") {
    outputPath = join(inProgressDir, plan.slug, "agent-output.log");
  } else if (plan.state === "completed") {
    outputPath = join(archiveDir, plan.slug, "agent-output.log");
  }

  if (!outputPath || !existsSync(outputPath)) return null;

  try {
    const raw = readFileSync(outputPath, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;

    // Check if file was modified in the last 30 seconds (likely live)
    const st = statSync(outputPath);
    const isLive = Date.now() - st.mtimeMs < 30_000;

    const tail =
      totalLines > maxLines ? lines.slice(-maxLines).join("\n") : raw;

    return { content: tail, totalLines, isLive };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Worktree loading (sync)
// ---------------------------------------------------------------------------

interface RawWorktreeEntry {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

/**
 * Parse the porcelain output of `git worktree list --porcelain`.
 */
function parseWorktreeList(output: string): RawWorktreeEntry[] {
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
 * Enrich raw worktree entries with status and linked plan data.
 */
function enrichWorktrees(
  raw: RawWorktreeEntry[],
  plans: PlanInfo[],
): WorktreeInfo[] {
  const activeSlugs = new Set(
    plans.filter((p) => p.state === "in-progress").map((p) => p.slug),
  );

  return raw.map((wt) => {
    const shortBranch = wt.branch.replace(/^ralphai\//, "");
    const linkedPlan = plans.find(
      (p) => p.branch === wt.branch || p.slug === shortBranch,
    );

    return {
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      bare: wt.bare,
      shortBranch,
      status: activeSlugs.has(shortBranch)
        ? ("active" as const)
        : ("idle" as const),
      linkedPlan: linkedPlan?.slug,
    };
  });
}

/**
 * Load worktrees for a repo, filtered to `ralphai/` branches.
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
    wt.branch.startsWith("ralphai/"),
  );

  return enrichWorktrees(raw, plans ?? []);
}

// ---------------------------------------------------------------------------
// Async loaders — used by the dashboard to avoid blocking the event loop
// ---------------------------------------------------------------------------

/**
 * Async version of loadRepos. Delegates to the sync listAllRepos() but
 * yields to the event loop first so the call is scheduled rather than
 * blocking the current tick. (listAllRepos itself is fast for typical
 * repo counts; the yield is the important part.)
 */
export async function loadReposAsync(): Promise<RepoSummary[]> {
  await yieldToEventLoop();
  return loadRepos();
}

/**
 * Async version of loadPlans. Uses the sync helpers (extractScope, etc.)
 * but yields between plan-state groups so the event loop can process
 * spinner ticks and keyboard input.
 */
export async function loadPlansAsync(cwd: string): Promise<PlanInfo[]> {
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

  // Yield between groups so the event loop can breathe
  await yieldToEventLoop();

  // In-progress plans
  for (const file of listPlanFiles(inProgressDir)) {
    const slug = file.replace(/\.md$/, "");
    const planFilePath = join(inProgressDir, slug, file);
    const scope = extractScope(planFilePath);
    const totalTasks = countPlanTasks(planFilePath);

    const receiptPath = join(inProgressDir, slug, "receipt.txt");
    const receipt = parseReceipt(receiptPath);

    let runnerPid: number | undefined;
    const pidPath = join(inProgressDir, slug, "runner.pid");
    if (existsSync(pidPath)) {
      const raw = readFileSync(pidPath, "utf8").trim();
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed)) runnerPid = parsed;
    }

    plans.push({
      filename: file,
      slug,
      state: "in-progress",
      scope: scope || undefined,
      tasksCompleted: receipt?.tasks_completed,
      totalTasks: totalTasks > 0 ? totalTasks : undefined,
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.worktree_path ? "worktree" : undefined,
      startedAt: receipt?.started_at ?? undefined,
      branch: receipt?.branch ?? undefined,
      worktreePath: receipt?.worktree_path ?? undefined,
      runnerPid,
    });
  }

  await yieldToEventLoop();

  // Completed plans
  for (const slug of listPlanFolders(archiveDir)) {
    const planFilePath = join(archiveDir, slug, `${slug}.md`);
    const receiptPath = join(archiveDir, slug, "receipt.txt");
    const receipt = parseReceipt(receiptPath);
    const totalTasks = countPlanTasks(planFilePath);

    plans.push({
      filename: `${slug}.md`,
      slug,
      state: "completed",
      tasksCompleted: receipt?.tasks_completed,
      totalTasks: totalTasks > 0 ? totalTasks : undefined,
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.worktree_path ? "worktree" : undefined,
      startedAt: receipt?.started_at ?? undefined,
      branch: receipt?.branch ?? undefined,
      worktreePath: receipt?.worktree_path ?? undefined,
    });
  }

  return plans;
}

/**
 * Async version of loadProgressContent. Uses fs/promises.readFile
 * instead of readFileSync.
 */
export async function loadProgressContentAsync(
  cwd: string,
  plan: PlanInfo,
): Promise<string | null> {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getRepoPipelineDirs(cwd);
  } catch {
    return null;
  }

  const { wipDir: inProgressDir, archiveDir } = dirs;

  let progressPath: string | null = null;
  if (plan.state === "in-progress") {
    progressPath = join(inProgressDir, plan.slug, "progress.md");
  } else if (plan.state === "completed") {
    progressPath = join(archiveDir, plan.slug, "progress.md");
  }

  if (!progressPath || !(await fileExists(progressPath))) return null;

  try {
    return await readFile(progressPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Async version of loadOutputTail. Uses fs/promises to avoid blocking
 * on potentially large agent-output.log files.
 */
export async function loadOutputTailAsync(
  cwd: string,
  plan: PlanInfo,
  maxLines = 200,
): Promise<{ content: string; totalLines: number; isLive: boolean } | null> {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getRepoPipelineDirs(cwd);
  } catch {
    return null;
  }

  const { wipDir: inProgressDir, archiveDir } = dirs;

  let outputPath: string | null = null;
  if (plan.state === "in-progress") {
    outputPath = join(inProgressDir, plan.slug, "agent-output.log");
  } else if (plan.state === "completed") {
    outputPath = join(archiveDir, plan.slug, "agent-output.log");
  }

  if (!outputPath || !(await fileExists(outputPath))) return null;

  try {
    const raw = await readFile(outputPath, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;

    const st = await stat(outputPath);
    const isLive = Date.now() - st.mtimeMs < 30_000;

    const tail =
      totalLines > maxLines ? lines.slice(-maxLines).join("\n") : raw;

    return { content: tail, totalLines, isLive };
  } catch {
    return null;
  }
}

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
    wt.branch.startsWith("ralphai/"),
  );

  return enrichWorktrees(raw, plans ?? []);
}
