/**
 * PR lifecycle: archive completed plans, push branches, create/update/finalize PRs.
 *
 * Ported from runner/lib/pr.sh (238 lines). Uses child_process.execSync for
 * git and gh CLI calls. Functions return structured results instead of
 * printing directly, letting the caller decide how to display output.
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, renameSync } from "fs";
import { basename, dirname, join } from "path";
import { extractIssueFrontmatter } from "./frontmatter.ts";
import { checkGhAvailable, detectIssueRepo } from "./issues.ts";
import { collectBacklogPlans } from "./plan-detection.ts";

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
}

export interface ContinuousPrOptions {
  branch: string;
  baseBranch: string;
  completedPlans: string[];
  backlogDir: string;
  cwd: string;
}

export interface ArchiveRunOptions {
  wipFiles: string[];
  archiveDir: string;
  issueInProgressLabel: string;
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

function buildCommitLog(base: string, head: string, cwd: string): string {
  return (
    execQuiet(`git log "${base}".."${head}" --oneline --no-decorate`, cwd) ?? ""
  );
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
 * the linked GitHub issue. Matches `archive_run()` in pr.sh.
 */
export function archiveRun(options: ArchiveRunOptions): {
  archived: boolean;
  message: string;
} {
  const { wipFiles, archiveDir, issueInProgressLabel, cwd } = options;
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
      execQuiet(
        `gh issue edit ${issueNumber} --repo "${repo}" ` +
          `--remove-label "${issueInProgressLabel}"`,
        cwd,
      );
    }
  }

  return { archived: true, message: `Archived ${planDir} -> ${dest}` };
}

// ---------------------------------------------------------------------------
// Standard PR (single-plan mode)
// ---------------------------------------------------------------------------

/** Push branch and create a PR. Matches `create_pr()` in pr.sh. */
export function createPr(options: CreatePrOptions): CreatePrResult {
  const { branch, baseBranch, planDescription, cwd } = options;
  const push = pushBranch(branch, cwd, true);
  if (!push.ok) return { ok: false, prUrl: "", message: push.message };

  const commitLog = buildCommitLog(baseBranch, branch, cwd);
  const prBody = `## Summary\n\n${planDescription}\n\n## Commits\n\n\`\`\`\n${commitLog || "_No commits._"}\n\`\`\``;
  const esc = (s: string) => s.replace(/"/g, '\\"');

  const prUrl = execQuiet(
    `gh pr create --base "${baseBranch}" --head "${branch}" ` +
      `--title "${esc(planDescription)}" --body "${esc(prBody)}"`,
    cwd,
  );
  if (!prUrl) {
    return {
      ok: false,
      prUrl: "",
      message: `Failed to create PR. Branch '${branch}' pushed. Create PR manually.`,
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

  return { ok: true, prUrl, message: `PR created: ${prUrl}` };
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
): string {
  const parts: string[] = ["## Completed Plans\n"];
  if (completedPlans.length > 0) {
    parts.push(...completedPlans.map((p) => `- [x] ${p}`));
  } else {
    parts.push("_None yet._");
  }

  const remaining = collectBacklogPlans(backlogDir).map((p) => basename(p));
  parts.push("\n## Remaining Plans\n");
  if (remaining.length > 0) {
    parts.push(...remaining.map((r) => `- [ ] ${r}`));
  } else {
    parts.push("_Backlog empty — all plans processed._");
  }

  const commitLog = buildCommitLog(baseBranch, headBranch, cwd);
  parts.push("\n## Commits\n", "```", commitLog || "_No commits._", "```");
  return parts.join("\n");
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
  } = options;
  const push = pushBranch(branch, cwd, true);
  if (!push.ok) return { ok: false, prUrl: "", message: push.message };

  const prBody = buildContinuousPrBody(
    completedPlans,
    backlogDir,
    baseBranch,
    branch,
    cwd,
  );
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const prTitle = `ralphai: ${firstPlanDescription}`;

  const prUrl = execQuiet(
    `gh pr create --base "${baseBranch}" --head "${branch}" ` +
      `--title "${esc(prTitle)}" --body "${esc(prBody)}" --draft`,
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
  const { branch, baseBranch, prUrl, completedPlans, backlogDir, cwd } =
    options;
  const push = pushBranch(branch, cwd, false);
  if (!push.ok) return push;
  if (!prUrl) return { ok: false, message: "No PR URL to update" };

  const prBody = buildContinuousPrBody(
    completedPlans,
    backlogDir,
    baseBranch,
    branch,
    cwd,
  );
  const esc = (s: string) => s.replace(/"/g, '\\"');
  if (
    execQuiet(`gh pr edit "${prUrl}" --body "${esc(prBody)}"`, cwd) === null
  ) {
    return { ok: false, message: "Failed to update PR body" };
  }
  return { ok: true, message: `PR updated: ${prUrl}` };
}

/** Update body and mark PR ready for review. Matches `finalize_continuous_pr()`. */
export function finalizeContinuousPr(
  options: ContinuousPrOptions & { prUrl: string },
): PushResult {
  const { baseBranch, prUrl, completedPlans, backlogDir, cwd } = options;
  if (!prUrl) return { ok: false, message: "No continuous PR to finalize" };

  const headBranch =
    execQuiet("git rev-parse --abbrev-ref HEAD", cwd) ?? "HEAD";
  const prBody = buildContinuousPrBody(
    completedPlans,
    backlogDir,
    baseBranch,
    headBranch,
    cwd,
  );
  const esc = (s: string) => s.replace(/"/g, '\\"');

  execQuiet(`gh pr edit "${prUrl}" --body "${esc(prBody)}"`, cwd);
  if (execQuiet(`gh pr ready "${prUrl}"`, cwd) === null) {
    return { ok: false, message: "Failed to mark PR as ready" };
  }
  return { ok: true, message: `PR ready for review: ${prUrl}` };
}
