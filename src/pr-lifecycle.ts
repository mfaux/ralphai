/**
 * PR lifecycle: archive completed plans, push branches, create/update/finalize PRs.
 *
 * Uses exec helpers from exec.ts for git and gh CLI calls. Functions return
 * structured results instead of printing directly, letting the caller
 * decide how to display output.
 */
import { existsSync, mkdirSync, renameSync } from "fs";
import { basename, dirname, join } from "path";
import { execQuiet, execWithStdin } from "./exec.ts";
import { extractIssueFrontmatter } from "./frontmatter.ts";
import {
  checkGhAvailable,
  commitTypeFromTitle,
  detectIssueRepo,
} from "./issues.ts";
import { transitionDone } from "./label-lifecycle.ts";
import type { BlockedSubIssue } from "./prd-hitl.ts";
import { formatLearningsForPr } from "./learnings.ts";
import {
  buildPrBody,
  buildClosesBlock,
  buildCommitLog,
  categorizeCommits,
  formatCommitsByCategory,
} from "./pr-description.ts";
import { stripAnsi } from "./utils.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a PR title from an issue/PRD title, ensuring a conventional-commit
 * prefix.  If the title already starts with one (e.g. `"fix: broken login"`),
 * it is returned as-is; otherwise `"feat: "` is prepended.
 */
function formatPrTitle(title: string): string {
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
  renameSync(planDir, dest);

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
  const prTitle = sanitizePrText(formatPrTitle(planDescription));

  const prUrl = execWithStdin(
    `gh pr create --base "${baseBranch}" --head "${branch}" ` +
      `--title "${escapeQuotes(prTitle)}" --body-file - --draft`,
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

  if (
    options.issueSource === "github" &&
    options.issueNumber &&
    options.issueCommentProgress
  ) {
    const repo = detectIssueRepo(cwd, options.issueRepo);
    if (repo) {
      execQuiet(
        `gh issue comment ${options.issueNumber} --repo "${repo}" ` +
          `--body "Ralphai created a PR for this issue: ${prUrl}"`,
        cwd,
      );
    }
  }

  return { ok: true, prUrl, message: `Draft PR created: ${prUrl}` };
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

  // Create new draft PR
  const prUrl = execWithStdin(
    `gh pr create --base "${baseBranch}" --head "${branch}" ` +
      `--title "${escapeQuotes(prTitle)}" --body-file - --draft`,
    sanitizePrText(prBody),
    cwd,
  );
  if (!prUrl) {
    return {
      ok: false,
      prUrl: "",
      message: `Failed to create PRD draft PR. Branch '${branch}' pushed. Create PR manually.`,
    };
  }
  return { ok: true, prUrl, message: `PRD draft PR created: ${prUrl}` };
}
