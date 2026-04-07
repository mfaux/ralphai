/**
 * PR description builders: structured, human-readable PR bodies.
 *
 * Parses conventional commits into categories and assembles formatted
 * PR descriptions for both single-plan and continuous modes.
 *
 * PR body structure leads with a plain-language description (from the
 * agent's `<pr-summary>` block or the plan description as fallback),
 * followed by issue references and a technical changes breakdown.
 */
import { execQuiet } from "./exec.ts";
import { formatLearningsForPr } from "./learnings.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CategorizedCommits {
  features: string[];
  fixes: string[];
  refactors: string[];
  tests: string[];
  docs: string[];
  chores: string[];
  other: string[];
}

// ---------------------------------------------------------------------------
// Git helpers (read-only)
// ---------------------------------------------------------------------------

/** Raw one-line commit log between two refs. */
export function buildCommitLog(
  base: string,
  head: string,
  cwd: string,
): string {
  return (
    execQuiet(`git log "${base}".."${head}" --oneline --no-decorate`, cwd) ?? ""
  );
}

// ---------------------------------------------------------------------------
// Conventional commit parsing
// ---------------------------------------------------------------------------

const CC_PATTERN =
  /^[0-9a-f]{4,}\s+(feat|fix|refactor|test|docs|chore|ci|build|perf|style|revert)(?:\([^)]*\))?!?:\s+(.+)$/i;

/** Parse a line of `git log --oneline` into {type, description}. */
function parseCommitLine(
  line: string,
): { type: string; description: string } | null {
  const m = line.match(CC_PATTERN);
  if (!m) return null;
  return { type: m[1]!.toLowerCase(), description: m[2]!.trim() };
}

/** Group commit lines by conventional-commit type. */
export function categorizeCommits(commitLog: string): CategorizedCommits {
  const result: CategorizedCommits = {
    features: [],
    fixes: [],
    refactors: [],
    tests: [],
    docs: [],
    chores: [],
    other: [],
  };
  if (!commitLog) return result;

  for (const line of commitLog.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseCommitLine(trimmed);
    if (!parsed) {
      result.other.push(trimmed.replace(/^[0-9a-f]+\s+/, ""));
      continue;
    }
    switch (parsed.type) {
      case "feat":
        result.features.push(parsed.description);
        break;
      case "fix":
        result.fixes.push(parsed.description);
        break;
      case "refactor":
      case "perf":
      case "style":
        result.refactors.push(parsed.description);
        break;
      case "test":
        result.tests.push(parsed.description);
        break;
      case "docs":
        result.docs.push(parsed.description);
        break;
      case "chore":
      case "ci":
      case "build":
      case "revert":
        result.chores.push(parsed.description);
        break;
      default:
        result.other.push(parsed.description);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Child-issue extraction and Closes block
// ---------------------------------------------------------------------------

const GH_PLAN_PATTERN = /^gh-(\d+)-/;

/**
 * Extract deduplicated issue numbers from GitHub-sourced plan filenames.
 *
 * Matches filenames like `gh-42-fix-login.md` and extracts the number.
 * Skips non-GitHub filenames, `gh-0-*`, and `gh-abc-*` patterns.
 */
export function extractIssueNumbersFromPlans(plans: string[]): number[] {
  const seen = new Set<number>();
  for (const plan of plans) {
    const m = plan.match(GH_PLAN_PATTERN);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (n > 0) seen.add(n);
  }
  return [...seen];
}

/**
 * Build `Closes #N` lines for a PR body.
 *
 * When `issueRepo` and `prRepo` differ (and both are non-empty), uses
 * cross-repo syntax `Closes org/repo#N`. When same repo or either is
 * missing, uses short `Closes #N`.
 *
 * Deduplicates: if `prdNumber` also appears in `issueNumbers`, it is
 * emitted only once.
 */
export function buildClosesBlock(options: {
  prdNumber?: number;
  issueNumbers: number[];
  issueRepo?: string;
  prRepo?: string;
}): string {
  const { prdNumber, issueNumbers, issueRepo, prRepo } = options;
  const crossRepo =
    issueRepo && prRepo && issueRepo !== prRepo ? issueRepo : undefined;

  // Collect all unique numbers, PRD first (if present), then children
  const all = new Set<number>();
  if (prdNumber !== undefined && prdNumber > 0) all.add(prdNumber);
  for (const n of issueNumbers) all.add(n);

  if (all.size === 0) return "";

  const lines = [...all].map(
    (n) => `Closes ${crossRepo ? `${crossRepo}#${n}` : `#${n}`}`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// High-level summary generation
// ---------------------------------------------------------------------------

/** Build a reviewer-facing PR summary from categorized commits. */
export function buildHighLevelSummaryFromCommits(
  commits: CategorizedCommits,
): string | null {
  const parts: string[] = [];

  if (commits.features.length > 0) {
    parts.push(
      commits.features.length === 1
        ? "Adds the main feature work in this branch."
        : `Adds ${commits.features.length} feature updates in this branch.`,
    );
  }

  if (commits.fixes.length > 0) {
    parts.push(
      commits.fixes.length === 1
        ? "Includes a bug fix to improve correctness and stability."
        : `Includes ${commits.fixes.length} bug fixes to improve correctness and stability.`,
    );
  }

  const maintenanceCount =
    commits.refactors.length +
    commits.tests.length +
    commits.docs.length +
    commits.chores.length +
    commits.other.length;
  if (maintenanceCount > 0) {
    const focusedOnly = parts.length === 0;
    if (focusedOnly) {
      parts.push(
        "Focuses on maintenance work across refactoring, tests, documentation, and supporting cleanup.",
      );
    } else {
      parts.push(
        "Also includes supporting maintenance work across refactoring, tests, documentation, or tooling.",
      );
    }
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

/** Format categorized commits as a bullet list grouped by type. */
export function formatCommitsByCategory(commits: CategorizedCommits): string {
  const sections: string[] = [];
  const map: [string, string[]][] = [
    ["Features", commits.features],
    ["Bug Fixes", commits.fixes],
    ["Refactoring", commits.refactors],
    ["Tests", commits.tests],
    ["Documentation", commits.docs],
    ["Maintenance", commits.chores],
    ["Other", commits.other],
  ];

  for (const [label, items] of map) {
    if (items.length === 0) continue;
    sections.push(`### ${label}\n`);
    for (const item of items) {
      sections.push(`- ${item}`);
    }
    sections.push("");
  }

  return sections.length > 0 ? sections.join("\n").trimEnd() : "_No commits._";
}

/**
 * Build a structured PR body for a single-plan PR.
 *
 * Leads with a human-friendly description (agent-generated summary
 * when available, falling back to plan description), followed by
 * issue references and a technical changes breakdown.
 */
export function buildPrBody(
  planDescription: string,
  baseBranch: string,
  headBranch: string,
  cwd: string,
  options?: {
    prd?: number;
    issueRepo?: string;
    issueNumber?: number;
    prRepo?: string;
    summary?: string;
    learnings?: string[];
  },
): string {
  const commitLog = buildCommitLog(baseBranch, headBranch, cwd);
  const categorized = categorizeCommits(commitLog);
  const formattedCommits = formatCommitsByCategory(categorized);

  const parts: string[] = [];

  // Lead with the human-friendly description
  parts.push((options?.summary ?? planDescription) + "\n");

  if (options?.prd !== undefined && options.issueRepo) {
    parts.push(`**PRD:** ${options.issueRepo}#${options.prd}\n`);
  }

  // Emit Closes #N when the plan is from a GitHub issue
  if (options?.issueNumber) {
    const closesBlock = buildClosesBlock({
      issueNumbers: [options.issueNumber],
      issueRepo: options.issueRepo,
      prRepo: options.prRepo,
    });
    if (closesBlock) {
      parts.push(closesBlock + "\n");
    }
  }

  parts.push(`## Changes\n`, formattedCommits);

  // Append learnings section when non-empty
  const learningsSection = formatLearningsForPr(options?.learnings ?? []);
  if (learningsSection) {
    parts.push("\n\n" + learningsSection);
  }

  return parts.join("\n");
}

/**
 * Build a structured PR body for continuous-mode PRs.
 *
 * Leads with an optional human-friendly summary (agent-generated on
 * completion), followed by issue references, plan checklists, and a
 * technical changes breakdown.
 */
export function buildContinuousPrBodyStructured(
  completedPlans: string[],
  remainingPlans: string[],
  baseBranch: string,
  headBranch: string,
  cwd: string,
  options?: {
    prdNumber?: number;
    issueRepo?: string;
    prRepo?: string;
    summary?: string;
    learnings?: string[];
  },
): string {
  const parts: string[] = [];

  // Lead with agent-generated summary when available
  if (options?.summary) {
    parts.push(options.summary + "\n");
  }

  const childIssues = extractIssueNumbersFromPlans(completedPlans);
  const closesBlock = buildClosesBlock({
    prdNumber: options?.prdNumber,
    issueNumbers: childIssues,
    issueRepo: options?.issueRepo,
    prRepo: options?.prRepo,
  });
  if (closesBlock) {
    parts.push(closesBlock + "\n");
  }

  parts.push("## Completed Plans\n");
  if (completedPlans.length > 0) {
    parts.push(...completedPlans.map((p) => `- [x] ${p}`));
  } else {
    parts.push("_None yet._");
  }

  parts.push("\n## Remaining Plans\n");
  if (remainingPlans.length > 0) {
    parts.push(...remainingPlans.map((r) => `- [ ] ${r}`));
  } else {
    parts.push("_Backlog empty — all plans processed._");
  }

  const commitLog = buildCommitLog(baseBranch, headBranch, cwd);
  const categorized = categorizeCommits(commitLog);
  const formattedCommits = formatCommitsByCategory(categorized);

  parts.push("\n## Changes\n", formattedCommits);

  // Append learnings section when non-empty
  const learningsSection = formatLearningsForPr(options?.learnings ?? []);
  if (learningsSection) {
    parts.push("\n\n" + learningsSection);
  }

  return parts.join("\n");
}
