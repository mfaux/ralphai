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
  source: "main" | "worktree";
  worktree_path?: string;
  branch: string;
  slug: string;
  plan_file?: string;
  turns_budget: number;
  turns_completed: number;
  tasks_completed: number;
  outcome?: string;
}

/** Fields required when initializing a new receipt. */
export interface InitReceiptFields {
  source: "main" | "worktree";
  worktree_path?: string;
  branch: string;
  slug: string;
  plan_file: string;
  turns_budget: number;
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
    source: (fields.source as "main" | "worktree") ?? "main",
    worktree_path: fields.worktree_path,
    branch: fields.branch ?? "",
    slug: fields.slug ?? "",
    plan_file: fields.plan_file,
    turns_budget: parseInt(fields.turns_budget ?? "0", 10),
    turns_completed: parseInt(fields.turns_completed ?? "0", 10),
    tasks_completed: parseInt(fields.tasks_completed ?? "0", 10),
    outcome: fields.outcome,
  };
}

// ---------------------------------------------------------------------------
// Write / Update
// ---------------------------------------------------------------------------

/**
 * Initialize a new receipt file with the given fields.
 * Sets turns_completed and tasks_completed to 0.
 */
export function initReceipt(path: string, fields: InitReceiptFields): void {
  const lines: string[] = [
    `started_at=${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    `source=${fields.source}`,
  ];
  if (fields.worktree_path) {
    lines.push(`worktree_path=${fields.worktree_path}`);
  }
  lines.push(`branch=${fields.branch}`);
  lines.push(`slug=${fields.slug}`);
  lines.push(`plan_file=${fields.plan_file}`);
  lines.push(`turns_budget=${fields.turns_budget}`);
  lines.push(`turns_completed=0`);
  lines.push(`tasks_completed=0`);
  writeFileSync(path, lines.join("\n") + "\n");
}

/**
 * Increment the turns_completed counter in a receipt file.
 * No-op if the receipt file does not exist.
 */
export function updateReceiptTurn(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  const updated = content.replace(
    /^turns_completed=(\d+)/m,
    (_match, current) => `turns_completed=${parseInt(current, 10) + 1}`,
  );
  writeFileSync(path, updated);
}

/**
 * Count completed tasks from a progress.md file and update the receipt.
 *
 * Counts:
 * - Individual `**Status:** Complete` markers (case-insensitive)
 * - Batch entries like `### Tasks 1-3` which contribute (end - start + 1) tasks
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
 * Check receipt files for cross-source conflicts.
 * Returns true if the run should proceed, false (with error output) if blocked.
 *
 * Detects when a plan started in a worktree is being resumed from the main repo
 * or vice versa.
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

    if (receipt.source === "worktree" && !isWorktree) {
      console.error();
      console.error(`Plan "${receipt.slug}" is running in a worktree.`);
      console.error();
      console.error(`  Worktree: ${receipt.worktree_path ?? "unknown"}`);
      console.error(`  Branch:   ${receipt.branch || "unknown"}`);
      console.error(`  Started:  ${receipt.started_at || "unknown"}`);
      console.error();
      console.error(`  To resume:  ralphai worktree`);
      console.error(`  To discard: ralphai worktree clean`);
      return false;
    }

    if (receipt.source === "main" && isWorktree) {
      console.error();
      console.error(
        `Plan "${receipt.slug}" is already running in the main repository.`,
      );
      console.error();
      console.error(`  Branch:  ${receipt.branch || "unknown"}`);
      console.error(`  Started: ${receipt.started_at || "unknown"}`);
      console.error();
      console.error(
        `  Finish or interrupt the main-repo run first, then retry.`,
      );
      return false;
    }
  }
  return true;
}
