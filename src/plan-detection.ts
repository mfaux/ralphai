/**
 * Plan detection and dependency resolution.
 *
 * Single source of truth for plan listing, dependency checking, and
 * plan selection logic.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join, basename } from "path";
import { extractDependsOn } from "./frontmatter.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of detecting the next plan to run. */
export interface DetectedPlan {
  /** Absolute path to the plan .md file in its in-progress slug-folder. */
  planFile: string;
  /** Plan slug (dirname / filename stem). */
  planSlug: string;
  /** Absolute path to the active in-progress slug-folder. */
  wipDir: string;
  /** True when resuming an existing in-progress plan. */
  resumed: boolean;
}

/** Reason why no plan was detected. */
export type DetectFailReason =
  | "empty-backlog"
  | "all-blocked"
  | "target-not-found";

/** Blocked plan info returned when detection finds no runnable plans. */
export interface BlockedPlanInfo {
  slug: string;
  reason: string; // e.g., "skipped", "pending:dep-a.md,missing:dep-b.md"
}

/** Full result of detectPlan, including failure reasons. */
export type DetectPlanResult =
  | { detected: true; plan: DetectedPlan }
  | {
      detected: false;
      reason: DetectFailReason;
      backlogCount: number;
      blocked: BlockedPlanInfo[];
    };

/** Dependency status for a single plan dependency. */
export type DependencyStatus = "done" | "pending" | "missing";

/** Result of checking plan readiness. */
export type PlanReadiness =
  | { ready: true }
  | { ready: false; reasons: string[] };

/** Directories used by the pipeline. */
export interface PipelineDirs {
  wipDir: string;
  backlogDir: string;
  archiveDir: string;
}

/** Format of a plan file: task headings, checkboxes, or neither. */
export type PlanFormat = "tasks" | "checkboxes" | "none";

/** Result of detecting the plan format and counting tasks. */
export interface PlanFormatResult {
  format: PlanFormat;
  totalTasks: number;
}

// ---------------------------------------------------------------------------
// Plan listing (moved from src/ralphai.ts)
// ---------------------------------------------------------------------------

/**
 * List subdirectory names in `dir`.
 */
export function listPlanFolders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Compute the path to a plan file inside a slug-folder: `<dir>/<slug>/<slug>.md`
 */
export function planPathForSlug(dir: string, slug: string): string {
  return join(dir, slug, `${slug}.md`);
}

/**
 * List plan slugs in `dir`.
 * - Slug-folder plans (`<slug>/<slug>.md`): used by in-progress and out.
 * - Flat `.md` files (`<slug>.md`): used by backlog.
 * Pass `flatOnly: true` for backlog to skip slug-folder scanning.
 */
export function listPlanSlugs(dir: string, flatOnly = false): string[] {
  if (!existsSync(dir)) return [];
  const seen = new Set<string>();
  const slugs: string[] = [];

  // Slug-folder plans: <dir>/<slug>/<slug>.md (in-progress, out)
  if (!flatOnly) {
    for (const folder of listPlanFolders(dir)) {
      if (existsSync(planPathForSlug(dir, folder))) {
        seen.add(folder);
        slugs.push(folder);
      }
    }
  }

  // Flat files: <dir>/<slug>.md (backlog)
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const slug = entry.name.replace(/\.md$/, "");
      if (!seen.has(slug)) {
        seen.add(slug);
        slugs.push(slug);
      }
    }
  } catch {
    // ignore read errors
  }

  return slugs;
}

/**
 * List plan filenames (`<slug>.md`) in `dir`.
 */
export function listPlanFiles(dir: string, flatOnly = false): string[] {
  return listPlanSlugs(dir, flatOnly).map((slug) => `${slug}.md`);
}

/**
 * Resolve the path to a plan file for a given slug in `dir`.
 * Checks slug-folder (`<dir>/<slug>/<slug>.md`) for in-progress/out,
 * then flat file (`<dir>/<slug>.md`) for backlog.
 * Returns the path if found, null otherwise.
 */
export function resolvePlanPath(dir: string, slug: string): string | null {
  const folderPath = planPathForSlug(dir, slug);
  if (existsSync(folderPath)) return folderPath;
  const flatPath = join(dir, `${slug}.md`);
  if (existsSync(flatPath)) return flatPath;
  return null;
}

/**
 * Check whether a plan exists for the given slug in `dir`.
 */
export function planExistsForSlug(dir: string, slug: string): boolean {
  return resolvePlanPath(dir, slug) !== null;
}

// ---------------------------------------------------------------------------
// Plan format detection
// ---------------------------------------------------------------------------

/**
 * Strip YAML frontmatter from plan content.
 * Returns the body after the closing `---` marker, or the full content
 * if no valid frontmatter is found.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return content;
  return content.slice(endIdx + 4);
}

/**
 * Detect the format of a plan and count its total tasks.
 *
 * Detection priority:
 * 1. `### Task N:` headings → format "tasks"
 * 2. `- [ ]` or `- [x]` checkboxes → format "checkboxes"
 * 3. Neither → format "none" with totalTasks = 0
 *
 * Strips YAML frontmatter before scanning.
 */
export function detectPlanFormat(content: string): PlanFormatResult {
  const body = stripFrontmatter(content);

  // Priority 1: task headings
  const taskMatches = body.match(/^### Task \d+/gm);
  if (taskMatches && taskMatches.length > 0) {
    return { format: "tasks", totalTasks: taskMatches.length };
  }

  // Priority 2: checkboxes (both unchecked and checked)
  const checkboxMatches = body.match(/^- \[[ x]\]/gm);
  if (checkboxMatches && checkboxMatches.length > 0) {
    return { format: "checkboxes", totalTasks: checkboxMatches.length };
  }

  // Priority 3: neither
  return { format: "none", totalTasks: 0 };
}

/**
 * Count total tasks in plan content (string).
 * Returns `undefined` when no tasks are found, consistent with the
 * dashboard's `PlanInfo.totalTasks` type.
 *
 * This is the single source of truth for content-based task counting,
 * replacing the private copy that lived in `dashboard/data.ts`.
 */
export function countPlanTasksFromContent(content: string): number | undefined {
  const { totalTasks } = detectPlanFormat(content);
  return totalTasks > 0 ? totalTasks : undefined;
}

/**
 * Count total tasks in a plan file.
 * Returns `undefined` when the file doesn't exist or contains no tasks.
 *
 * Uses `detectPlanFormat` internally so it recognizes both `### Task N:`
 * headings and `- [ ]` / `- [x]` checkboxes.
 */
export function countPlanTasks(planPath: string): number | undefined {
  if (!existsSync(planPath)) return undefined;
  const content = readFileSync(planPath, "utf-8");
  return countPlanTasksFromContent(content);
}

/**
 * Count completed tasks in a progress file.
 * Counts individual `**Status:** Complete` markers.
 *
 * @deprecated Batch `### Tasks X-Y` headings are no longer generated
 * (the execution model is now one iteration per task). The batch pattern
 * is still accepted for backward-compatibility with older progress files
 * but will be removed in a future release.
 */
export function countCompletedTasks(progressPath: string): number {
  if (!existsSync(progressPath)) return 0;
  const content = readFileSync(progressPath, "utf-8");

  // Count individual `**Status:** Complete` entries
  const completeMatches = content.match(/\*\*Status:\*\*\s*Complete/gi);
  let count = completeMatches ? completeMatches.length : 0;

  // DEPRECATED: batch entries from older progress files.
  // One iteration now completes exactly one task, so batch headings
  // should not appear in new progress files.
  const batchMatches = content.matchAll(
    /^### .*Tasks?\s+(\d+)\s*[–-]\s*(\d+)/gim,
  );
  for (const match of batchMatches) {
    const start = parseInt(match[1]!, 10);
    const end = parseInt(match[2]!, 10);
    if (end > start) {
      count += end - start + 1;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Plan detection
// ---------------------------------------------------------------------------

/**
 * Collect backlog plans (flat `.md` files only).
 * Returns sorted array of absolute file paths.
 */
export function collectBacklogPlans(backlogDir: string): string[] {
  if (!existsSync(backlogDir)) return [];
  try {
    return readdirSync(backlogDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(backlogDir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Check dependency status for a plan slug.
 * Returns "done" if archived, "pending" if in backlog or in-progress,
 * "missing" if not found anywhere.
 */
export function checkDependencyStatus(
  depSlug: string,
  dirs: PipelineDirs,
): DependencyStatus {
  // Normalize: strip .md extension if present
  const slug = depSlug.replace(/\.md$/, "");
  const depBase = `${slug}.md`;

  if (existsSync(join(dirs.archiveDir, slug))) {
    return "done";
  }

  if (
    existsSync(join(dirs.wipDir, slug)) ||
    existsSync(join(dirs.backlogDir, depBase))
  ) {
    return "pending";
  }

  return "missing";
}

/**
 * Determine whether a backlog plan is ready based on depends-on metadata.
 */
export function planReadiness(
  planPath: string,
  dirs: PipelineDirs,
): PlanReadiness {
  const planBase = basename(planPath);
  const deps = extractDependsOn(planPath).map((d) => basename(d));

  if (deps.length === 0) {
    return { ready: true };
  }

  const reasons: string[] = [];
  for (const dep of deps) {
    if (dep === planBase) {
      reasons.push(`self:${dep}`);
      continue;
    }

    const slug = dep.replace(/\.md$/, "");
    const status = checkDependencyStatus(slug, dirs);
    if (status !== "done") {
      reasons.push(`${status}:${dep}`);
    }
  }

  if (reasons.length === 0) {
    return { ready: true };
  }

  return { ready: false, reasons };
}

/**
 * Extract the first markdown heading from a plan file.
 */
export function getPlanDescription(planPath: string): string {
  if (!existsSync(planPath)) return "ralphai task";
  try {
    const content = readFileSync(planPath, "utf-8");
    const match = content.match(/^#+\s+(.+)$/m);
    return match ? match[1]!.trim() : "ralphai task";
  } catch {
    return "ralphai task";
  }
}

/**
 * Detect the next plan to run.
 *
 * Algorithm:
 * 1. Check for in-progress plans (resume).
 *    - In worktree mode, only consider the plan matching the current branch.
 *    - Otherwise, consider all in-progress slug-folders.
 * 2. If no in-progress work, scan the backlog.
 * 3. Filter backlog by dependency readiness.
 * 4. Pick the first ready plan.
 * 5. Promote it from flat file to in-progress slug-folder (unless dry-run).
 *
 * Returns a `DetectPlanResult` with either the detected plan or a
 * reason why no plan was found plus blocked-plan diagnostics.
 */
export function detectPlan(opts: {
  dirs: PipelineDirs;
  /** Current git branch name, if in worktree mode. */
  worktreeBranch?: string;
  /** If true, skip filesystem side effects (mkdir, mv). */
  dryRun?: boolean;
  /** Plan slugs to skip (e.g., branch/PR collision). */
  skippedSlugs?: Set<string>;
  /** Target a specific backlog plan by filename (e.g. "my-plan.md"). */
  targetPlan?: string;
}): DetectPlanResult {
  const {
    dirs,
    worktreeBranch,
    dryRun = false,
    skippedSlugs,
    targetPlan,
  } = opts;

  // --- 1. Check for in-progress plans ---
  const inProgressPlans: string[] = [];

  if (worktreeBranch) {
    // Worktree mode: only consider the plan matching this branch
    const slug = worktreeBranch.replace(/^ralphai\//, "");
    const planFile = planPathForSlug(dirs.wipDir, slug);
    if (existsSync(planFile)) {
      inProgressPlans.push(planFile);
    }
  } else {
    // Normal mode: scan all in-progress slug-folders
    for (const folder of listPlanFolders(dirs.wipDir)) {
      const planFile = planPathForSlug(dirs.wipDir, folder);
      if (existsSync(planFile)) {
        inProgressPlans.push(planFile);
      }
    }
  }

  if (inProgressPlans.length > 0) {
    const planFile = inProgressPlans[0]!;
    const slug = basename(join(planFile, ".."));
    return {
      detected: true,
      plan: {
        planFile,
        planSlug: slug,
        wipDir: join(dirs.wipDir, slug),
        resumed: true,
      },
    };
  }

  // --- 2. Scan backlog ---
  const backlogPlans = collectBacklogPlans(dirs.backlogDir);
  if (backlogPlans.length === 0) {
    return {
      detected: false,
      reason: "empty-backlog",
      backlogCount: 0,
      blocked: [],
    };
  }

  // --- 2b. Filter to targeted plan if --plan was specified ---
  if (targetPlan) {
    const normalized = targetPlan.endsWith(".md")
      ? targetPlan
      : `${targetPlan}.md`;
    const match = backlogPlans.find((f) => basename(f) === normalized);
    if (!match) {
      return {
        detected: false,
        reason: "target-not-found",
        backlogCount: backlogPlans.length,
        blocked: [],
      };
    }
    // Replace backlogPlans with just the targeted plan for the readiness check
    backlogPlans.length = 0;
    backlogPlans.push(match);
  }

  // --- 3. Filter by dependency readiness ---
  const readyPlans: string[] = [];
  const blocked: BlockedPlanInfo[] = [];
  for (const f of backlogPlans) {
    const fb = basename(f);
    const slug = fb.replace(/\.md$/, "");

    // Skip plans with branch/PR collisions
    if (skippedSlugs?.has(slug)) {
      blocked.push({ slug, reason: "skipped" });
      continue;
    }

    const status = planReadiness(f, dirs);
    if (status.ready) {
      readyPlans.push(f);
    } else {
      blocked.push({ slug, reason: status.reasons.join(",") });
    }
  }

  if (readyPlans.length === 0) {
    return {
      detected: false,
      reason: "all-blocked",
      backlogCount: backlogPlans.length,
      blocked,
    };
  }

  // --- 4. Pick the first ready plan ---
  const chosen = readyPlans[0]!;
  const slug = basename(chosen).replace(/\.md$/, "");
  const destDir = join(dirs.wipDir, slug);
  const destPlan = join(destDir, `${slug}.md`);

  // --- 5. Promote to in-progress ---
  if (!dryRun) {
    mkdirSync(destDir, { recursive: true });
    renameSync(chosen, destPlan);
  }

  return {
    detected: true,
    plan: {
      planFile: destPlan,
      planSlug: slug,
      wipDir: destDir,
      resumed: false,
    },
  };
}
