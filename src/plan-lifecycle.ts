/**
 * Plan lifecycle — unified module for all plan-related operations.
 *
 * Single source of truth for:
 *   - Plan listing, dependency checking, and task counting
 *   - YAML frontmatter extraction
 *   - Receipt parsing, creation, and updates
 *   - Pipeline directory resolution and repo registry
 *   - Aggregated pipeline state gathering
 *
 * All callers that need plan operations import from this module.
 */
import { createHash } from "crypto";
import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, resolve as resolvePath } from "path";
import { homedir } from "os";
import {
  isPidAlive,
  isPlanRunnerAlive,
  readRunnerPid,
} from "./process-utils.ts";

// =========================================================================
// Frontmatter types & functions
// =========================================================================

/** All known frontmatter fields from plan files. */
export interface PlanFrontmatter {
  scope: string;
  feedbackScope: string;
  dependsOn: string[];
  source: string;
  issue: number | undefined;
  issueUrl: string;
  prd: number | undefined;
}

/** Issue-specific subset of frontmatter. */
export interface IssueFrontmatter {
  source: string;
  issue: number | undefined;
  issueUrl: string;
  prd: number | undefined;
}

/**
 * Extract the raw frontmatter block from file content.
 * Returns the text between the opening and closing `---` markers,
 * or "" if no valid frontmatter is found.
 */
function extractFrontmatterBlock(content: string): string {
  if (!content.startsWith("---\n")) return "";
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return "";
  return content.slice(4, endIdx);
}

/**
 * Read file content safely. Returns "" if the file doesn't exist.
 */
function readPlanContent(planPath: string): string {
  if (!existsSync(planPath)) return "";
  return readFileSync(planPath, "utf-8");
}

/**
 * Extract scope value from YAML frontmatter.
 * Returns the scope path (e.g. "packages/web") or "" if not present.
 */
export function extractScope(planPath: string): string {
  const content = readPlanContent(planPath);
  if (!content) return "";
  const fm = extractFrontmatterBlock(content);
  if (!fm) return "";

  const match = fm.match(/^\s*scope:\s*(.+)$/m);
  if (!match) return "";

  return match[1]!.trim();
}

/**
 * Extract depends-on filenames from YAML frontmatter.
 * Supports both inline array and multiline YAML list syntax:
 *   depends-on: [a.md, b.md]
 *   depends-on:
 *     - a.md
 *     - b.md
 */
export function extractDependsOn(planPath: string): string[] {
  const content = readPlanContent(planPath);
  if (!content) return [];
  const fm = extractFrontmatterBlock(content);
  if (!fm) return [];

  // Try inline array: depends-on: [a.md, b.md]
  const inlineMatch = fm.match(/^\s*depends-on:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    return inlineMatch[1]!
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  // Try multiline list: depends-on:\n  - a.md\n  - b.md
  const lines = fm.split("\n");
  const deps: string[] = [];
  let collecting = false;

  for (const line of lines) {
    // Start collecting after "depends-on:" with nothing else on the line
    if (/^\s*depends-on:\s*$/.test(line)) {
      collecting = true;
      continue;
    }

    if (collecting) {
      // List item: "  - value"
      const itemMatch = line.match(/^\s*-\s+(.+)$/);
      if (itemMatch) {
        const val = itemMatch[1]!.trim().replace(/^["']|["']$/g, "");
        if (val) deps.push(val);
        continue;
      }

      // Any non-list-item line ends the block
      // (either a new key or blank line at the same indentation level)
      if (/^\s*\S/.test(line)) {
        collecting = false;
      }
    }
  }

  return deps;
}

/**
 * Extract `feedback-scope` value from YAML frontmatter.
 * Returns the feedback scope path (e.g. "src/components") or "" if not present.
 */
export function extractFeedbackScope(planPath: string): string {
  const content = readPlanContent(planPath);
  if (!content) return "";
  const fm = extractFrontmatterBlock(content);
  if (!fm) return "";

  const match = fm.match(/^\s*feedback-scope:\s*(.+)$/m);
  if (!match) return "";

  return match[1]!.trim();
}

/**
 * Extract issue-related frontmatter fields from a plan file.
 * Returns source, issue number, and issue URL.
 */
export function extractIssueFrontmatter(planPath: string): IssueFrontmatter {
  const empty: IssueFrontmatter = {
    source: "",
    issue: undefined,
    issueUrl: "",
    prd: undefined,
  };

  const content = readPlanContent(planPath);
  if (!content) return empty;
  const fm = extractFrontmatterBlock(content);
  if (!fm) return empty;

  const sourceMatch = fm.match(/^\s*source:\s*(.+)$/m);
  const issueMatch = fm.match(/^\s*issue:\s*(.+)$/m);
  const issueUrlMatch = fm.match(/^\s*issue-url:\s*(.+)$/m);
  const prdMatch = fm.match(/^\s*prd:\s*(.+)$/m);

  const issueRaw = issueMatch?.[1]?.trim();
  const issueNum = issueRaw ? parseInt(issueRaw, 10) : undefined;

  const prdRaw = prdMatch?.[1]?.trim();
  const prdNum = prdRaw ? parseInt(prdRaw, 10) : undefined;

  return {
    source: sourceMatch?.[1]?.trim() ?? "",
    issue: issueNum !== undefined && !isNaN(issueNum) ? issueNum : undefined,
    issueUrl: issueUrlMatch?.[1]?.trim() ?? "",
    prd: prdNum !== undefined && !isNaN(prdNum) ? prdNum : undefined,
  };
}

/**
 * Parse all known frontmatter fields from a plan file.
 * Returns a typed object with all fields populated (defaults for missing ones).
 */
export function parseFrontmatter(planPath: string): PlanFrontmatter {
  const content = readPlanContent(planPath);
  if (!content) {
    return {
      scope: "",
      feedbackScope: "",
      dependsOn: [],
      source: "",
      issue: undefined,
      issueUrl: "",
      prd: undefined,
    };
  }

  // Use the individual extractors to keep logic DRY.
  // Each reads the file independently, but for a plan file this is fine.
  // If performance ever matters, refactor to parse once.
  const scope = extractScope(planPath);
  const feedbackScope = extractFeedbackScope(planPath);
  const dependsOn = extractDependsOn(planPath);
  const { source, issue, issueUrl, prd } = extractIssueFrontmatter(planPath);

  return { scope, feedbackScope, dependsOn, source, issue, issueUrl, prd };
}

// =========================================================================
// Plan detection types & functions
// =========================================================================

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
// Plan listing
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
  if (taskMatches) {
    return { format: "tasks", totalTasks: taskMatches.length };
  }

  // Priority 2: checkboxes (both unchecked and checked)
  const checkboxMatches = body.match(/^- \[[ x]\]/gm);
  if (checkboxMatches) {
    return { format: "checkboxes", totalTasks: checkboxMatches.length };
  }

  // Priority 3: neither
  return { format: "none", totalTasks: 0 };
}

/**
 * Count total tasks in plan content (string).
 * Returns `undefined` when no tasks are found.
 *
 * This is the single source of truth for content-based task counting.
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
 * Count completed tasks from progress content, using the plan's format
 * to determine the counting strategy.
 *
 * - "tasks" format: counts `**Status:** Complete` markers.
 * - "checkboxes" format: counts `- [x]` items.
 *
 * This is the single source of truth for progress-based completion counting.
 */
export function countCompletedFromProgress(
  content: string,
  format: PlanFormat,
): number {
  if (format === "checkboxes") {
    const matches = content.match(/^- \[x\]/gm);
    return matches ? matches.length : 0;
  }

  // "tasks" (and "none" as fallback): count **Status:** Complete markers
  const completeMatches = content.match(/\*\*Status:\*\*\s*Complete/gi);
  return completeMatches ? completeMatches.length : 0;
}

/**
 * Count completed tasks in a progress file.
 *
 * This is a convenience wrapper that reads the file and delegates to
 * `countCompletedFromProgress`.
 */
export function countCompletedTasks(
  progressPath: string,
  format: PlanFormat,
): number {
  if (!existsSync(progressPath)) return 0;
  const content = readFileSync(progressPath, "utf-8");
  return countCompletedFromProgress(content, format);
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
 * Check if a directory contains any entry (file or subdirectory)
 * whose name starts with the given prefix.
 */
function hasEntryWithPrefix(dir: string, prefix: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((name) => name.startsWith(prefix));
  } catch {
    return false;
  }
}

/**
 * Check if a directory contains any `.md` file whose name starts
 * with the given prefix.
 */
function hasFileWithPrefix(dir: string, prefix: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some(
      (name) => name.startsWith(prefix) && name.endsWith(".md"),
    );
  } catch {
    return false;
  }
}

/**
 * Check dependency status for a plan slug.
 * Returns "done" if archived, "pending" if in backlog or in-progress,
 * "missing" if not found anywhere.
 *
 * Supports issue-based dependency slugs like "gh-42" which match any
 * plan file starting with "gh-42-" (the full slug includes the title).
 */
export function checkDependencyStatus(
  depSlug: string,
  dirs: PipelineDirs,
): DependencyStatus {
  // Normalize: strip .md extension if present
  const slug = depSlug.replace(/\.md$/, "");
  const depBase = `${slug}.md`;

  // --- Exact match (standard dependency slugs) ---
  if (existsSync(join(dirs.archiveDir, slug))) {
    return "done";
  }

  if (
    existsSync(join(dirs.wipDir, slug)) ||
    existsSync(join(dirs.backlogDir, depBase))
  ) {
    return "pending";
  }

  // --- Prefix match for issue-based slugs (gh-N) ---
  if (/^gh-\d+$/.test(slug)) {
    const prefix = `${slug}-`;

    if (hasEntryWithPrefix(dirs.archiveDir, prefix)) {
      return "done";
    }

    if (
      hasEntryWithPrefix(dirs.wipDir, prefix) ||
      hasFileWithPrefix(dirs.backlogDir, prefix)
    ) {
      return "pending";
    }
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
  /**
   * Liveness check for in-progress plans.
   * Returns true if a runner process is alive for the given slug.
   * Defaults to `isPlanRunnerAlive` from process-utils.
   * Inject a custom function in tests to control behavior.
   */
  isRunnerAlive?: (inProgressDir: string, slug: string) => boolean;
}): DetectPlanResult {
  const {
    dirs,
    worktreeBranch,
    dryRun = false,
    skippedSlugs,
    targetPlan,
    isRunnerAlive = isPlanRunnerAlive,
  } = opts;

  // --- 1. Check for in-progress plans ---
  const inProgressPlans: string[] = [];

  if (worktreeBranch) {
    // Worktree mode: only consider the plan matching this branch
    const slug = worktreeBranch.replace(/^ralphai\//, "");
    if (!skippedSlugs?.has(slug)) {
      const planFile = planPathForSlug(dirs.wipDir, slug);
      if (existsSync(planFile)) {
        inProgressPlans.push(planFile);
      }
    }
  } else {
    // Normal mode: scan all in-progress slug-folders, skipping plans
    // that have a live runner process (another runner is working on them).
    for (const folder of listPlanFolders(dirs.wipDir)) {
      if (skippedSlugs?.has(folder)) continue;
      if (isRunnerAlive(dirs.wipDir, folder)) continue;
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
    try {
      mkdirSync(destDir, { recursive: true });
      renameSync(chosen, destPlan);
    } catch (err: unknown) {
      // Another runner may have already promoted this plan (race condition).
      // If the source file no longer exists (ENOENT), treat it as "claimed
      // by another process" rather than crashing.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return {
          detected: false,
          reason: "empty-backlog",
          backlogCount: backlogPlans.length,
          blocked,
        };
      }
      throw err;
    }
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

// =========================================================================
// Receipt types & functions
// =========================================================================

export interface Receipt {
  started_at: string;
  worktree_path?: string;
  branch: string;
  slug: string;
  plan_file?: string;
  tasks_completed: number;
  outcome?: string;
  pr_url?: string;
  sandbox?: string;
}

/** Fields required when initializing a new receipt. */
export interface InitReceiptFields {
  worktree_path?: string;
  branch: string;
  slug: string;
  plan_file: string;
  sandbox?: string;
}

/**
 * Resolve the path to a receipt file for a given plan slug.
 */
export function resolveReceiptPath(
  ralphaiDir: string,
  planSlug: string,
): string {
  return join(ralphaiDir, "pipeline", "in-progress", planSlug, "receipt.txt");
}

/**
 * Parse a receipt file into a typed Receipt object.
 * Returns null if the file does not exist.
 */
export function parseReceipt(filePath: string): Receipt | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  const fields: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  const parsedTasks = parseInt(fields.tasks_completed ?? "0", 10);
  return {
    started_at: fields.started_at ?? "",
    worktree_path: fields.worktree_path,
    branch: fields.branch ?? "",
    slug: fields.slug ?? "",
    plan_file: fields.plan_file,
    tasks_completed: Number.isNaN(parsedTasks) ? 0 : parsedTasks,
    outcome: fields.outcome,
    pr_url: fields.pr_url,
    sandbox: fields.sandbox,
  };
}

/**
 * Initialize a new receipt file with the given fields.
 * Sets tasks_completed to 0.
 */
export function initReceipt(path: string, fields: InitReceiptFields): void {
  const lines: string[] = [
    `started_at=${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`,
  ];
  if (fields.worktree_path) {
    lines.push(`worktree_path=${fields.worktree_path}`);
  }
  lines.push(`branch=${fields.branch}`);
  lines.push(`slug=${fields.slug}`);
  lines.push(`plan_file=${fields.plan_file}`);
  lines.push(`tasks_completed=0`);
  if (fields.sandbox) {
    lines.push(`sandbox=${fields.sandbox}`);
  }
  writeFileSync(path, lines.join("\n") + "\n");
}

/**
 * Count completed tasks from a progress.md file and update the receipt.
 *
 * Delegates to `countCompletedFromProgress` for the actual counting logic.
 * The `format` parameter determines the counting strategy:
 * - "tasks": counts `**Status:** Complete` markers
 * - "checkboxes": counts `- [x]` items
 *
 * No-op if either the receipt or progress file does not exist.
 */
export function updateReceiptTasks(
  receiptPath: string,
  progressFilePath: string,
  format: PlanFormat = "tasks",
): void {
  if (!existsSync(receiptPath)) return;
  if (!existsSync(progressFilePath)) return;

  const progressContent = readFileSync(progressFilePath, "utf-8");
  const count = countCompletedFromProgress(progressContent, format);

  // Update or append tasks_completed
  const receiptContent = readFileSync(receiptPath, "utf-8");
  if (/^tasks_completed=/m.test(receiptContent)) {
    const updated = receiptContent.replace(
      /^tasks_completed=.*/m,
      `tasks_completed=${count}`,
    );
    writeFileSync(receiptPath, updated);
  } else {
    writeFileSync(receiptPath, receiptContent + `tasks_completed=${count}\n`);
  }
}

/**
 * Write `pr_url=<url>` to an existing receipt file.
 *
 * Appends the field if not present, or updates it if it already exists.
 * No-op if the receipt file does not exist or the URL is empty.
 */
export function updateReceiptPrUrl(receiptPath: string, prUrl: string): void {
  if (!prUrl) return;
  if (!existsSync(receiptPath)) return;

  const content = readFileSync(receiptPath, "utf-8");
  if (/^pr_url=/m.test(content)) {
    const updated = content.replace(/^pr_url=.*/m, `pr_url=${prUrl}`);
    writeFileSync(receiptPath, updated);
  } else {
    writeFileSync(receiptPath, content + `pr_url=${prUrl}\n`);
  }
}

/**
 * Write `outcome=<value>` to an existing receipt file.
 *
 * Appends the field if not present, or updates it if it already exists.
 * No-op if the receipt file does not exist or the outcome is empty.
 */
export function updateReceiptOutcome(
  receiptPath: string,
  outcome: string,
): void {
  if (!outcome) return;
  if (!existsSync(receiptPath)) return;

  const content = readFileSync(receiptPath, "utf-8");
  if (/^outcome=/m.test(content)) {
    const updated = content.replace(/^outcome=.*/m, `outcome=${outcome}`);
    writeFileSync(receiptPath, updated);
  } else {
    writeFileSync(receiptPath, content + `outcome=${outcome}\n`);
  }
}

/**
 * Scan all receipt files in the in-progress directory and return
 * an array of plan slugs whose receipt has a matching `branch` field.
 *
 * This is used for `feat/` (and similar non-`ralphai/`) worktrees where
 * the branch name doesn't directly correspond to a single plan slug.
 */
export function findPlansByBranch(
  inProgressDir: string,
  branch: string,
): string[] {
  if (!existsSync(inProgressDir)) return [];
  const slugs: string[] = [];
  try {
    const entries = readdirSync(inProgressDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const receiptPath = join(inProgressDir, entry.name, "receipt.txt");
      const receipt = parseReceipt(receiptPath);
      if (receipt && receipt.branch === branch) {
        slugs.push(entry.name);
      }
    }
  } catch {
    // ignore read errors
  }
  return slugs;
}

/**
 * List subdirectories of a directory (plan folder slugs).
 * Returns an empty array if the directory does not exist.
 */
function listDirs(dir: string): string[] {
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
 * Check receipt files for resume guidance conflicts.
 * Returns true if the run should proceed, false (with error output) if blocked.
 */
export function checkReceiptSource(
  wipDir: string,
  isWorktree: boolean,
): boolean {
  if (!existsSync(wipDir)) return true;

  const planSlugs = listDirs(wipDir);
  for (const slug of planSlugs) {
    const receiptPath = join(wipDir, slug, "receipt.txt");
    const receipt = parseReceipt(receiptPath);
    if (!receipt) continue;

    if (receipt.worktree_path && !isWorktree) {
      console.error();
      console.error(`Plan "${receipt.slug}" is running in a worktree.`);
      console.error();
      console.error(`  Worktree: ${receipt.worktree_path ?? "unknown"}`);
      console.error(`  Branch:   ${receipt.branch || "unknown"}`);
      console.error(`  Started:  ${receipt.started_at || "unknown"}`);
      console.error();
      console.error(`  To resume:  ralphai run`);
      console.error(`  To discard: ralphai worktree clean`);
      return false;
    }
  }
  return true;
}

// =========================================================================
// Global state types & functions
// =========================================================================

/**
 * Returns the global Ralphai home directory.
 * Uses `$RALPHAI_HOME` if set, otherwise `~/.ralphai`.
 */
export function getRalphaiHome(
  env?: Record<string, string | undefined>,
): string {
  const vars = env ?? process.env;
  return vars.RALPHAI_HOME || join(homedir(), ".ralphai");
}

/**
 * Derives a stable repo identifier from the git remote origin URL.
 *
 * Strips protocol prefixes, `.git` suffix, and replaces non-alphanumeric
 * characters with hyphens. Example:
 *   `https://github.com/mfaux/ralphai.git` → `github.com-mfaux-ralphai`
 *
 * Falls back to `_path-<hash>` (first 12 hex chars of SHA-256 of the
 * absolute path) when no remote is available.
 */
export function getRepoId(cwd: string): string {
  try {
    const url = execSync("git remote get-url origin", {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();

    if (url) {
      return slugifyRemoteUrl(url);
    }
  } catch {
    // No remote, or not a git repo — fall through to path-based ID.
  }

  return pathFallbackId(getRepoIdentityRoot(cwd));
}

/**
 * Computes `<ralphaiHome>/repos/<repoId>` without creating the directory.
 * Use this for read-only checks (e.g., "does the config file exist?").
 */
export function resolveRepoStateDir(
  cwd: string,
  env?: Record<string, string | undefined>,
): string {
  return join(getRalphaiHome(env), "repos", getRepoId(cwd));
}

/**
 * Returns `<ralphaiHome>/repos/<repoId>`, creating it if missing.
 * Use this only when you intend to write state (config, plans, learnings).
 */
export function ensureRepoStateDir(
  cwd: string,
  env?: Record<string, string | undefined>,
): string {
  const dir = resolveRepoStateDir(cwd, env);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns pipeline subdirectory paths under the repo state dir,
 * creating them if missing.
 */
export function getRepoPipelineDirs(
  cwd: string,
  env?: Record<string, string | undefined>,
): { backlogDir: string; wipDir: string; archiveDir: string } {
  const base = join(ensureRepoStateDir(cwd, env), "pipeline");
  const backlogDir = join(base, "backlog");
  const wipDir = join(base, "in-progress");
  const archiveDir = join(base, "out");

  for (const d of [backlogDir, wipDir, archiveDir]) {
    if (!existsSync(d)) {
      mkdirSync(d, { recursive: true });
    }
  }

  return { backlogDir, wipDir, archiveDir };
}

// ---------------------------------------------------------------------------
// Global state internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts a git remote URL into a filesystem-safe slug.
 *
 * 1. Strip common protocol prefixes (https://, git@, ssh://, git://)
 * 2. Strip `.git` suffix
 * 3. Replace `:` (SSH-style host separator) with `/`
 * 4. Replace all non-alphanumeric, non-dot, non-slash characters with `-`
 * 5. Replace `/` and `.` with `-` to form the final slug
 * 6. Collapse consecutive hyphens, trim leading/trailing hyphens
 */
function slugifyRemoteUrl(url: string): string {
  let slug = url
    .replace(/^(?:https?:\/\/|ssh:\/\/|git:\/\/)/, "")
    .replace(/^git@/, "")
    .replace(/\.git$/, "")
    .replace(/:/g, "/")
    .replace(/[^a-zA-Z0-9./]/g, "-")
    .replace(/[/.]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug;
}

/**
 * Returns a stable repository root for identity fallback.
 *
 * In a normal repo, this is the main working tree root. In a git worktree,
 * this resolves to the main repository root so worktrees share the same
 * global state directory when no remote is configured.
 */
function getRepoIdentityRoot(cwd: string): string {
  try {
    const commonDir = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      {
        cwd,
        stdio: "pipe",
        encoding: "utf-8",
      },
    ).trim();
    if (commonDir) {
      return dirname(commonDir);
    }
  } catch {
    // Not in a git repo, or git is not available.
  }

  return cwd;
}

/**
 * Produces a `_path-<hash>` identifier from the absolute path.
 * Uses the first 12 hex characters of a SHA-256 hash.
 */
function pathFallbackId(absolutePath: string): string {
  const hash = createHash("sha256")
    .update(absolutePath)
    .digest("hex")
    .slice(0, 12);
  return `_path-${hash}`;
}

// ---------------------------------------------------------------------------
// Repo enumeration
// ---------------------------------------------------------------------------

/** Summary of a known repo read from global state. */
export interface RepoSummary {
  /** Directory name under ~/.ralphai/repos/ (the repo ID slug). */
  id: string;
  /** Absolute path to the repo root (from config.json repoPath). */
  repoPath: string | null;
  /** Whether the stored repoPath still exists on disk. */
  pathExists: boolean;
  /** Number of plans in the backlog. */
  backlogCount: number;
  /** Number of plans in progress. */
  inProgressCount: number;
  /** Number of completed plans. */
  completedCount: number;
}

/**
 * Scan `~/.ralphai/repos/` and return a summary for every known repo.
 * Reads each repo's `config.json` for `repoPath` and counts plans in
 * the pipeline subdirectories.
 */
export function listAllRepos(
  env?: Record<string, string | undefined>,
): RepoSummary[] {
  const reposDir = join(getRalphaiHome(env), "repos");
  if (!existsSync(reposDir)) return [];

  const entries = readdirSync(reposDir, { withFileTypes: true });
  const repos: RepoSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const id = entry.name;
    const stateDir = join(reposDir, id);
    const configPath = join(stateDir, "config.json");

    // Read repoPath from config
    let repoPath: string | null = null;
    if (existsSync(configPath)) {
      try {
        const raw = JSON.parse(readFileSync(configPath, "utf-8"));
        if (typeof raw.repoPath === "string") {
          repoPath = raw.repoPath;
        }
      } catch {
        // Corrupt config — skip repoPath
      }
    }

    const pathExists = repoPath !== null && existsSync(repoPath);

    // Count pipeline entries
    const countDirEntries = (dir: string, flatOnly: boolean): number => {
      if (!existsSync(dir)) return 0;
      try {
        const items = readdirSync(dir, { withFileTypes: true });
        if (flatOnly) {
          return items.filter((i) => i.isFile() && i.name.endsWith(".md"))
            .length;
        }
        return items.filter((i) => i.isDirectory()).length;
      } catch {
        return 0;
      }
    };

    const pipelineDir = join(stateDir, "pipeline");
    const backlogCount = countDirEntries(join(pipelineDir, "backlog"), true);
    const inProgressCount = countDirEntries(
      join(pipelineDir, "in-progress"),
      false,
    );
    const completedCount = countDirEntries(join(pipelineDir, "out"), false);

    repos.push({
      id,
      repoPath,
      pathExists,
      backlogCount,
      inProgressCount,
      completedCount,
    });
  }

  return repos;
}

/**
 * Look up a repo by name or path. Tries to match the given identifier
 * against known repo IDs (exact or suffix match) and stored repo paths.
 * Returns the repo state dir path if found, or null.
 */
export function resolveRepoByNameOrPath(
  nameOrPath: string,
  env?: Record<string, string | undefined>,
): string | null {
  const repos = listAllRepos(env);

  // 1. Exact ID match
  const exact = repos.find((r) => r.id === nameOrPath);
  if (exact) return join(getRalphaiHome(env), "repos", exact.id);

  // 2. Suffix match (e.g., "ralphai" matches "github-com-mfaux-ralphai")
  const suffix = repos.filter((r) => r.id.endsWith(`-${nameOrPath}`));
  if (suffix.length === 1) {
    return join(getRalphaiHome(env), "repos", suffix[0]!.id);
  }

  // 3. Repo path match
  const resolvedInput = resolvePath(nameOrPath);
  const byPath = repos.find(
    (r) => r.repoPath !== null && resolvePath(r.repoPath) === resolvedInput,
  );
  if (byPath) return join(getRalphaiHome(env), "repos", byPath.id);

  return null;
}

/**
 * Remove stale repo entries from global state.
 *
 * A repo is considered stale when its pipeline is completely empty (no backlog,
 * in-progress, or completed plans) **and** either:
 * - its stored `repoPath` points to a directory that no longer exists, or
 * - it has no `config.json` at all (e.g. orphaned skeleton from a test leak).
 *
 * Returns the IDs of removed entries.
 */
export function removeStaleRepos(
  env?: Record<string, string | undefined>,
): string[] {
  const repos = listAllRepos(env);
  const reposDir = join(getRalphaiHome(env), "repos");
  const removed: string[] = [];

  for (const repo of repos) {
    const emptyPipeline =
      repo.backlogCount === 0 &&
      repo.inProgressCount === 0 &&
      repo.completedCount === 0;

    const isStale =
      emptyPipeline && (repo.repoPath === null || !repo.pathExists);

    if (isStale) {
      const stateDir = join(reposDir, repo.id);
      rmSync(stateDir, { recursive: true, force: true });
      removed.push(repo.id);
    }
  }

  return removed;
}

// =========================================================================
// Pipeline state types & functions
// =========================================================================

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
// Pipeline state entry point
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
