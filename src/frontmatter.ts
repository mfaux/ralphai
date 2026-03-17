/**
 * Frontmatter extraction utilities.
 * Kept in a separate module to avoid pulling in heavy dependencies
 * (e.g., @clack/prompts from ralphai.ts) in tests.
 */
import { existsSync, readFileSync } from "fs";

/**
 * Extract scope value from YAML frontmatter.
 * Returns the scope path (e.g. "packages/web") or "" if not present.
 */
export function extractScope(planPath: string): string {
  if (!existsSync(planPath)) return "";
  const content = readFileSync(planPath, "utf-8");
  if (!content.startsWith("---\n")) return "";

  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return "";
  const frontmatter = content.slice(4, endIdx);

  const match = frontmatter.match(/^\s*scope:\s*(.+)$/m);
  if (!match) return "";

  return match[1]!.trim();
}
