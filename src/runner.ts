/**
 * TypeScript runner: the main orchestration loop for Ralphai.
 *
 * Drives an AI coding agent to autonomously implement tasks from plan
 * files. Handles plan detection, turn management, agent invocation,
 * stuck detection, auto-commit, learnings processing, and completion/PR
 * lifecycle.
 *
 * Exported entry point: `runRunner(options)`.
 */
import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, writeFileSync, renameSync } from "fs";
import { basename, dirname, join } from "path";

import {
  branchHasOpenWork,
  getCurrentCommitHash,
  getWorkingTreeDiffHash,
} from "./git-ops.ts";
import { processLearnings } from "./learnings.ts";
import {
  resolvePromptMode,
  assemblePrompt,
  type ResolvedPromptMode,
} from "./prompt.ts";
import { pullGithubIssues } from "./issues.ts";
import {
  archiveRun,
  createPr,
  createContinuousPr,
  updateContinuousPr,
  finalizeContinuousPr,
  pushBranch,
} from "./pr-lifecycle.ts";
import {
  detectPlan,
  collectBacklogPlans,
  countPlanTasks,
  countCompletedTasks,
  getPlanDescription,
  type PipelineDirs,
  type BlockedPlanInfo,
} from "./plan-detection.ts";
import { extractScope } from "./frontmatter.ts";
import { resolveScope } from "./scope.ts";
import {
  initReceipt,
  updateReceiptTurn,
  updateReceiptTasks,
  checkReceiptSource,
} from "./receipt.ts";
import { type ResolvedConfig } from "./config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from the CLI layer to the runner. */
export interface RunnerOptions {
  /** Resolved config (all layers merged). */
  config: ResolvedConfig;
  /** Working directory (repository root). */
  cwd: string;
  /** Path to the .ralphai directory. */
  ralphaiDir: string;
  /** Whether we're in a git worktree. */
  isWorktree: boolean;
  /** Main worktree root (empty if not a worktree). */
  mainWorktree: string;
  /** Whether --dry-run was passed. */
  dryRun: boolean;
  /** Whether --resume was passed. */
  resume: boolean;
  /** Whether --allow-dirty was passed. */
  allowDirty: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Run a git command and return trimmed stdout, or null on error. */
function gitExec(cmd: string, cwd: string): string | null {
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

/** Run a git command, returning true if it exits 0. */
function gitOk(cmd: string, cwd: string): boolean {
  try {
    execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Roll back a plan: move plan file from WIP back to backlog as a flat file.
 */
function rollbackPlan(planFile: string, backlogDir: string): void {
  const wipDir = dirname(planFile);
  const slug = basename(wipDir);
  const dest = join(backlogDir, `${slug}.md`);
  renameSync(planFile, dest);
  // Remove the now-empty WIP folder (best-effort)
  try {
    const { rmdirSync } = require("fs");
    rmdirSync(wipDir);
  } catch {
    // May have other files; that's OK
  }
  console.log(`Rolled back: moved plan to ${dest}`);
}

/**
 * Spawn the agent command, capture its output, and apply a timeout.
 *
 * Returns { output, exitCode, timedOut }.
 *
 * Exported for testing.
 */
export function spawnAgent(
  agentCommand: string,
  prompt: string,
  turnTimeout: number,
  cwd: string,
): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    // Split the agent command respecting quotes
    const parts = shellSplit(agentCommand);
    const cmd = parts[0]!;
    const args = [...parts.slice(1), prompt];

    let ac: AbortController | undefined;
    let timedOut = false;
    const spawnOpts: {
      cwd: string;
      stdio: ["pipe", "pipe", "pipe"];
      signal?: AbortSignal;
    } = {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    };

    if (turnTimeout > 0) {
      ac = new AbortController();
      spawnOpts.signal = ac.signal;
      setTimeout(() => {
        timedOut = true;
        ac!.abort();
      }, turnTimeout * 1000);
    }

    let child: ChildProcess;
    try {
      child = spawn(cmd, args, spawnOpts);
    } catch (err) {
      console.error(
        `Failed to spawn agent: ${err instanceof Error ? err.message : err}`,
      );
      resolve({ output: "", exitCode: 1, timedOut: false });
      return;
    }

    const chunks: Buffer[] = [];

    child.stdout?.on("data", (data: Buffer) => {
      process.stdout.write(data);
      chunks.push(data);
    });

    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
      chunks.push(data);
    });

    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf-8");
      resolve({ output, exitCode: code ?? 1, timedOut });
    });

    child.on("error", (err) => {
      if (timedOut) {
        const output = Buffer.concat(chunks).toString("utf-8");
        resolve({ output, exitCode: 124, timedOut: true });
      } else {
        console.error(`Agent error: ${err.message}`);
        const output = Buffer.concat(chunks).toString("utf-8");
        resolve({ output, exitCode: 1, timedOut: false });
      }
    });
  });
}

/**
 * Minimal shell-like argument splitting.
 * Handles single/double quotes and backslash escapes.
 *
 * Exported for testing.
 */
export function shellSplit(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let hasQuote = false; // Track if current token started with a quote

  for (const ch of cmd) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasQuote = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasQuote = true;
      continue;
    }
    if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (current.length > 0 || hasQuote) {
        parts.push(current);
        current = "";
        hasQuote = false;
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || hasQuote) {
    parts.push(current);
  }
  return parts;
}

/**
 * Print diagnostic info for blocked plans.
 */
function printBlockedDiagnostics(
  blocked: BlockedPlanInfo[],
  archiveDir: string,
): void {
  for (const b of blocked) {
    if (b.reason === "skipped") {
      console.log(`  ${b.slug}.md — skipped: branch or PR already exists`);
    } else {
      console.log(`  ${b.slug}.md — waiting on dependencies:`);
      for (const entry of b.reason.split(",")) {
        const colonIdx = entry.indexOf(":");
        if (colonIdx === -1) {
          console.log(`    - ${entry}`);
          continue;
        }
        const status = entry.slice(0, colonIdx);
        const dep = entry.slice(colonIdx + 1);
        if (status === "pending") {
          console.log(`    - ${dep} (still in backlog or in-progress)`);
        } else if (status === "missing") {
          console.log(`    - ${dep} (not found — never created or misnamed?)`);
        } else if (status === "self") {
          console.log(`    - ${dep} (depends on itself)`);
        } else {
          console.log(`    - ${entry}`);
        }
      }
    }
  }
  console.log();
  console.log(
    `Plans become runnable when their dependencies are archived in ${archiveDir}/.`,
  );
}

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------

function runDryRun(opts: RunnerOptions, dirs: PipelineDirs): void {
  const { config, cwd, isWorktree, mainWorktree } = opts;
  const mode = config.mode.value;
  const baseBranch = config.baseBranch.value;
  const continuous = config.continuous.value === "true";

  console.log();
  console.log("========================================");
  console.log("  Ralphai dry-run — preview only");
  console.log("========================================");

  if (isWorktree) {
    console.log(`[dry-run] Running in worktree (main repo: ${mainWorktree})`);
  }

  const result = detectPlan({ dirs, dryRun: true });
  if (!result.detected) {
    console.log("[dry-run] No runnable work found.");
    return;
  }

  const { planFile, planSlug } = result.plan;

  // Show flat-file promotion message (backlog flat file → in-progress folder)
  if (!result.plan.resumed) {
    const flatSource = join(dirs.backlogDir, `${planSlug}.md`);
    if (existsSync(flatSource)) {
      console.log(
        `[dry-run] Would promote flat file: ${flatSource} -> ${planFile}`,
      );
    }
  }
  const planScope = extractScope(planFile);
  const scopeResult = resolveScope({
    cwd,
    planScope,
    rootFeedbackCommands: config.feedbackCommands.value,
    workspacesConfig: config.workspaces.value
      ? JSON.stringify(config.workspaces.value)
      : undefined,
  });

  const planDesc = getPlanDescription(planFile);
  console.log(`[dry-run] Plan: ${basename(planFile)}`);
  console.log(`[dry-run] Description: ${planDesc}`);
  if (planScope) {
    console.log(`[dry-run] Scope: ${planScope}`);
  }

  if (continuous && mode === "pr") {
    console.log(
      "[dry-run] Continuous+PR mode: all backlog plans will run on a single branch with one PR.",
    );
  } else if (continuous && mode === "branch") {
    console.log(
      "[dry-run] Continuous+branch mode: all backlog plans will run on a single branch.",
    );
  }

  // The plan was detected as in-progress or from backlog
  if (result.plan.resumed) {
    const currentBranch =
      gitExec("git rev-parse --abbrev-ref HEAD", cwd) ?? "unknown";
    const progressFile = join(dirname(planFile), "progress.md");
    console.log("[dry-run] Mode: resume in-progress");
    console.log(`[dry-run] Would run on current branch: ${currentBranch}`);
    console.log(`[dry-run] Would keep existing ${progressFile}`);
  } else if (mode === "patch") {
    const currentBranch =
      gitExec("git rev-parse --abbrev-ref HEAD", cwd) ?? "unknown";
    const progressFile = join(dirs.wipDir, planSlug, "progress.md");
    console.log(
      `[dry-run] Mode: patch — would leave changes uncommitted on '${currentBranch}'`,
    );
    console.log(`[dry-run] Would initialize: ${progressFile}`);
  } else {
    const branch = `ralphai/${planSlug}`;
    const progressFile = join(dirs.wipDir, planSlug, "progress.md");

    // Check for bare "ralphai" branch blocking hierarchy
    if (gitOk('git show-ref --verify --quiet "refs/heads/ralphai"', cwd)) {
      console.log(
        `[dry-run] WARNING: Branch 'ralphai' exists and would block creation of '${branch}'.`,
      );
      console.log(
        "[dry-run] Fix: git branch -m ralphai ralphai-legacy  OR  git branch -D ralphai",
      );
    }

    const collision = branchHasOpenWork(branch, cwd);
    if (collision.collision) {
      console.log(`[dry-run] WARNING: ${collision.reason}`);
      console.log("[dry-run] This plan would be SKIPPED in a real run.");
    }

    if (mode === "pr") {
      console.log(
        `[dry-run] Mode: pr — would create branch from ${baseBranch}: ${branch}`,
      );
      console.log("[dry-run] Would create PR via 'gh' on completion");
    } else {
      console.log(
        `[dry-run] Mode: branch — would create branch from ${baseBranch}: ${branch}`,
      );
      console.log("[dry-run] Would commit but not push or create a PR");
    }
    console.log(`[dry-run] Would initialize: ${progressFile}`);
  }

  console.log(
    "[dry-run] No files moved, no branches created, no agent run executed.",
  );
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Run the Ralphai autonomous loop.
 */
export async function runRunner(opts: RunnerOptions): Promise<void> {
  const { config, cwd, isWorktree, mainWorktree, dryRun, resume } = opts;

  // Unpack config values
  const mode = config.mode.value;
  const baseBranch = config.baseBranch.value;
  const turns = config.turns.value;
  const maxStuck = config.maxStuck.value;
  const turnTimeout = config.turnTimeout.value;
  const agentCommand = config.agentCommand.value;
  const continuous = config.continuous.value === "true";
  const autoCommit = config.autoCommit.value === "true";
  const maxLearnings = config.maxLearnings.value;
  const promptModeConfig = config.promptMode.value;
  const issueSource = config.issueSource.value;
  const issueLabel = config.issueLabel.value;
  const issueInProgressLabel = config.issueInProgressLabel.value;
  const issueRepo = config.issueRepo.value;
  const issueCommentProgress = config.issueCommentProgress.value === "true";

  // Pipeline directories
  const dirs: PipelineDirs = {
    wipDir: join(opts.ralphaiDir, "pipeline", "in-progress"),
    backlogDir: join(opts.ralphaiDir, "pipeline", "backlog"),
    archiveDir: join(opts.ralphaiDir, "pipeline", "out"),
  };

  // Learnings file paths
  const learningsFile = join(opts.ralphaiDir, "LEARNINGS.md");
  const learningCandidatesFile = join(
    opts.ralphaiDir,
    "LEARNING_CANDIDATES.md",
  );

  // --- Patch mode guard: cannot run on main/master ---
  if (mode === "patch") {
    const currentBranch = gitExec("git rev-parse --abbrev-ref HEAD", cwd);
    if (currentBranch === "main" || currentBranch === "master") {
      console.log(`Patch mode cannot run on '${currentBranch}'.`);
      console.log();
      console.log(
        "Either run in branch mode (an isolated branch is created for you):",
      );
      console.log("  ralphai run --branch");
      console.log();
      console.log(
        "Or run in PR mode (a branch and pull request are created for you):",
      );
      console.log("  ralphai run --pr");

      // Peek at backlog to suggest a branch name
      const backlogPlans = collectBacklogPlans(dirs.backlogDir);
      if (backlogPlans.length > 0) {
        const slug = basename(backlogPlans[0]!).replace(/\.md$/, "");
        console.log();
        if (isWorktree) {
          console.log("Or create a worktree on a feature branch:");
          console.log(
            `  git worktree add ../<dir> -b ralphai/${slug} ${currentBranch}`,
          );
        } else {
          console.log("Or switch to a feature branch:");
          console.log(`  git checkout -b ralphai/${slug}`);
        }
      } else {
        console.log();
        if (isWorktree) {
          console.log("Or create a worktree on a feature branch:");
          console.log(
            `  git worktree add ../<dir> -b ralphai/<name> ${currentBranch}`,
          );
        } else {
          console.log("Or switch to a feature branch first.");
        }
      }
      console.log();
      process.exit(1);
    }
  }

  // --- Dry-run mode ---
  if (dryRun) {
    runDryRun(opts, dirs);
    return;
  }

  // --- Signal handling ---
  let interrupted = false;
  const handleSignal = () => {
    interrupted = true;
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  // --- Resolve prompt mode ---
  const promptMode: ResolvedPromptMode = resolvePromptMode(
    promptModeConfig as "auto" | "at-path" | "inline",
    agentCommand,
  );

  // --- Main plan loop ---
  let plansCompleted = 0;
  const completedPlans: string[] = [];
  let continuousBranch = "";
  let continuousPrUrl = "";
  const skippedSlugs = new Set<string>();

  while (!interrupted) {
    console.log();
    console.log("========================================");
    console.log("  Ralphai — detecting next task...");
    console.log("========================================");

    // Detect the next plan
    const detectResult = detectPlan({
      dirs,
      worktreeBranch: isWorktree
        ? (gitExec("git rev-parse --abbrev-ref HEAD", cwd) ?? undefined)
        : undefined,
      dryRun: false,
      skippedSlugs,
    });

    if (!detectResult.detected) {
      // No plan found — try GitHub issues if backlog is empty
      if (detectResult.reason === "empty-backlog") {
        const issueResult = pullGithubIssues({
          backlogDir: dirs.backlogDir,
          cwd,
          issueSource,
          issueLabel,
          issueInProgressLabel,
          issueRepo,
          issueCommentProgress,
        });

        if (issueResult.pulled) {
          // Re-run detection (loop back to the top)
          continue;
        }

        if (plansCompleted > 0) {
          console.log();
          console.log(
            `All done. Completed ${plansCompleted} plan(s) this session.`,
          );
          if (continuous && mode === "pr" && continuousPrUrl) {
            finalizeContinuousPr({
              branch: continuousBranch,
              baseBranch,
              completedPlans,
              backlogDir: dirs.backlogDir,
              cwd,
              prUrl: continuousPrUrl,
            });
          }
        } else {
          console.log(
            "Nothing to do — backlog is empty and no in-progress work. Add plans to .ralphai/pipeline/backlog/<slug>.md — see .ralphai/PLANNING.md",
          );
        }
        break;
      }

      // All plans blocked
      if (detectResult.reason === "all-blocked") {
        if (plansCompleted > 0) {
          console.log();
          console.log(
            `All done. Completed ${plansCompleted} plan(s) this session.`,
          );
          if (continuous && mode === "pr" && continuousPrUrl) {
            finalizeContinuousPr({
              branch: continuousBranch,
              baseBranch,
              completedPlans,
              backlogDir: dirs.backlogDir,
              cwd,
              prUrl: continuousPrUrl,
            });
          }
          break;
        }
        console.log(
          `Backlog has ${detectResult.backlogCount} plan(s), but none are runnable yet.`,
        );
        console.log();
        printBlockedDiagnostics(detectResult.blocked, dirs.archiveDir);
        break;
      }

      break;
    }

    // Plan detected — log it
    const { planFile, planSlug, resumed } = detectResult.plan;
    if (resumed) {
      console.log(`Found in-progress plan(s): ${planFile}`);
    } else {
      console.log(
        `Promoted flat file: ${dirs.backlogDir}/${planSlug}.md -> ${planFile}`,
      );
    }

    // --- Scope resolution ---
    const planScope = extractScope(planFile);
    const scopeResult = resolveScope({
      cwd,
      planScope,
      rootFeedbackCommands: config.feedbackCommands.value,
      workspacesConfig: config.workspaces.value
        ? JSON.stringify(config.workspaces.value)
        : undefined,
    });

    const feedbackCommands = scopeResult.feedbackCommands;
    const scopeHint = scopeResult.scopeHint;

    // --- Receipt: resolve path and check for cross-source conflicts ---
    const wipDir = join(dirs.wipDir, planSlug);
    const receiptFile = join(wipDir, "receipt.txt");
    const progressFile = join(wipDir, "progress.md");

    if (existsSync(receiptFile)) {
      if (!checkReceiptSource(opts.ralphaiDir, isWorktree)) {
        process.exit(1);
      }
    }

    // --- Plan description ---
    const planDesc = getPlanDescription(planFile);

    // --- Branch strategy ---
    let branch: string;

    if (resumed || resume) {
      const currentBranch =
        gitExec("git rev-parse --abbrev-ref HEAD", cwd) ?? "unknown";
      if (mode !== "patch" && currentBranch === baseBranch) {
        console.error(
          `ERROR: Resuming requires being on a ralphai/* branch, not '${baseBranch}'.`,
        );
        console.error(
          "Checkout the branch you want to resume, then run again.",
        );
        process.exit(1);
      }
      branch = currentBranch;
      console.log(`Resuming on existing branch: ${branch}`);
      console.log(`Resuming — keeping existing ${progressFile}`);
    } else if (mode === "patch") {
      branch = gitExec("git rev-parse --abbrev-ref HEAD", cwd) ?? "unknown";
      console.log(
        `Patch mode: working on current branch '${branch}' (changes will be left uncommitted)`,
      );

      // Initialize progress file
      mkdirSync(dirname(progressFile), { recursive: true });
      writeFileSync(progressFile, "## Progress Log\n\n");
      console.log(`Initialized ${progressFile}`);

      initReceipt(receiptFile, {
        source: isWorktree ? "worktree" : "main",
        worktree_path: isWorktree ? cwd : undefined,
        branch,
        slug: planSlug,
        plan_file: basename(planFile),
        turns_budget: turns,
      });
    } else if (continuous && continuousBranch) {
      // Continuous mode, subsequent plan: reuse the existing branch
      branch = continuousBranch;
      console.log(`Continuous mode: continuing on branch '${branch}'`);

      mkdirSync(dirname(progressFile), { recursive: true });
      writeFileSync(progressFile, "## Progress Log\n\n");
      console.log(`Initialized ${progressFile}`);

      initReceipt(receiptFile, {
        source: isWorktree ? "worktree" : "main",
        worktree_path: isWorktree ? cwd : undefined,
        branch,
        slug: planSlug,
        plan_file: basename(planFile),
        turns_budget: turns,
      });
    } else if (isWorktree) {
      // Worktree mode: the user already created the worktree on the right branch
      branch = gitExec("git rev-parse --abbrev-ref HEAD", cwd) ?? "unknown";

      if (branch === baseBranch) {
        console.error(
          `ERROR: Running in a worktree on the base branch '${baseBranch}'.`,
        );
        console.error("Create a worktree on a feature branch instead:");
        console.error(
          `  git worktree add ../<dir> -b ralphai/${planSlug} ${baseBranch}`,
        );
        rollbackPlan(planFile, dirs.backlogDir);
        process.exit(1);
      }
      console.log(
        `Worktree mode: working on existing branch '${branch}' (no checkout)`,
      );

      mkdirSync(dirname(progressFile), { recursive: true });
      writeFileSync(progressFile, "## Progress Log\n\n");
      console.log(`Initialized ${progressFile}`);

      initReceipt(receiptFile, {
        source: "worktree",
        worktree_path: cwd,
        branch,
        slug: planSlug,
        plan_file: basename(planFile),
        turns_budget: turns,
      });
    } else {
      // Branch/PR mode: create a new branch
      gitExec(`git checkout ${baseBranch}`, cwd);

      branch = `ralphai/${planSlug}`;

      // Guard: a bare "ralphai" branch blocks all "ralphai/*" branches
      if (gitOk('git show-ref --verify --quiet "refs/heads/ralphai"', cwd)) {
        console.log();
        console.error(
          `ERROR: Branch 'ralphai' exists and blocks creation of '${branch}'.`,
        );
        console.error(
          "Git cannot create 'ralphai/<slug>' when a branch named 'ralphai' already exists.",
        );
        console.error();
        console.error("Fix: delete or rename the stale branch, then retry:");
        console.error("  git branch -m ralphai ralphai-legacy   # rename");
        console.error("  git branch -D ralphai                # or delete");
        rollbackPlan(planFile, dirs.backlogDir);
        process.exit(1);
      }

      // Safety: check for existing branch/PR collision
      const collision = branchHasOpenWork(branch, cwd);
      if (collision.collision) {
        console.log();
        console.log(`SKIP: ${collision.reason}`);
        console.log(
          `Plan '${basename(planFile)}' already has open work. Skipping to next plan.`,
        );
        rollbackPlan(planFile, dirs.backlogDir);
        skippedSlugs.add(planSlug);
        continue;
      }

      if (!gitOk(`git checkout -b ${branch}`, cwd)) {
        console.log();
        console.error(`ERROR: Failed to create branch '${branch}'.`);
        rollbackPlan(planFile, dirs.backlogDir);
        process.exit(1);
      }
      console.log(`Created branch from ${baseBranch}: ${branch}`);

      // In continuous mode, remember the branch for subsequent plans
      if (continuous && (mode === "pr" || mode === "branch")) {
        continuousBranch = branch;
      }

      // Initialize progress file
      mkdirSync(dirname(progressFile), { recursive: true });
      writeFileSync(progressFile, "## Progress Log\n\n");
      console.log(`Initialized ${progressFile}`);

      initReceipt(receiptFile, {
        source: isWorktree ? "worktree" : "main",
        worktree_path: isWorktree ? cwd : undefined,
        branch,
        slug: planSlug,
        plan_file: basename(planFile),
        turns_budget: turns,
      });
    }

    // --- Turn loop (per-plan) ---
    let stuckCount = 0;
    let lastHash = getCurrentCommitHash(cwd) ?? "";
    let lastDiffHash = "";
    let completed = false;

    for (let turn = 1; (turns === 0 || turn <= turns) && !interrupted; turn++) {
      console.log();
      if (turns === 0) {
        console.log(
          `=== Ralphai turn ${turn} (unlimited) (plan: ${basename(planFile)}) ===`,
        );
      } else {
        console.log(
          `=== Ralphai turn ${turn} of ${turns} (plan: ${basename(planFile)}) ===`,
        );
      }

      // --- Turn summary: show task progress ---
      const totalTasks = countPlanTasks(planFile);
      const completedTasks = countCompletedTasks(progressFile);
      const currentTask = Math.min(completedTasks + 1, totalTasks);

      if (totalTasks > 0) {
        if (turns === 0) {
          console.log(
            `── Turn ${turn} ── Task ${currentTask} of ${totalTasks} ──`,
          );
        } else {
          console.log(
            `── Turn ${turn}/${turns} ── Task ${currentTask} of ${totalTasks} ──`,
          );
        }
      }

      // --- Assemble prompt ---
      const prompt = assemblePrompt({
        planFile,
        progressFile,
        promptMode,
        feedbackCommands,
        scopeHint,
        mode,
        learningsFile,
        learningCandidatesFile,
      });

      // --- Spawn agent ---
      const { output, exitCode, timedOut } = await spawnAgent(
        agentCommand,
        prompt,
        turnTimeout,
        cwd,
      );

      if (timedOut) {
        console.log();
        console.log(`WARNING: Agent command timed out after ${turnTimeout}s.`);
      }

      // --- Process learnings block (before completion check) ---
      const learningsResult = processLearnings(
        output,
        learningsFile,
        learningCandidatesFile,
        maxLearnings,
      );
      console.log(learningsResult.message);

      if (exitCode !== 0 && !timedOut) {
        console.log();
        console.log(`WARNING: Agent command exited with status ${exitCode}.`);
      }

      // --- Stuck detection (BEFORE auto-commit to avoid false progress) ---
      if (mode === "patch") {
        const currentDiffHash = getWorkingTreeDiffHash(cwd);
        if (currentDiffHash === lastDiffHash) {
          stuckCount++;
          console.log(
            `WARNING: No working-tree changes this turn (${stuckCount}/${maxStuck}).`,
          );
          if (stuckCount >= maxStuck) {
            console.error(
              `ERROR: ${maxStuck} consecutive turns with no progress. Aborting.`,
            );
            console.error(`Branch: ${branch}`);
            console.error(
              `Plan files remain in ${wipDir}/ — resume with another run.`,
            );
            process.exit(1);
          }
        } else {
          stuckCount = 0;
          lastDiffHash = currentDiffHash;
        }
      } else {
        const currentHash = getCurrentCommitHash(cwd) ?? "";
        if (currentHash === lastHash) {
          stuckCount++;
          console.log(
            `WARNING: No new commits this turn (${stuckCount}/${maxStuck}).`,
          );
          if (stuckCount >= maxStuck) {
            console.error(
              `ERROR: ${maxStuck} consecutive turns with no progress. Aborting.`,
            );
            console.error(`Branch: ${branch}`);
            console.error(
              `Plan files remain in ${wipDir}/ — resume with another run.`,
            );
            // In continuous+PR mode, push partial work
            if (continuous && mode === "pr" && continuousBranch) {
              console.log("Pushing partial work to continuous branch...");
              pushBranch(branch, cwd);
            }
            process.exit(1);
          }
        } else {
          stuckCount = 0;
          lastHash = currentHash;
        }
      }

      // --- Auto-commit dirty state (AFTER stuck detection) ---
      const hasDiff =
        !gitOk("git diff --quiet HEAD", cwd) ||
        !gitOk("git diff --cached --quiet", cwd);
      if (hasDiff) {
        if (!autoCommit && mode === "patch") {
          console.log(
            "WARNING: Agent left uncommitted changes (autoCommit=false, skipping recovery commit).",
          );
        } else {
          console.log(
            "WARNING: Agent left uncommitted changes. Auto-committing recovery snapshot.",
          );
          gitExec("git add -A", cwd);
          gitExec(
            `git commit -m "chore(ralphai): auto-commit uncommitted changes from turn ${turn}"`,
            cwd,
          );
        }
      }

      // --- Update receipt turn counter ---
      updateReceiptTurn(receiptFile);

      // --- Update receipt tasks_completed from progress.md ---
      updateReceiptTasks(receiptFile, progressFile);

      // --- Check for completion ---
      if (output.includes("<promise>COMPLETE</promise>")) {
        console.log();
        console.log(`Plan complete after ${turn} turns: ${planDesc}`);
        completedPlans.push(basename(planFile));

        archiveRun({
          wipFiles: [planFile],
          archiveDir: dirs.archiveDir,
          issueInProgressLabel,
          cwd,
        });

        if (continuous && mode === "pr") {
          if (!continuousPrUrl) {
            const prResult = createContinuousPr({
              branch,
              baseBranch,
              completedPlans,
              backlogDir: dirs.backlogDir,
              cwd,
              firstPlanDescription: planDesc,
            });
            if (prResult.ok) {
              continuousPrUrl = prResult.prUrl;
            }
          } else {
            updateContinuousPr({
              branch,
              baseBranch,
              completedPlans,
              backlogDir: dirs.backlogDir,
              cwd,
              prUrl: continuousPrUrl,
            });
          }
        } else if (mode === "pr") {
          createPr({
            branch,
            baseBranch,
            planDescription: planDesc,
            cwd,
          });
        } else if (mode === "branch") {
          console.log(
            `Branch mode: changes committed on branch '${branch}'. No PR created.`,
          );
          console.log(
            "Tip: use --pr to automatically push and open a pull request.",
          );
        } else {
          console.log(
            `Patch mode: changes left in working tree on branch '${branch}'. No commits created.`,
          );
          console.log(
            "Tip: use --branch to create an isolated branch with commits.",
          );
        }

        plansCompleted++;
        completed = true;
        break;
      }
    }

    if (!completed) {
      console.log();
      console.log(`Finished ${turns} turns without completing: ${planDesc}`);
      console.log(`Plan files remain in ${wipDir}/ — resume with another run.`);
      console.log(`Branch: ${branch}`);

      // In continuous+PR mode, push partial work and update PR
      if (continuous && mode === "pr") {
        if (continuousPrUrl) {
          console.log("Pushing partial work to continuous PR...");
          pushBranch(branch, cwd);
        } else if (plansCompleted > 0) {
          console.log("Pushing partial work...");
          pushBranch(branch, cwd);
        }
      }
      // Non-continuous or interrupted: exit
      break;
    }

    // --- Non-continuous modes: stop after one plan ---
    if (!continuous) {
      if (mode !== "pr") {
        console.log();
        console.log("Plan complete. Stopping after one plan by default.");
        console.log("Tip: use --continuous to keep processing backlog plans.");
      }
      break;
    }

    // Loop back to pick the next plan (turn budget resets)
  }

  // --- Continuous mode: finalize PR when backlog is drained ---
  if (continuous && mode === "pr" && continuousPrUrl && plansCompleted > 0) {
    finalizeContinuousPr({
      branch: continuousBranch,
      baseBranch,
      completedPlans,
      backlogDir: dirs.backlogDir,
      cwd,
      prUrl: continuousPrUrl,
    });
  }

  // Clean up signal handlers
  process.removeListener("SIGINT", handleSignal);
  process.removeListener("SIGTERM", handleSignal);
}
