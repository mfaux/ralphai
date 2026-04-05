/**
 * PR lifecycle: archive completed plans, push branches, create/update/finalize PRs.
 *
 * Uses child_process.execSync for git and gh CLI calls. Functions return
 * structured results instead of printing directly, letting the caller
 * decide how to display output.
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, renameSync } from "fs";
import { basename, dirname, join } from "path";
import { extractIssueFrontmatter } from "./frontmatter.ts";
import {
  checkGhAvailable,
  commitTypeFromTitle,
  detectIssueRepo,
} from "./issues.ts";
import { transitionDone } from "./label-lifecycle.ts";
import { collectBacklogPlans } from "./plan-detection.ts";
import {
  buildPrBody,
  buildContinuousPrBodyStructured,
  buildClosesBlock,
  buildCommitLog,
  categorizeCommits,
  formatCommitsByCategory,
} from "./pr-description.ts";

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
}

export interface ContinuousPrOptions {
  branch: string;
  baseBranch: string;
  completedPlans: string[];
  backlogDir: string;
  cwd: string;
  /** PRD issue driving this continuous run. */
  prd?: { number: number; title: string };
  /** Repository that owns the issues (e.g. "org/repo"). */
  issueRepo?: string;
  /** Agent-generated PR description from `<pr-summary>` block. */
  summary?: string;
  /** Accumulated learnings from agent runs to include in PR body. */
  learnings?: string[];
}

export interface ArchiveRunOptions {
  wipFiles: string[];
  archiveDir: string;
  cwd: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execQuiet(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Run a command and pipe `body` to its stdin.
 *
 * Used for `gh pr create --body-file -` and `gh pr edit --body-file -` so
 * the PR body never passes through shell interpolation. This avoids
 * corruption when the body contains backticks, `$`, or other shell
 * metacharacters (e.g. agent-generated Markdown with inline code).
 */
function execWithStdin(cmd: string, body: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      input: body,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
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
  });
  const esc = (s: string) => s.replace(/"/g, '\\"');

  const prUrl = execWithStdin(
    `gh pr create --base "${baseBranch}" --head "${branch}" ` +
      `--title "${esc(planDescription)}" --body-file - --draft`,
    prBody,
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
// Continuous mode PR
// ---------------------------------------------------------------------------

/** Build PR body with completed/remaining plans and commit log. */
export function buildContinuousPrBody(
  completedPlans: string[],
  backlogDir: string,
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
  const remaining = collectBacklogPlans(backlogDir).map((p) => basename(p));
  return buildContinuousPrBodyStructured(
    completedPlans,
    remaining,
    baseBranch,
    headBranch,
    cwd,
    options,
  );
}

/** Create draft PR for continuous mode. Matches `create_continuous_pr()`. */
export function createContinuousPr(
  options: ContinuousPrOptions & { firstPlanDescription: string },
): CreatePrResult {
  const {
    branch,
    baseBranch,
    firstPlanDescription,
    completedPlans,
    backlogDir,
    cwd,
    prd,
    issueRepo,
  } = options;
  const push = pushBranch(branch, cwd, true);
  if (!push.ok) return { ok: false, prUrl: "", message: push.message };

  const prRepo = detectIssueRepo(cwd) ?? undefined;
  const prBody = buildContinuousPrBody(
    completedPlans,
    backlogDir,
    baseBranch,
    branch,
    cwd,
    { prdNumber: prd?.number, issueRepo, prRepo, learnings: options.learnings },
  );
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const prTitle = prd
    ? formatPrTitle(prd.title)
    : `ralphai: ${firstPlanDescription}`;

  const prUrl = execWithStdin(
    `gh pr create --base "${baseBranch}" --head "${branch}" ` +
      `--title "${esc(prTitle)}" --body-file - --draft`,
    prBody,
    cwd,
  );
  if (!prUrl) {
    return {
      ok: false,
      prUrl: "",
      message: `Failed to create draft PR. Branch '${branch}' pushed. Create PR manually.`,
    };
  }
  return { ok: true, prUrl, message: `Draft PR created: ${prUrl}` };
}

/** Push commits and refresh PR body. Matches `update_continuous_pr()`. */
export function updateContinuousPr(
  options: ContinuousPrOptions & { prUrl: string },
): PushResult {
  const {
    branch,
    baseBranch,
    prUrl,
    completedPlans,
    backlogDir,
    cwd,
    prd,
    issueRepo,
  } = options;
  const push = pushBranch(branch, cwd, false);
  if (!push.ok) return push;
  if (!prUrl) return { ok: false, message: "No PR URL to update" };

  const prRepo = detectIssueRepo(cwd) ?? undefined;
  const prBody = buildContinuousPrBody(
    completedPlans,
    backlogDir,
    baseBranch,
    branch,
    cwd,
    {
      prdNumber: prd?.number,
      issueRepo,
      prRepo,
      summary: options.summary,
      learnings: options.learnings,
    },
  );
  if (
    execWithStdin(`gh pr edit "${prUrl}" --body-file -`, prBody, cwd) === null
  ) {
    return { ok: false, message: "Failed to update PR body" };
  }
  return { ok: true, message: `PR updated: ${prUrl}` };
}

/** Refresh final draft PR body when continuous mode finishes. */
export function finalizeContinuousPr(
  options: ContinuousPrOptions & { prUrl: string },
): PushResult {
  const { baseBranch, prUrl, completedPlans, backlogDir, cwd, prd, issueRepo } =
    options;
  if (!prUrl) return { ok: false, message: "No continuous PR to finalize" };

  const headBranch =
    execQuiet("git rev-parse --abbrev-ref HEAD", cwd) ?? "HEAD";
  const prRepo = detectIssueRepo(cwd) ?? undefined;
  const prBody = buildContinuousPrBody(
    completedPlans,
    backlogDir,
    baseBranch,
    headBranch,
    cwd,
    {
      prdNumber: prd?.number,
      issueRepo,
      prRepo,
      summary: options.summary,
      learnings: options.learnings,
    },
  );
  if (
    execWithStdin(`gh pr edit "${prUrl}" --body-file -`, prBody, cwd) === null
  ) {
    return { ok: false, message: "Failed to refresh final draft PR body" };
  }
  return { ok: true, message: `Draft PR updated: ${prUrl}` };
}

// ---------------------------------------------------------------------------
// PRD aggregate PR
// ---------------------------------------------------------------------------

export interface PrdPrBodyOptions {
  prd: { number: number; title: string };
  completedSubIssues: number[];
  stuckSubIssues: number[];
  baseBranch: string;
  headBranch: string;
  cwd: string;
  issueRepo?: string;
  prRepo?: string;
}

/** Build a PR body for an aggregate PRD pull request. */
export function buildPrdPrBody(options: PrdPrBodyOptions): string {
  const {
    prd,
    completedSubIssues,
    stuckSubIssues,
    baseBranch,
    headBranch,
    cwd,
    issueRepo,
    prRepo,
  } = options;

  const parts: string[] = [];

  // Title / description
  parts.push(`PRD #${prd.number}: ${prd.title}\n`);

  // Closes references — PRD + completed sub-issues only (not stuck ones)
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

  // Stuck sub-issues
  if (stuckSubIssues.length > 0) {
    parts.push("\n## Stuck Sub-Issues\n");
    parts.push(...stuckSubIssues.map((n) => `- [ ] #${n}`));
  }

  // Changes
  const commitLog = buildCommitLog(baseBranch, headBranch, cwd);
  const categorized = categorizeCommits(commitLog);
  const formattedCommits = formatCommitsByCategory(categorized);
  parts.push("\n## Changes\n", formattedCommits);

  return parts.join("\n");
}

export interface CreatePrdPrOptions {
  branch: string;
  baseBranch: string;
  prd: { number: number; title: string };
  completedSubIssues: number[];
  stuckSubIssues: number[];
  cwd: string;
  issueRepo?: string;
}

/** Push branch and create (or update) a draft PR for a PRD aggregate run. */
export function createPrdPr(options: CreatePrdPrOptions): CreatePrResult {
  const {
    branch,
    baseBranch,
    prd,
    completedSubIssues,
    stuckSubIssues,
    cwd,
    issueRepo,
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
    baseBranch,
    headBranch: branch,
    cwd,
    issueRepo,
    prRepo,
  });
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const prTitle = formatPrTitle(prd.title);

  if (existingPrUrl) {
    // Update existing PR body
    if (
      execWithStdin(
        `gh pr edit "${existingPrUrl}" --body-file -`,
        prBody,
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
      `--title "${esc(prTitle)}" --body-file - --draft`,
    prBody,
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
