/**
 * Frontmatter extraction utilities.
 * Single source of truth for all YAML frontmatter parsing in plan files.
 * Kept in a separate module to avoid pulling in heavy dependencies
 * (e.g., @clack/prompts from ralphai.ts) in tests.
 */
import { existsSync, readFileSync } from "fs";

/** All known frontmatter fields from plan files. */
export interface PlanFrontmatter {
  scope: string;
  dependsOn: string[];
  source: string;
  issue: number | undefined;
  issueUrl: string;
}

/** Issue-specific subset of frontmatter. */
export interface IssueFrontmatter {
  source: string;
  issue: number | undefined;
  issueUrl: string;
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
 * Extract issue-related frontmatter fields from a plan file.
 * Returns source, issue number, and issue URL.
 */
export function extractIssueFrontmatter(planPath: string): IssueFrontmatter {
  const empty: IssueFrontmatter = {
    source: "",
    issue: undefined,
    issueUrl: "",
  };

  const content = readPlanContent(planPath);
  if (!content) return empty;
  const fm = extractFrontmatterBlock(content);
  if (!fm) return empty;

  const sourceMatch = fm.match(/^\s*source:\s*(.+)$/m);
  const issueMatch = fm.match(/^\s*issue:\s*(.+)$/m);
  const issueUrlMatch = fm.match(/^\s*issue-url:\s*(.+)$/m);

  const issueRaw = issueMatch?.[1]?.trim();
  const issueNum = issueRaw ? parseInt(issueRaw, 10) : undefined;

  return {
    source: sourceMatch?.[1]?.trim() ?? "",
    issue: issueNum !== undefined && !isNaN(issueNum) ? issueNum : undefined,
    issueUrl: issueUrlMatch?.[1]?.trim() ?? "",
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
      dependsOn: [],
      source: "",
      issue: undefined,
      issueUrl: "",
    };
  }

  // Use the individual extractors to keep logic DRY.
  // Each reads the file independently, but for a plan file this is fine.
  // If performance ever matters, refactor to parse once.
  const scope = extractScope(planPath);
  const dependsOn = extractDependsOn(planPath);
  const { source, issue, issueUrl } = extractIssueFrontmatter(planPath);

  return { scope, dependsOn, source, issue, issueUrl };
}
