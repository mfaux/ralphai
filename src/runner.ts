/**
 * TypeScript runner: the main orchestration loop for Ralphai.
 *
 * Drives an AI coding agent to autonomously implement tasks from plan
 * files. Handles plan detection, iteration management, agent invocation,
 * stuck detection, auto-commit, learnings processing, and completion/PR
 * lifecycle.
 *
 * Exported entry point: `runRunner(options)`.
 */
import { spawn, execSync, type ChildProcess } from "child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  renameSync,
} from "fs";
import { basename, dirname, join } from "path";

import { branchHasOpenWork, getCurrentCommitHash } from "./git-ops.ts";
import { createIpcServer, type IpcServer } from "./ipc-server.ts";
import {
  getSocketPath,
  type IpcMessage,
  type OutputMessage,
} from "./ipc-protocol.ts";
import {
  getRepoPipelineDirs,
  getRepoLearningsPath,
  getRepoCandidatesPath,
} from "./global-state.ts";
import { processLearnings } from "./learnings.ts";
import { assemblePrompt } from "./prompt.ts";
import { extractProgressBlock, appendProgressBlock } from "./progress.ts";
import { extractPrSummary } from "./pr-summary.ts";
import { peekGithubIssues, pullGithubIssues } from "./issues.ts";
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
  detectPlanFormat,
  countCompletedTasks,
  getPlanDescription,
  type PipelineDirs,
  type BlockedPlanInfo,
} from "./plan-detection.ts";
import { extractScope, extractIssueFrontmatter } from "./frontmatter.ts";
import { resolveScope } from "./scope.ts";
import {
  initReceipt,
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
  /** Target a specific backlog plan by filename (e.g. "my-plan.md"). */
  plan?: string;
  /** PRD issue driving this run (set by --prd=N). */
  prd?: { number: number; title: string };
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
  iterationTimeout: number,
  cwd: string,
  outputLogPath?: string,
  ipcBroadcast?: (msg: IpcMessage) => void,
): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    // Split the agent command respecting quotes
    const parts = shellSplit(agentCommand);
    const cmd = parts[0]!;
    const args = [...parts.slice(1), prompt];

    // Open a write stream for the agent output log (append mode).
    // Errors are swallowed so logging never breaks the run.
    let logStream: ReturnType<typeof createWriteStream> | undefined;
    if (outputLogPath) {
      try {
        logStream = createWriteStream(outputLogPath, { flags: "a" });
      } catch {
        // Best-effort: if we can't open the log, continue without it
      }
    }

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

    if (iterationTimeout > 0) {
      ac = new AbortController();
      spawnOpts.signal = ac.signal;
      setTimeout(() => {
        timedOut = true;
        ac!.abort();
      }, iterationTimeout * 1000);
    }

    let child: ChildProcess;
    try {
      child = spawn(cmd, args, spawnOpts);
    } catch (err) {
      console.error(
        `Failed to spawn agent: ${err instanceof Error ? err.message : err}`,
      );
      logStream?.end();
      resolve({ output: "", exitCode: 1, timedOut: false });
      return;
    }

    // Close stdin so the agent knows no input is coming.
    // Without this, agents that read or wait for stdin EOF will hang.
    child.stdin?.end();

    const chunks: Buffer[] = [];

    child.stdout?.on("data", (data: Buffer) => {
      process.stdout.write(data);
      logStream?.write(data);
      chunks.push(data);
      ipcBroadcast?.({
        type: "output",
        data: data.toString(),
        stream: "stdout",
      });
    });

    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
      logStream?.write(data);
      chunks.push(data);
      ipcBroadcast?.({
        type: "output",
        data: data.toString(),
        stream: "stderr",
      });
    });

    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf-8");
      if (logStream) {
        logStream.end(() => {
          resolve({ output, exitCode: code ?? 1, timedOut });
        });
      } else {
        resolve({ output, exitCode: code ?? 1, timedOut });
      }
    });

    child.on("error", (err) => {
      logStream?.end();
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
  const baseBranch = config.baseBranch.value;
  const continuous = config.continuous.value === "true";

  console.log();
  console.log("========================================");
  console.log("  Ralphai dry-run — preview only");
  console.log("========================================");

  const result = detectPlan({ dirs, dryRun: true });
  if (!result.detected) {
    // No local plans — check GitHub issues (read-only, no side effects).
    const peek = peekGithubIssues({
      cwd,
      issueSource: config.issueSource.value,
      issueLabel: config.issueLabel.value,
      issueRepo: config.issueRepo.value,
    });
    if (peek.found) {
      console.log(`[dry-run] No local plans found, but ${peek.message}`);
      console.log(
        "[dry-run] Run without --dry-run to pull the oldest issue into the backlog.",
      );
    } else {
      console.log(`[dry-run] No runnable work found. (${peek.message})`);
    }
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

  if (continuous) {
    console.log(
      "[dry-run] Continuous mode: all backlog plans will run on a single worktree branch with one draft PR.",
    );
  }

  const branch = `ralphai/${planSlug}`;
  const progressFile = join(dirs.wipDir, planSlug, "progress.md");
  const worktreeDir = join(cwd, "..", ".ralphai-worktrees", planSlug);

  if (isWorktree) {
    console.log(`[dry-run] Running in worktree (main repo: ${mainWorktree})`);
    console.log(`[dry-run] Would continue on current branch: ${branch}`);
  } else if (result.plan.resumed) {
    console.log(
      "[dry-run] Would reuse existing worktree for in-progress plan.",
    );
  } else {
    console.log(`[dry-run] Would create worktree: ${worktreeDir}`);
  }

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
    console.log(
      "[dry-run] This plan would be reused or skipped in a real run.",
    );
  }

  console.log(`[dry-run] Branch: ${branch} (from ${baseBranch})`);
  console.log(`[dry-run] Would initialize: ${progressFile}`);
  console.log(
    "[dry-run] Would push commits and open a draft PR on completion.",
  );

  console.log(
    "[dry-run] No files moved, no worktrees created, no agent run executed.",
  );
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Run the Ralphai autonomous loop.
 */
export async function runRunner(opts: RunnerOptions): Promise<void> {
  const { config, cwd, isWorktree, mainWorktree, dryRun, resume, plan, prd } =
    opts;

  // Unpack config values
  const baseBranch = config.baseBranch.value;
  const maxStuck = config.maxStuck.value;
  const iterationTimeout = config.iterationTimeout.value;
  const agentCommand = config.agentCommand.value;
  const continuous = config.continuous.value === "true";
  const autoCommit = config.autoCommit.value === "true";
  const maxLearnings = config.maxLearnings.value;
  const issueSource = config.issueSource.value;
  const issueLabel = config.issueLabel.value;
  const issueInProgressLabel = config.issueInProgressLabel.value;
  const issueDoneLabel = config.issueDoneLabel.value;
  const issueRepo = config.issueRepo.value;
  const issueCommentProgress = config.issueCommentProgress.value === "true";

  // Pipeline directories (resolved from global state)
  const dirs: PipelineDirs = getRepoPipelineDirs(cwd);

  // Learnings file paths (resolved from global state)
  const learningsFile = getRepoLearningsPath(cwd);
  const learningCandidatesFile = getRepoCandidatesPath(cwd);

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

  // --- Main plan loop ---
  let plansCompleted = 0;
  const completedPlans: string[] = [];
  let continuousBranch = "";
  let continuousPrUrl = "";
  let lastPrSummary: string | undefined;
  const skippedSlugs = new Set<string>();
  let activePidFile: string | null = null;
  let activeIpcServer: IpcServer | null = null;

  while (!interrupted) {
    console.log();
    console.log("========================================");
    console.log("  Ralphai — detecting next iteration...");
    console.log("========================================");

    // Detect the next plan
    const detectResult = detectPlan({
      dirs,
      worktreeBranch: isWorktree
        ? (gitExec("git rev-parse --abbrev-ref HEAD", cwd) ?? undefined)
        : undefined,
      dryRun: false,
      skippedSlugs,
      targetPlan: plan,
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
          if (continuous && continuousPrUrl) {
            const finalize = finalizeContinuousPr({
              branch: continuousBranch,
              baseBranch,
              completedPlans,
              backlogDir: dirs.backlogDir,
              cwd,
              prUrl: continuousPrUrl,
              prd,
              issueRepo,
            });
            console.log(finalize.message);
          }
        } else {
          console.log(
            `Nothing to do — backlog is empty and no in-progress work. Add plans to ${dirs.backlogDir}/<slug>.md`,
          );
        }
        break;
      }

      // Target plan not found
      if (detectResult.reason === "target-not-found") {
        console.log(
          `Plan '${plan}' not found in backlog (${detectResult.backlogCount} plan(s) available).`,
        );
        break;
      }

      // All plans blocked
      if (detectResult.reason === "all-blocked") {
        if (plansCompleted > 0) {
          console.log();
          console.log(
            `All done. Completed ${plansCompleted} plan(s) this session.`,
          );
          if (continuous && continuousPrUrl) {
            const finalize = finalizeContinuousPr({
              branch: continuousBranch,
              baseBranch,
              completedPlans,
              backlogDir: dirs.backlogDir,
              cwd,
              prUrl: continuousPrUrl,
              prd,
              issueRepo,
            });
            console.log(finalize.message);
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

    // --- Issue frontmatter (for PR creation and issue commenting) ---
    const issueFm = extractIssueFrontmatter(planFile);

    // --- Receipt: resolve path and check for cross-source conflicts ---
    const wipDir = join(dirs.wipDir, planSlug);
    const receiptFile = join(wipDir, "receipt.txt");
    const progressFile = join(wipDir, "progress.md");

    if (existsSync(receiptFile)) {
      if (!checkReceiptSource(dirs.wipDir, isWorktree)) {
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
      if (currentBranch === baseBranch) {
        console.error(
          `ERROR: Resuming requires being on a ralphai/* branch, not '${baseBranch}'.`,
        );
        console.error(
          "Checkout the branch you want to resume, then run again.",
        );
        process.exit(1);
      }
      branch = currentBranch;
      if (continuous && !continuousBranch) {
        continuousBranch = branch;
      }
      console.log(`Resuming on existing branch: ${branch}`);
      console.log(`Resuming — keeping existing ${progressFile}`);
    } else if (continuous && continuousBranch) {
      // Continuous mode, subsequent plan: reuse the existing branch
      branch = continuousBranch;
      console.log(`Continuous mode: continuing on branch '${branch}'`);

      mkdirSync(dirname(progressFile), { recursive: true });
      writeFileSync(progressFile, "## Progress Log\n\n");
      console.log(`Initialized ${progressFile}`);

      initReceipt(receiptFile, {
        worktree_path: isWorktree ? cwd : undefined,
        branch,
        slug: planSlug,
        plan_file: basename(planFile),
      });
    } else if (isWorktree) {
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
      console.log(`Running in worktree on branch '${branch}'`);
      if (continuous) {
        continuousBranch = branch;
      }

      mkdirSync(dirname(progressFile), { recursive: true });
      writeFileSync(progressFile, "## Progress Log\n\n");
      console.log(`Initialized ${progressFile}`);

      initReceipt(receiptFile, {
        worktree_path: cwd,
        branch,
        slug: planSlug,
        plan_file: basename(planFile),
      });
    } else {
      console.error("ERROR: Ralphai runs plans only inside managed worktrees.");
      rollbackPlan(planFile, dirs.backlogDir);
      process.exit(1);
    }

    // --- Write PID file so the TUI can discover and stop this runner ---
    const pidFile = join(wipDir, "runner.pid");
    writeFileSync(pidFile, String(process.pid), "utf8");
    activePidFile = pidFile;

    // --- Start IPC server for real-time output streaming ---
    let ipcServer: IpcServer | null = null;
    const socketPath = getSocketPath(dirs.wipDir, planSlug);
    try {
      ipcServer = await createIpcServer(socketPath);
      activeIpcServer = ipcServer;
    } catch (err) {
      console.log(
        `WARNING: IPC server failed to start: ${err instanceof Error ? err.message : err}`,
      );
      console.log("Continuing without real-time streaming.");
    }

    // --- Iteration loop (per-plan) ---
    let stuckCount = 0;
    let lastHash = getCurrentCommitHash(cwd) ?? "";
    let completed = false;

    // Detect plan format once per plan; the result flows into the
    // iteration log header and future downstream consumers.
    const planContent = readFileSync(planFile, "utf-8");
    const { format: planFormat, totalTasks } = detectPlanFormat(planContent);
    let iterationNumber = 0;

    while (!interrupted) {
      iterationNumber++;
      const completedTasks = countCompletedTasks(progressFile, planFormat);
      const currentTask = Math.min(completedTasks + 1, totalTasks);

      console.log();
      if (totalTasks > 0) {
        console.log(
          `=== Ralphai iteration ${iterationNumber} — task ${currentTask} of ${totalTasks} (plan: ${basename(planFile)}) ===`,
        );
      } else {
        console.log(
          `=== Ralphai iteration ${iterationNumber} (plan: ${basename(planFile)}) ===`,
        );
      }

      // --- Assemble prompt ---
      const prompt = assemblePrompt({
        planFile,
        progressFile,
        feedbackCommands,
        scopeHint,
        learningsFile,
        learningCandidatesFile,
        planFormat,
      });

      // --- Spawn agent (with output log persistence) ---
      const outputLogPath = join(wipDir, "agent-output.log");
      try {
        const header = `\n--- Iteration ${iterationNumber} ---\n`;
        writeFileSync(outputLogPath, header, { flag: "a" });
      } catch {
        // Best-effort; non-fatal if we can't write the header
      }
      const { output, exitCode, timedOut } = await spawnAgent(
        agentCommand,
        prompt,
        iterationTimeout,
        cwd,
        outputLogPath,
        ipcServer ? (msg) => ipcServer!.broadcast(msg) : undefined,
      );

      if (timedOut) {
        console.log();
        console.log(
          `WARNING: Agent command timed out after ${iterationTimeout}s.`,
        );
      }

      // --- Process learnings block (before completion check) ---
      const learningsResult = processLearnings(
        output,
        learningsFile,
        learningCandidatesFile,
        maxLearnings,
      );
      console.log(learningsResult.message);

      // --- Extract and append progress block ---
      const progressContent = extractProgressBlock(output);
      if (progressContent) {
        appendProgressBlock(progressFile, iterationNumber, progressContent);
        console.log(
          `Appended progress block from iteration ${iterationNumber}.`,
        );
        // Broadcast progress to connected dashboard clients
        if (ipcServer) {
          ipcServer.broadcast({
            type: "progress",
            iteration: iterationNumber,
            content: progressContent,
          });
        }
      }

      if (exitCode !== 0 && !timedOut) {
        console.log();
        console.log(`WARNING: Agent command exited with status ${exitCode}.`);
      }

      // --- Stuck detection (BEFORE auto-commit to avoid false progress) ---
      const currentHash = getCurrentCommitHash(cwd) ?? "";
      if (currentHash === lastHash) {
        stuckCount++;
        console.log(
          `WARNING: No new commits this iteration (${stuckCount}/${maxStuck}).`,
        );
        if (stuckCount >= maxStuck) {
          console.error(
            `ERROR: ${maxStuck} consecutive iterations with no progress. Aborting.`,
          );
          console.error(`Branch: ${branch}`);
          console.error(
            `Plan files remain in ${wipDir}/ — resume with another run.`,
          );
          if (continuous && continuousBranch) {
            console.log("Pushing partial work to continuous branch...");
            const push = pushBranch(branch, cwd);
            console.log(push.message);
          }
          // Clean up PID file and IPC server before exiting
          if (ipcServer) {
            ipcServer.close();
          }
          if (activePidFile) {
            try {
              rmSync(activePidFile, { force: true });
            } catch {
              // Best-effort cleanup
            }
          }
          process.exit(1);
        }
      } else {
        stuckCount = 0;
        lastHash = currentHash;
      }

      // --- Auto-commit dirty state (AFTER stuck detection) ---
      const hasDiff =
        !gitOk("git diff --quiet HEAD", cwd) ||
        !gitOk("git diff --cached --quiet", cwd);
      if (hasDiff) {
        if (!autoCommit) {
          console.log(
            "WARNING: Agent left uncommitted changes (autoCommit=false, skipping recovery commit).",
          );
        } else {
          console.log(
            "WARNING: Agent left uncommitted changes. Auto-committing recovery snapshot.",
          );
          gitExec("git add -A", cwd);
          gitExec(
            `git commit -m "chore(ralphai): auto-commit uncommitted changes from iteration ${iterationNumber}"`,
            cwd,
          );
        }
      }

      // --- Update receipt tasks_completed from progress.md ---
      updateReceiptTasks(receiptFile, progressFile, planFormat);
      // Broadcast updated tasks-completed count to connected dashboard clients
      if (ipcServer) {
        const updatedTasksCompleted = countCompletedTasks(
          progressFile,
          planFormat,
        );
        ipcServer.broadcast({
          type: "receipt",
          tasksCompleted: updatedTasksCompleted,
        });
      }

      // --- Check for completion ---
      if (output.includes("<promise>COMPLETE</promise>")) {
        console.log();
        console.log(
          `Plan complete after ${iterationNumber} iterations: ${planDesc}`,
        );
        completedPlans.push(basename(planFile));

        // Extract agent-generated PR description
        const prSummary = extractPrSummary(output) ?? undefined;
        if (prSummary) lastPrSummary = prSummary;

        // Remove PID file and close IPC server before archiving so they
        // don't end up in out/
        if (ipcServer) {
          // Broadcast completion before closing so dashboard clients
          // know the plan finished
          ipcServer.broadcast({ type: "complete", planSlug });
          ipcServer.close();
          ipcServer = null;
          activeIpcServer = null;
        }
        try {
          rmSync(pidFile, { force: true });
        } catch {
          // Best-effort cleanup
        }
        activePidFile = null;

        archiveRun({
          wipFiles: [planFile],
          archiveDir: dirs.archiveDir,
          issueInProgressLabel,
          issueDoneLabel,
          cwd,
        });

        if (continuous) {
          if (!continuousPrUrl) {
            const prResult = createContinuousPr({
              branch,
              baseBranch,
              completedPlans,
              backlogDir: dirs.backlogDir,
              cwd,
              firstPlanDescription: planDesc,
              prd,
              issueRepo,
              summary: prSummary,
            });
            console.log(prResult.message);
            if (prResult.ok) {
              continuousPrUrl = prResult.prUrl;
            }
          } else {
            const update = updateContinuousPr({
              branch,
              baseBranch,
              completedPlans,
              backlogDir: dirs.backlogDir,
              cwd,
              prUrl: continuousPrUrl,
              prd,
              issueRepo,
              summary: prSummary,
            });
            console.log(update.message);
          }
        } else {
          const prResult = createPr({
            branch,
            baseBranch,
            planDescription: planDesc,
            cwd,
            issueSource: issueFm.source || issueSource,
            issueNumber: issueFm.issue,
            issueRepo,
            issueCommentProgress,
            prd: issueFm.prd,
            summary: prSummary,
          });
          console.log(prResult.message);
        }

        plansCompleted++;
        completed = true;
        break;
      }
    }

    if (!completed && interrupted) {
      console.log();
      console.log(`Interrupted during plan: ${planDesc}`);
      console.log(`Plan files remain in ${wipDir}/ — resume with another run.`);
      console.log(`Branch: ${branch}`);

      if (continuous) {
        console.log("Pushing partial work...");
        const push = pushBranch(
          branch,
          cwd,
          !continuousPrUrl && plansCompleted === 0,
        );
        console.log(push.message);
      }
      break;
    }

    // --- Non-continuous modes: stop after one plan ---
    if (!continuous) {
      console.log();
      console.log("Plan complete. Stopping after one plan by default.");
      console.log("Tip: use --continuous to keep processing backlog plans.");
      break;
    }

    // Loop back to pick the next plan
  }

  // --- Continuous mode: refresh draft PR when backlog is drained ---
  if (continuous && continuousPrUrl && plansCompleted > 0) {
    const finalize = finalizeContinuousPr({
      branch: continuousBranch,
      baseBranch,
      completedPlans,
      backlogDir: dirs.backlogDir,
      cwd,
      prUrl: continuousPrUrl,
      prd,
      issueRepo,
      summary: lastPrSummary,
    });
    console.log(finalize.message);
  }

  // --- Clean up IPC server on exit (interrupted or drained backlog) ---
  if (activeIpcServer) {
    activeIpcServer.close();
    activeIpcServer = null;
  }

  // --- Clean up PID file on exit (interrupted or drained backlog) ---
  if (activePidFile) {
    try {
      rmSync(activePidFile, { force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  // Clean up signal handlers
  process.removeListener("SIGINT", handleSignal);
  process.removeListener("SIGTERM", handleSignal);
}
