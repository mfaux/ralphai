/**
 * Frontmatter and receipt content parsers for dashboard data loading.
 */

// ---------------------------------------------------------------------------
// Frontmatter extraction
// ---------------------------------------------------------------------------

export function extractFrontmatterBlock(content: string): string {
  if (!content.startsWith("---\n")) return "";
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return "";
  return content.slice(4, endIdx);
}

export function parseScopeFromContent(content: string): string | undefined {
  const fm = extractFrontmatterBlock(content);
  if (!fm) return undefined;
  const match = fm.match(/^\s*scope:\s*(.+)$/m);
  const scope = match?.[1]?.trim();
  return scope && scope.length > 0 ? scope : undefined;
}

export function parseDependsOnFromContent(
  content: string,
): string[] | undefined {
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

export function parseIssueFromContent(content: string): {
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

// ---------------------------------------------------------------------------
// Receipt parsing
// ---------------------------------------------------------------------------

/** @internal Exported for testing. */
export function parseReceiptFromContent(content: string): {
  tasksCompleted: number;
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
    tasksCompleted: Number.isNaN(parsedTasks) ? 0 : parsedTasks,
    outcome: fields.outcome || undefined,
    receiptSource: fields.worktree_path ? "worktree" : undefined,
    startedAt: fields.started_at || undefined,
    branch: fields.branch || undefined,
    worktreePath: fields.worktree_path || undefined,
  };
}
