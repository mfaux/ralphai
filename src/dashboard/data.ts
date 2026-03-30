/**
 * Data loading for the dashboard — reads pipeline state from disk.
 *
 * Two sets of loaders:
 * - Sync versions (loadRepos, loadPlans, …) — kept for tests and fallback.
 * - Async versions (loadReposAsync, loadPlansAsync, …) — used by the
 *   dashboard via useAsyncAutoRefresh so heavy I/O never blocks the
 *   main thread (which stalls spinner animations and keyboard input).
 */

import { existsSync, readFileSync } from "fs";
import { readFile, access } from "node:fs/promises";
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
  countPlanTasksFromContent,
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

/**
 * Cached pipeline dirs by cwd. The directory paths never change during a
 * dashboard session, so we call getRepoPipelineDirs once per repo and
 * reuse the result. This avoids repeated mkdirSync / existsSync calls
 * on every 3-second poll cycle (5 loaders x 3 dir checks = 15 syscalls).
 */
const pipelineDirsCache = new Map<
  string,
  ReturnType<typeof getRepoPipelineDirs>
>();

function getCachedPipelineDirs(
  cwd: string,
): ReturnType<typeof getRepoPipelineDirs> {
  let cached = pipelineDirsCache.get(cwd);
  if (!cached) {
    cached = getRepoPipelineDirs(cwd);
    pipelineDirsCache.set(cwd, cached);
  }
  return cached;
}

function extractFrontmatterBlock(content: string): string {
  if (!content.startsWith("---\n")) return "";
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return "";
  return content.slice(4, endIdx);
}

function parseScopeFromContent(content: string): string | undefined {
  const fm = extractFrontmatterBlock(content);
  if (!fm) return undefined;
  const match = fm.match(/^\s*scope:\s*(.+)$/m);
  const scope = match?.[1]?.trim();
  return scope && scope.length > 0 ? scope : undefined;
}

function parseDependsOnFromContent(content: string): string[] | undefined {
  const fm = extractFrontmatterBlock(content);
  if (!fm) return undefined;

  const inlineMatch = fm.match(/^\s*depends-on:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    const deps = inlineMatch[1]!
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    return deps.length > 0 ? deps : undefined;
  }

  const lines = fm.split("\n");
  const deps: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (/^\s*depends-on:\s*$/.test(line)) {
      collecting = true;
      continue;
    }

    if (collecting) {
      const itemMatch = line.match(/^\s*-\s+(.+)$/);
      if (itemMatch) {
        const val = itemMatch[1]!.trim().replace(/^["']|["']$/g, "");
        if (val) deps.push(val);
        continue;
      }

      if (/^\s*\S/.test(line)) {
        collecting = false;
      }
    }
  }

  return deps.length > 0 ? deps : undefined;
}

function parseIssueFromContent(content: string): {
  source?: "github";
  issueNumber?: number;
  issueUrl?: string;
} {
  const fm = extractFrontmatterBlock(content);
  if (!fm) return {};
  const sourceMatch = fm.match(/^\s*source:\s*(.+)$/m);
  const src = sourceMatch?.[1]?.trim();
  if (src !== "github") return {};
  const issueMatch = fm.match(/^\s*issue:\s*(.+)$/m);
  const urlMatch = fm.match(/^\s*issue-url:\s*(.+)$/m);
  const num = issueMatch ? parseInt(issueMatch[1]!.trim(), 10) : undefined;
  return {
    source: "github",
    issueNumber: num !== undefined && !isNaN(num) ? num : undefined,
    issueUrl: urlMatch?.[1]?.trim() || undefined,
  };
}

function parseReceiptFromContent(content: string): {
  tasksCompleted?: number;
  outcome?: string;
  receiptSource?: "worktree";
  startedAt?: string;
  branch?: string;
  worktreePath?: string;
} {
  const fields: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }

  const parsedTasks = parseInt(fields.tasks_completed ?? "", 10);

  return {
    tasksCompleted: Number.isNaN(parsedTasks) ? undefined : parsedTasks,
    outcome: fields.outcome || undefined,
    receiptSource: fields.worktree_path ? "worktree" : undefined,
    startedAt: fields.started_at || undefined,
    branch: fields.branch || undefined,
    worktreePath: fields.worktree_path || undefined,
  };
}

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
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    if (planPath) {
      try {
        const raw = readFileSync(planPath, "utf-8");
        issueFields = parseIssueFromContent(raw);
      } catch {
        /* ignore */
      }
    }

    plans.push({
      filename: file,
      slug,
      state: "backlog",
      scope: scope || undefined,
      deps: deps && deps.length > 0 ? deps : undefined,
      ...issueFields,
    });
  }

  // In-progress plans
  for (const file of listPlanFiles(inProgressDir)) {
    const slug = file.replace(/\.md$/, "");
    const planFilePath = join(inProgressDir, slug, file);
    const scope = extractScope(planFilePath);
    const totalTasks = countPlanTasks(planFilePath);

    // Parse issue metadata
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    try {
      const raw = readFileSync(planFilePath, "utf-8");
      issueFields = parseIssueFromContent(raw);
    } catch {
      /* ignore */
    }

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
      totalTasks,
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.worktree_path ? "worktree" : undefined,
      startedAt: receipt?.started_at ?? undefined,
      branch: receipt?.branch ?? undefined,
      worktreePath: receipt?.worktree_path ?? undefined,
      runnerPid,
      ...issueFields,
    });
  }

  // Completed plans
  for (const slug of listPlanFolders(archiveDir)) {
    const planFilePath = join(archiveDir, slug, `${slug}.md`);
    const receiptPath = join(archiveDir, slug, "receipt.txt");
    const receipt = parseReceipt(receiptPath);
    const totalTasks = countPlanTasks(planFilePath);

    // Parse issue metadata
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    try {
      const raw = readFileSync(planFilePath, "utf-8");
      issueFields = parseIssueFromContent(raw);
    } catch {
      /* ignore */
    }

    plans.push({
      filename: `${slug}.md`,
      slug,
      state: "completed",
      tasksCompleted: receipt?.tasks_completed,
      totalTasks,
      outcome: receipt?.outcome ?? undefined,
      receiptSource: receipt?.worktree_path ? "worktree" : undefined,
      startedAt: receipt?.started_at ?? undefined,
      branch: receipt?.branch ?? undefined,
      worktreePath: receipt?.worktree_path ?? undefined,
      ...issueFields,
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
): { content: string; totalLines: number } | null {
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

    const tail =
      totalLines > maxLines ? lines.slice(-maxLines).join("\n") : raw;

    return { content: tail, totalLines };
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
 * Check whether a branch is managed by ralphai (ralphai/* or feat/*).
 */
function isRalphaiManagedBranch(branch: string): boolean {
  return branch.startsWith("ralphai/") || branch.startsWith("feat/");
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
    dirs = getCachedPipelineDirs(cwd);
  } catch {
    return plans;
  }

  const { backlogDir, wipDir: inProgressDir, archiveDir } = dirs;

  // Backlog plans
  for (const file of listPlanFiles(backlogDir, true)) {
    const slug = file.replace(/\.md$/, "");
    const planPath = resolvePlanPath(backlogDir, slug);
    let scope: string | undefined;
    let deps: string[] | undefined;
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    if (planPath) {
      try {
        const planContent = await readFile(planPath, "utf-8");
        scope = parseScopeFromContent(planContent);
        deps = parseDependsOnFromContent(planContent);
        issueFields = parseIssueFromContent(planContent);
      } catch {
        scope = undefined;
        deps = undefined;
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

  // Yield between groups so the event loop can breathe
  await yieldToEventLoop();

  // In-progress plans
  for (const file of listPlanFiles(inProgressDir)) {
    const slug = file.replace(/\.md$/, "");
    const planFilePath = join(inProgressDir, slug, file);
    let scope: string | undefined;
    let totalTasks: number | undefined;
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    try {
      const planContent = await readFile(planFilePath, "utf-8");
      scope = parseScopeFromContent(planContent);
      totalTasks = countPlanTasksFromContent(planContent);
      issueFields = parseIssueFromContent(planContent);
    } catch {
      scope = undefined;
      totalTasks = undefined;
    }

    const receiptPath = join(inProgressDir, slug, "receipt.txt");
    let receipt:
      | {
          tasksCompleted?: number;
          outcome?: string;
          receiptSource?: "worktree";
          startedAt?: string;
          branch?: string;
          worktreePath?: string;
        }
      | undefined;
    if (await fileExists(receiptPath)) {
      try {
        const receiptContent = await readFile(receiptPath, "utf-8");
        receipt = parseReceiptFromContent(receiptContent);
      } catch {
        receipt = undefined;
      }
    }

    let runnerPid: number | undefined;
    const pidPath = join(inProgressDir, slug, "runner.pid");
    if (await fileExists(pidPath)) {
      try {
        const raw = (await readFile(pidPath, "utf8")).trim();
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed)) runnerPid = parsed;
      } catch {
        runnerPid = undefined;
      }
    }

    plans.push({
      filename: file,
      slug,
      state: "in-progress",
      scope,
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

  // Completed plans
  for (const slug of listPlanFolders(archiveDir)) {
    const planFilePath = join(archiveDir, slug, `${slug}.md`);
    let totalTasks: number | undefined;
    let issueFields: ReturnType<typeof parseIssueFromContent> = {};
    try {
      const planContent = await readFile(planFilePath, "utf-8");
      totalTasks = countPlanTasksFromContent(planContent);
      issueFields = parseIssueFromContent(planContent);
    } catch {
      totalTasks = undefined;
    }

    const receiptPath = join(archiveDir, slug, "receipt.txt");
    let receipt:
      | {
          tasksCompleted?: number;
          outcome?: string;
          receiptSource?: "worktree";
          startedAt?: string;
          branch?: string;
          worktreePath?: string;
        }
      | undefined;
    if (await fileExists(receiptPath)) {
      try {
        const receiptContent = await readFile(receiptPath, "utf-8");
        receipt = parseReceiptFromContent(receiptContent);
      } catch {
        receipt = undefined;
      }
    }

    plans.push({
      filename: `${slug}.md`,
      slug,
      state: "completed",
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
    dirs = getCachedPipelineDirs(cwd);
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
): Promise<{ content: string; totalLines: number } | null> {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getCachedPipelineDirs(cwd);
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

    const tail =
      totalLines > maxLines ? lines.slice(-maxLines).join("\n") : raw;

    return { content: tail, totalLines };
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
    isRalphaiManagedBranch(wt.branch),
  );

  return enrichWorktrees(raw, plans ?? []);
}
