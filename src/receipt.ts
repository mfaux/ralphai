/**
 * Receipt handling: parse, write, and update receipt files.
 *
 * Receipt files live in the per-plan WIP directory:
 *   <wipDir>/<slug>/receipt.txt
 * Format: key=value (one per line, no quoting needed).
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Receipt {
  started_at: string;
  worktree_path?: string;
  branch: string;
  slug: string;
  plan_file?: string;
  tasks_completed: number;
  outcome?: string;
}

/** Fields required when initializing a new receipt. */
export interface InitReceiptFields {
  worktree_path?: string;
  branch: string;
  slug: string;
  plan_file: string;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the path to a receipt file for a given plan slug.
 */
export function resolveReceiptPath(
  ralphaiDir: string,
  planSlug: string,
): string {
  return join(ralphaiDir, "pipeline", "in-progress", planSlug, "receipt.txt");
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

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
  return {
    started_at: fields.started_at ?? "",
    worktree_path: fields.worktree_path,
    branch: fields.branch ?? "",
    slug: fields.slug ?? "",
    plan_file: fields.plan_file,
    tasks_completed: parseInt(fields.tasks_completed ?? "0", 10),
    outcome: fields.outcome,
  };
}

// ---------------------------------------------------------------------------
// Write / Update
// ---------------------------------------------------------------------------

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
  writeFileSync(path, lines.join("\n") + "\n");
}

/**
 * Count completed tasks from a progress.md file and update the receipt.
 *
 * Counts individual `**Status:** Complete` markers (case-insensitive).
 *
 * @deprecated Batch `### Tasks X-Y` headings are no longer generated
 * (the execution model is now one iteration per task). The batch pattern
 * is still accepted for backward-compatibility with older progress files
 * but will be removed in a future release.
 *
 * No-op if either the receipt or progress file does not exist.
 */
export function updateReceiptTasks(
  receiptPath: string,
  progressFilePath: string,
): void {
  if (!existsSync(receiptPath)) return;
  if (!existsSync(progressFilePath)) return;

  const progressContent = readFileSync(progressFilePath, "utf-8");
  let count = 0;

  // Count individual **Status:** Complete markers (case-insensitive)
  const individualMatches = progressContent.match(
    /\*\*Status:\*\*\s*Complete/gi,
  );
  if (individualMatches) {
    count += individualMatches.length;
  }

  // DEPRECATED: batch entries from older progress files.
  // One iteration now completes exactly one task, so batch headings
  // should not appear in new progress files.
  // Count batch entries: ### Tasks X-Y or ### Tasks X–Y (en-dash or hyphen)
  const batchPattern = /^### .*[Tt]asks?\s+(\d+)\s*[–-]\s*(\d+)/gim;
  let match;
  while ((match = batchPattern.exec(progressContent)) !== null) {
    const start = parseInt(match[1]!, 10);
    const end = parseInt(match[2]!, 10);
    if (end > start) {
      count += end - start + 1;
    }
  }

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

// ---------------------------------------------------------------------------
// Cross-source conflict detection
// ---------------------------------------------------------------------------

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
