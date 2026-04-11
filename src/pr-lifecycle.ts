/**
 * PR lifecycle: archive completed plans, push branches, create/update/finalize PRs.
 *
 * Includes PR description builders: structured, human-readable PR bodies.
 * Parses conventional commits into categories and assembles formatted
 * PR descriptions for both single-plan and continuous modes.
 *
 * Uses exec helpers from exec.ts for git and gh CLI calls. Functions return
 * structured results instead of printing directly, letting the caller
 * decide how to display output.
 */
import { existsSync, mkdirSync, renameSync } from "fs";
import { basename, dirname, join } from "path";
import { execQuiet, execWithStdin } from "./exec.ts";
import { extractIssueFrontmatter } from "./plan-lifecycle.ts";
import {
  checkGhAvailable,
  commitTypeFromTitle,
  detectIssueRepo,
  transitionDone,
  type BlockedSubIssue,
} from "./issue-lifecycle.ts";
import { formatLearningsForPr } from "./learnings.ts";
import { stripAnsi } from "./utils.ts";

// ---------------------------------------------------------------------------
// PR description types
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
    reviewPassMadeChanges?: boolean;
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

  // Append review pass note when the review pass made changes
  if (options?.reviewPassMadeChanges) {
    parts.push(
      "\n\n---\n\n*A review pass was run to simplify the implementation.*",
    );
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a PR title from an issue/PRD title, ensuring a conventional-commit
 * prefix when commitStyle is "conventional" (default).  When commitStyle
 * is "none", the title is returned as-is (trimmed).
 *
 * If the title already starts with a CC prefix (e.g. `"fix: broken login"`),
 * it is returned as-is; otherwise `"feat: "` is prepended.
 */
function formatPrTitle(title: string, commitStyle?: string): string {
  if (commitStyle === "none") {
    return title.trim();
  }
  const { type, description } = commitTypeFromTitle(title);
  return `${type}: ${description}`;
}

/** Escape double quotes for shell-safe interpolation in `gh` commands. */
function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

/**
 * Safety-net: strip ANSI escape codes from text destined for GitHub PR
 * titles or bodies.  Upstream extractors already strip ANSI from
 * `<pr-summary>` and `<learnings>` blocks, but this catch-all ensures
 * nothing leaks through — even if an agent builds a PR description from
 * raw terminal output.
 */
function sanitizePrText(text: string): string {
  return stripAnsi(text);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushResult {
  ok: boolean;
  message: string;
}

export interface CreatePrResult {
  ok: boolean;
  prUrl: string;
  message: string;
}

export interface CreatePrOptions {
  branch: string;
  baseBranch: string;
  planDescription: string;
  cwd: string;
  issueSource?: string;
  issueNumber?: number;
  issueRepo?: string;
  issueCommentProgress?: boolean;
  prd?: number;
  /** Agent-generated PR description from `<pr-summary>` block. */
  summary?: string;
  /** Accumulated learnings from agent runs to include in PR body. */
  learnings?: string[];
  /** Whether the review pass made simplification changes. */
  reviewPassMadeChanges?: boolean;
  /** Commit style: "conventional" applies CC prefix; "none" uses plain title. */
  commitStyle?: string;
  /** When true (default), passes --draft to `gh pr create`. */
  draft?: boolean;
}

export interface ArchiveRunOptions {
  wipFiles: string[];
  archiveDir: string;
  cwd: string;
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

export function pushBranch(
  branch: string,
  cwd: string,
  setUpstream = true,
): PushResult {
  const flag = setUpstream ? " -u" : "";
  if (execQuiet(`git push${flag} origin "${branch}"`, cwd) === null) {
    return {
      ok: false,
      message: `Failed to push branch '${branch}'. Branch left intact for manual push.`,
    };
  }
  return { ok: true, message: `Pushed ${branch} to origin` };
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/**
 * Move plan folder from in-progress to out, and optionally comment/relabel
 * the linked GitHub issue.
 */
export function archiveRun(options: ArchiveRunOptions): {
  archived: boolean;
  message: string;
} {
  const { wipFiles, archiveDir, cwd } = options;
  if (wipFiles.length === 0) {
    return { archived: false, message: "No WIP files to archive" };
  }

  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  const planDir = dirname(wipFiles[0]!);
  const planSlug = basename(planDir);

  // Read issue frontmatter before moving files
  let issueSource = "";
  let issueNumber: number | undefined;
  let issueUrl = "";
  for (const f of wipFiles) {
    if (!existsSync(f)) continue;
    const fm = extractIssueFrontmatter(f);
    issueSource = fm.source;
    issueNumber = fm.issue;
    issueUrl = fm.issueUrl;
    if (issueSource === "github") break;
  }

  const dest = join(archiveDir, planSlug);
  try {
    renameSync(planDir, dest);
  } catch (err: unknown) {
    // If the source directory no longer exists (ENOENT), another runner
    // already archived it — this is expected in the concurrent/retry scenario.
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {
        archived: false,
        message: `Plan ${planSlug} was already archived by another runner`,
      };
    }
    throw err;
  }

  // Post-completion hooks for linked GitHub issues
  if (issueSource === "github" && issueNumber && checkGhAvailable()) {
    let repo: string | null = null;
    if (issueUrl) {
      const m = issueUrl.match(
        /https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\//,
      );
      repo = m?.[1] ?? null;
    }
    if (!repo) repo = detectIssueRepo(cwd);
    if (repo) {
      execQuiet(
        `gh issue comment ${issueNumber} --repo "${repo}" ` +
          `--body "Ralphai completed this task and is preparing to merge."`,
        cwd,
      );
      transitionDone({ number: issueNumber, repo }, cwd);
    }
  }

  return { archived: true, message: `Archived ${planDir} -> ${dest}` };
}

// ---------------------------------------------------------------------------
// Standard PR (single-plan mode)
// ---------------------------------------------------------------------------

/** Push branch and create a draft PR. */
export function createPr(options: CreatePrOptions): CreatePrResult {
  const { branch, baseBranch, planDescription, cwd } = options;
  const push = pushBranch(branch, cwd, true);
  if (!push.ok) return { ok: false, prUrl: "", message: push.message };

  const isGitHub = options.issueSource === "github";
  const prRepo = isGitHub ? (detectIssueRepo(cwd) ?? undefined) : undefined;
  const prBody = buildPrBody(planDescription, baseBranch, branch, cwd, {
    prd: options.prd,
    issueRepo: options.issueRepo,
    issueNumber: isGitHub ? options.issueNumber : undefined,
    prRepo,
    summary: options.summary,
    learnings: options.learnings,
    reviewPassMadeChanges: options.reviewPassMadeChanges,
  });
  const prTitle = sanitizePrText(
    formatPrTitle(planDescription, options.commitStyle),
  );

  const draftFlag = options.draft !== false ? " --draft" : "";
  const prUrl = execWithStdin(
    `gh pr create --base "${baseBranch}" --head "${branch}" ` +
      `--title "${escapeQuotes(prTitle)}" --body-file -${draftFlag}`,
    sanitizePrText(prBody),
    cwd,
  );
  if (!prUrl) {
    return {
      ok: false,
      prUrl: "",
      message: `Failed to create draft PR. Branch '${branch}' pushed. Create PR manually.`,
    };
  }

  if (isGitHub && options.issueNumber && options.issueCommentProgress) {
    const repo = detectIssueRepo(cwd, options.issueRepo);
    if (repo) {
      execQuiet(
        `gh issue comment ${options.issueNumber} --repo "${repo}" ` +
          `--body "Ralphai created a PR for this issue: ${prUrl}"`,
        cwd,
      );
    }
  }

  return {
    ok: true,
    prUrl,
    message: `${options.draft !== false ? "Draft PR" : "PR"} created: ${prUrl}`,
  };
}

// ---------------------------------------------------------------------------
// PRD aggregate PR
// ---------------------------------------------------------------------------

export interface PrdPrBodyOptions {
  prd: { number: number; title: string };
  completedSubIssues: number[];
  stuckSubIssues: number[];
  hitlSubIssues?: number[];
  blockedSubIssues?: BlockedSubIssue[];
  baseBranch: string;
  headBranch: string;
  cwd: string;
  issueRepo?: string;
  prRepo?: string;
  /** Agent-generated summaries keyed by sub-issue number. */
  summaries?: Map<number, string>;
  /** Accumulated learnings from sub-issue runs. */
  learnings?: string[];
}
export function buildPrdPrBody(options: PrdPrBodyOptions): string {
  const {
    prd,
    completedSubIssues,
    stuckSubIssues,
    hitlSubIssues = [],
    blockedSubIssues = [],
    baseBranch,
    headBranch,
    cwd,
    issueRepo,
    prRepo,
    summaries,
    learnings = [],
  } = options;

  const parts: string[] = [];

  // Title / description
  parts.push(`PRD #${prd.number}: ${prd.title}\n`);

  // High-level summary from agent-generated PR summaries
  if (summaries && summaries.size > 0) {
    parts.push("## Summary\n");
    for (const [issueNum, summary] of summaries) {
      parts.push(`- **#${issueNum}:** ${summary}`);
    }
    parts.push("");
  }

  // Closes references — PRD + completed sub-issues only
  // Exclude stuck, HITL, and blocked sub-issues from auto-close
  const closesBlock = buildClosesBlock({
    prdNumber: prd.number,
    issueNumbers: completedSubIssues,
    issueRepo,
    prRepo,
  });
  if (closesBlock) {
    parts.push(closesBlock + "\n");
  }

  // Completed sub-issues
  parts.push("## Completed Sub-Issues\n");
  if (completedSubIssues.length > 0) {
    parts.push(...completedSubIssues.map((n) => `- [x] #${n}`));
  } else {
    parts.push("_None._");
  }

  // Stuck sub-issues (includes blocked-by-HITL with dependency notes)
  const allStuck = [...stuckSubIssues];
  const blockedByMap = new Map(
    blockedSubIssues.map((b) => [b.number, b.blockedBy]),
  );
  // Add blocked sub-issues that aren't already in the stuck list
  for (const b of blockedSubIssues) {
    if (!allStuck.includes(b.number)) {
      allStuck.push(b.number);
    }
  }
  if (allStuck.length > 0) {
    parts.push("\n## Stuck Sub-Issues\n");
    parts.push(
      ...allStuck.map((n) => {
        const blockers = blockedByMap.get(n);
        if (blockers && blockers.length > 0) {
          return `- [ ] #${n} — blocked by HITL ${blockers.map((b) => `#${b}`).join(", ")}`;
        }
        return `- [ ] #${n}`;
      }),
    );
  }

  // Waiting on Human — HITL sub-issues that require human intervention
  if (hitlSubIssues.length > 0) {
    parts.push("\n## Waiting on Human\n");
    parts.push(...hitlSubIssues.map((n) => `- [ ] #${n}`));
  }

  // Changes
  const commitLog = buildCommitLog(baseBranch, headBranch, cwd);
  const categorized = categorizeCommits(commitLog);
  const formattedCommits = formatCommitsByCategory(categorized);
  parts.push("\n## Changes\n", formattedCommits);

  // Learnings — merged from sub-issue runs
  const learningsSection = formatLearningsForPr(learnings);
  if (learningsSection) {
    parts.push("\n\n" + learningsSection);
  }

  return parts.join("\n");
}

export interface CreatePrdPrOptions {
  branch: string;
  baseBranch: string;
  prd: { number: number; title: string };
  completedSubIssues: number[];
  stuckSubIssues: number[];
  hitlSubIssues?: number[];
  blockedSubIssues?: BlockedSubIssue[];
  cwd: string;
  issueRepo?: string;
  /** Agent-generated summaries keyed by sub-issue number. */
  summaries?: Map<number, string>;
  /** Accumulated learnings from sub-issue runs. */
  learnings?: string[];
  /** When true (default), passes --draft to `gh pr create`. */
  draft?: boolean;
}

/** Push branch and create (or update) a draft PR for a PRD aggregate run. */
export function createPrdPr(options: CreatePrdPrOptions): CreatePrResult {
  const {
    branch,
    baseBranch,
    prd,
    completedSubIssues,
    stuckSubIssues,
    hitlSubIssues,
    blockedSubIssues,
    cwd,
    issueRepo,
    summaries,
    learnings,
  } = options;

  const push = pushBranch(branch, cwd, true);
  if (!push.ok) return { ok: false, prUrl: "", message: push.message };

  const prRepo = detectIssueRepo(cwd) ?? undefined;

  // Check if a PR already exists for this branch
  const existingPrUrl = execQuiet(
    `gh pr view "${branch}" --json url --jq .url`,
    cwd,
  );

  const prBody = buildPrdPrBody({
    prd,
    completedSubIssues,
    stuckSubIssues,
    hitlSubIssues,
    blockedSubIssues,
    baseBranch,
    headBranch: branch,
    cwd,
    issueRepo,
    prRepo,
    summaries,
    learnings,
  });
  const prTitle = sanitizePrText(formatPrTitle(prd.title));

  if (existingPrUrl) {
    // Update existing PR body
    if (
      execWithStdin(
        `gh pr edit "${existingPrUrl}" --body-file -`,
        sanitizePrText(prBody),
        cwd,
      ) === null
    ) {
      return {
        ok: false,
        prUrl: existingPrUrl,
        message: `Failed to update PRD PR body. PR exists at: ${existingPrUrl}`,
      };
    }
    return {
      ok: true,
      prUrl: existingPrUrl,
      message: `PRD PR updated: ${existingPrUrl}`,
    };
  }

  // Create new PR
  const draftFlag = options.draft !== false ? " --draft" : "";
  const prUrl = execWithStdin(
    `gh pr create --base "${baseBranch}" --head "${branch}" ` +
      `--title "${escapeQuotes(prTitle)}" --body-file -${draftFlag}`,
    sanitizePrText(prBody),
    cwd,
  );
  if (!prUrl) {
    return {
      ok: false,
      prUrl: "",
      message: `Failed to create PRD ${options.draft !== false ? "draft " : ""}PR. Branch '${branch}' pushed. Create PR manually.`,
    };
  }
  return {
    ok: true,
    prUrl,
    message: `PRD ${options.draft !== false ? "draft " : ""}PR created: ${prUrl}`,
  };
}
