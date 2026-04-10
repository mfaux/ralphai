/**
 * TypeScript runner: the main orchestration loop for Ralphai.
 *
 * Drives an AI coding agent to autonomously implement tasks from plan
 * files. Handles plan detection, iteration management, agent invocation,
 * stuck detection, learnings processing, and completion/PR
 * lifecycle.
 *
 * Exported entry point: `runRunner(options)`.
 */
import { spawn, type ChildProcess } from "child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
  renameSync,
} from "fs";
import { basename, dirname, join } from "path";

import { branchHasOpenWork, getCurrentCommitHash } from "./git-ops.ts";
import { execQuiet } from "./exec.ts";
import { createExecutor, type AgentExecutor } from "./executor/index.ts";
import {
  checkDockerAvailability,
  pullDockerImage,
  buildDockerArgs,
  formatDockerCommand,
} from "./executor/docker.ts";
import { createIpcServer, type IpcServer } from "./ipc-server.ts";
import { getSocketPath, type IpcMessage } from "./ipc-protocol.ts";
import { getRepoPipelineDirs } from "./global-state.ts";
import { parseLearningContent } from "./learnings.ts";
import { assemblePrompt } from "./prompt.ts";
import {
  FEEDBACK_WRAPPER_FILENAME,
  parseFeedbackCommands,
} from "./feedback-wrapper.ts";
import { writeFeedbackWrapper } from "./worktree/index.ts";
import { appendProgressBlock } from "./progress.ts";
import {
  generateNonce,
  detectCompletion,
  extractNoncedBlock,
} from "./sentinel.ts";

import {
  transitionStuck,
  prdTransitionStuck,
  prdTransitionDone,
} from "./label-lifecycle.ts";
import {
  peekGithubIssues,
  peekPrdIssues,
  pullGithubIssues,
  pullPrdSubIssue,
  checkAllPrdSubIssuesDone,
  issueBranchName,
} from "./issues.ts";
import { archiveRun, createPr } from "./pr-lifecycle.ts";
import { runCompletionGate, formatGateRejection } from "./completion-gate.ts";
import { runReviewPass, getChangedFiles } from "./review-pass.ts";
import {
  detectPlan,
  detectPlanFormat,
  countCompletedTasks,
  getPlanDescription,
  type PipelineDirs,
  type PlanFormat,
  type BlockedPlanInfo,
} from "./plan-detection.ts";
import {
  extractScope,
  extractIssueFrontmatter,
  extractFeedbackScope,
} from "./frontmatter.ts";
import { resolveScope } from "./scope.ts";
import { detectFeedbackScope } from "./scope-detection.ts";
import {
  initReceipt,
  updateReceiptTasks,
  updateReceiptPrUrl,
  updateReceiptOutcome,
  checkReceiptSource,
} from "./receipt.ts";
import {
  type ResolvedConfig,
  type ConfigValues,
  type ConfigSource,
  configValues,
  computeEffectiveSandbox,
} from "./config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result returned from the runner after processing plans. */
export interface RunnerResult {
  /** Slugs of plans that got stuck during this run. */
  stuckSlugs: string[];
  /** Agent-generated PR summary from the last completed plan (if any). */
  lastPrSummary?: string;
  /** Learnings accumulated across all iterations of this run. */
  accumulatedLearnings: string[];
}

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
  /** Whether --once was passed (process a single plan then exit). */
  once: boolean;
  /** Target a specific backlog plan by filename (e.g. "my-plan.md"). */
  plan?: string;
  /** PRD issue driving this run (set by --prd=N). */
  prd?: { number: number; title: string };
  /** Skip per-plan PR creation (used by PRD target to defer to aggregate PR). */
  skipPrCreation?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
    rmdirSync(wipDir);
  } catch {
    // May have other files; that's OK
  }
  console.log(`Rolled back: moved plan to ${dest}`);
}

/**
 * Handle a failed gate result: reject (within budget), mark stuck (zero
 * tasks), or force-accept (partial progress). Returns the disposition so
 * the caller can decide control flow (`continue` / `break` / fall-through).
 *
 * Side-effects: increments `state.gateRejectionCount`, sets
 * `state.lastGateRejection`, calls `markStuck()`, and logs warnings.
 */
function handleGateFailure(
  gateResult: { passed: boolean; reason: string; details: string[] },
  context: string,
  opts: {
    maxGateRejections: number;
    nonce: string;
    totalTasks: number;
    progressFile: string;
    planFormat: PlanFormat;
    markStuckFn: (reason: string) => void;
    state: {
      gateRejectionCount: number;
      lastGateRejection: string | undefined;
    };
  },
): "rejected" | "stuck" | "accepted" {
  const {
    maxGateRejections,
    nonce,
    totalTasks,
    progressFile,
    planFormat,
    markStuckFn,
    state,
  } = opts;

  // Within rejection budget — reject and re-invoke
  if (state.gateRejectionCount < maxGateRejections) {
    state.gateRejectionCount++;
    state.lastGateRejection = formatGateRejection(gateResult, nonce);
    console.log();
    console.log(
      `Completion gate rejected${context} (${state.gateRejectionCount}/${maxGateRejections}): ${gateResult.reason}`,
    );
    for (const detail of gateResult.details) {
      console.log(`  - ${detail}`);
    }
    console.log("Re-invoking agent to address the issues above.");
    return "rejected";
  }

  // Budget exhausted — check for zero completion
  const currentCompleted = countCompletedTasks(progressFile, planFormat);
  if (currentCompleted === 0 && totalTasks > 0) {
    markStuckFn(
      `Stuck: zero tasks completed (0/${totalTasks})${context} after ${maxGateRejections} gate rejections — refusing to force-accept.`,
    );
    return "stuck";
  }

  // Partial progress — force-accept with warning
  console.log();
  console.log(
    `WARNING: Completion gate still failing${context} after ${maxGateRejections} rejections — accepting anyway.`,
  );
  for (const detail of gateResult.details) {
    console.log(`  - ${detail}`);
  }
  return "accepted";
}

function ensureProgressFile(progressFile: string): void {
  if (existsSync(progressFile)) {
    console.log(`Resuming — keeping existing ${progressFile}`);
    return;
  }

  mkdirSync(dirname(progressFile), { recursive: true });
  writeFileSync(progressFile, "## Progress Log\n\n");
  console.log(`Initialized ${progressFile}`);
}

/**
 * Spawn the agent command, capture its output, and apply a timeout.
 *
 * Returns { output, exitCode, timedOut }.
 *
 * When `nonce` is provided, it is set as the `RALPHAI_NONCE` environment
 * variable in the agent subprocess so mock agents in tests can easily
 * echo nonce-stamped sentinel tags.
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
  nonce?: string,
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
      env?: Record<string, string | undefined>;
    } = {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: nonce ? { ...process.env, RALPHAI_NONCE: nonce } : undefined,
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
// Exit summary
// ---------------------------------------------------------------------------

/**
 * Print an exit summary reporting completed and stuck items.
 * Format: "Completed N, skipped M (stuck)" with stuck slugs listed.
 *
 * Exported for testing.
 */
export function printExitSummary(
  completed: number,
  stuckSlugs: string[],
): void {
  if (completed === 0 && stuckSlugs.length === 0) return;

  console.log();
  const parts: string[] = [`Completed ${completed}`];
  if (stuckSlugs.length > 0) {
    parts.push(`skipped ${stuckSlugs.length} (stuck)`);
  }
  console.log(parts.join(", "));
  if (stuckSlugs.length > 0) {
    for (const slug of stuckSlugs) {
      console.log(`  - ${slug}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------

function runDryRun(
  opts: RunnerOptions,
  dirs: PipelineDirs,
  cfg: ConfigValues,
  effectiveSandbox: "none" | "docker",
): void {
  const { cwd, isWorktree, mainWorktree } = opts;
  const baseBranch = cfg.baseBranch;

  console.log();
  console.log("========================================");
  console.log("  Ralphai dry-run — preview only");
  console.log("========================================");

  const result = detectPlan({ dirs, dryRun: true });
  if (!result.detected) {
    // No local plans — check GitHub issues (read-only, no side effects).
    // Priority chain: PRD issues first, then regular issues.
    const peekOpts = {
      cwd,
      issueSource: cfg.issueSource,
      standaloneLabel: cfg.standaloneLabel,
      issueRepo: cfg.issueRepo,
      issuePrdLabel: cfg.prdLabel,
    };
    const prdPeek = peekPrdIssues(peekOpts);
    if (prdPeek.found) {
      console.log(`[dry-run] No local plans found, but ${prdPeek.message}`);
      console.log(
        "[dry-run] Would fetch sub-issues via REST API (skipped in dry-run)",
      );
      console.log(
        "[dry-run] Would discover parent PRD via REST API (skipped in dry-run)",
      );
      console.log(
        "[dry-run] Would query blockers via GraphQL API (skipped in dry-run)",
      );
      console.log(
        "[dry-run] Run without --dry-run to pull the oldest PRD sub-issue into the backlog.",
      );
      return;
    }
    const peek = peekGithubIssues(peekOpts);
    if (peek.found) {
      console.log(`[dry-run] No local plans found, but ${peek.message}`);
      console.log(
        "[dry-run] Would discover parent PRD via REST API (skipped in dry-run)",
      );
      console.log(
        "[dry-run] Would query blockers via GraphQL API (skipped in dry-run)",
      );
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

  const planDesc = getPlanDescription(planFile);
  console.log(`[dry-run] Plan: ${basename(planFile)}`);
  console.log(`[dry-run] Description: ${planDesc}`);
  if (planScope) {
    console.log(`[dry-run] Scope: ${planScope}`);
  }

  const branch = issueBranchName(planDesc);
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

  // Docker dry-run: print the full docker run command
  if (effectiveSandbox === "docker") {
    const agentCmd = cfg.agentCommand;
    const dockerEnvVars = cfg.dockerEnvVars
      ? cfg.dockerEnvVars
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];
    const dockerMountsVal = cfg.dockerMounts
      ? cfg.dockerMounts
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];
    const dockerArgs = buildDockerArgs({
      agentCommand: agentCmd,
      prompt: "<PROMPT>",
      cwd: worktreeDir,
      dockerImage: cfg.dockerImage || undefined,
      dockerEnvVars,
      dockerMounts: dockerMountsVal,
      mainGitDir: mainWorktree ? join(mainWorktree, ".git") : undefined,
    });
    console.log(`[dry-run] Docker command: ${formatDockerCommand(dockerArgs)}`);
  }

  console.log(
    "[dry-run] No files moved, no worktrees created, no agent run executed.",
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the GitHub repo slug from explicit config or by parsing the issue URL.
 * Returns null when neither source provides a value.
 */
function resolveIssueRepoSlug(
  configRepo: string,
  issueUrl: string | undefined,
): string | null {
  if (configRepo) return configRepo;
  if (issueUrl) {
    const m = issueUrl.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\//);
    return m?.[1] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Run the Ralphai autonomous loop.
 */
export async function runRunner(opts: RunnerOptions): Promise<RunnerResult> {
  const {
    config,
    cwd,
    isWorktree,
    mainWorktree,
    dryRun,
    resume,
    plan,
    once,
    skipPrCreation,
  } = opts;

  // Convert to plain values — business logic uses ConfigValues, not
  // ResolvedConfig. The only piece of source metadata we thread through
  // is sandbox.source (needed by computeEffectiveSandbox).
  const cfg = configValues(config);
  const sandboxSource: ConfigSource = config.sandbox.source;

  // Unpack config values
  const baseBranch = cfg.baseBranch;
  const maxStuck = cfg.maxStuck;
  const iterationTimeout = cfg.iterationTimeout;
  const agentCommand = cfg.agentCommand;
  const issueSource = cfg.issueSource;
  const standaloneLabel = cfg.standaloneLabel;
  const subissueLabel = cfg.subissueLabel;
  const issuePrdLabel = cfg.prdLabel;
  const issueRepo = cfg.issueRepo;
  const issueCommentProgress = cfg.issueCommentProgress === "true";
  const review = cfg.review === "true";

  // --- Fail-early Docker availability check ---
  // computeEffectiveSandbox re-probes Docker at runner start. When sandbox
  // was auto-detected, it silently falls back to "none"; when explicit, it
  // returns an actionable error.
  const sandboxResult = computeEffectiveSandbox(
    cfg,
    sandboxSource,
    checkDockerAvailability,
  );
  if (sandboxResult.error) {
    console.error(`ERROR: ${sandboxResult.error}`);
    process.exit(1);
  }
  const effectiveSandbox = sandboxResult.sandbox;

  // --- Pull Docker image to ensure local cache is up to date ---
  // Fail-open: if the pull fails (e.g. no network), continue with the
  // cached image. Skipped in dry-run mode (no side effects).
  if (effectiveSandbox === "docker" && !dryRun) {
    const pullResult = pullDockerImage(
      agentCommand,
      cfg.dockerImage || undefined,
    );
    if (pullResult.success) {
      console.log(`Docker image up to date: ${pullResult.image}`);
    } else {
      console.warn(
        `WARNING: Failed to pull ${pullResult.image} — using cached image if available.`,
      );
    }
  }

  // Create the executor based on sandbox config
  const dockerConfig =
    effectiveSandbox === "docker"
      ? {
          dockerImage: cfg.dockerImage || undefined,
          dockerEnvVars: cfg.dockerEnvVars
            ? cfg.dockerEnvVars
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : undefined,
          dockerMounts: cfg.dockerMounts
            ? cfg.dockerMounts
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : undefined,
          // Mount the main repo's .git directory for worktree support.
          // Without this, git operations inside the container fail because
          // the worktree's .git file points to a path outside the container.
          mainGitDir: mainWorktree ? join(mainWorktree, ".git") : undefined,
        }
      : undefined;
  const executor: AgentExecutor = createExecutor(
    effectiveSandbox,
    dockerConfig,
  );

  // Pipeline directories (resolved from global state)
  const dirs: PipelineDirs = getRepoPipelineDirs(cwd);

  // Accumulated learnings across iterations (in-memory)
  const accumulatedLearnings: string[] = [];

  // --- Dry-run mode ---
  if (dryRun) {
    runDryRun(opts, dirs, cfg, effectiveSandbox);
    return { stuckSlugs: [], accumulatedLearnings: [] };
  }

  // --- Signal handling ---
  let interrupted = false;
  const handleSignal = () => {
    interrupted = true;
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  // --- Main plan loop (drain-by-default) ---
  let plansCompleted = 0;
  let lastPrSummary: string | undefined;
  const skippedSlugs = new Set<string>();
  const stuckSlugs: string[] = [];
  let activePidFile: string | null = null;
  let activeIpcServer: IpcServer | null = null;

  // When a regular (non-PRD) GitHub issue is pulled, the runner should
  // process exactly that one issue and then stop. PRD sub-issues are
  // different — the runner continues draining all sub-issues.
  let pulledRegularGithubIssue = false;

  while (!interrupted) {
    console.log();
    console.log("========================================");
    console.log("  Ralphai — detecting next iteration...");
    console.log("========================================");

    // Detect the next plan
    const detectResult = detectPlan({
      dirs,
      worktreeBranch: isWorktree
        ? (execQuiet("git rev-parse --abbrev-ref HEAD", cwd) ?? undefined)
        : undefined,
      dryRun: false,
      skippedSlugs,
      targetPlan: plan,
    });

    if (!detectResult.detected) {
      // No plan found — try GitHub issues if backlog is empty
      if (detectResult.reason === "empty-backlog") {
        const issueHitlLabel = cfg.issueHitlLabel;
        const pullOpts = {
          backlogDir: dirs.backlogDir,
          cwd,
          issueSource,
          standaloneLabel,
          subissueLabel,
          issueRepo,
          issueCommentProgress,
          issuePrdLabel,
          issueHitlLabel,
        };

        // Priority chain: try PRD sub-issues first, then regular issues
        const prdResult = pullPrdSubIssue(pullOpts);
        if (prdResult.pulled) {
          continue;
        }

        const issueResult = pullGithubIssues(pullOpts);
        if (issueResult.pulled) {
          // Regular GitHub issue pulled — process it, then stop the drain
          // loop after completion. (PRD sub-issues use `continue` above
          // without setting this flag, so they keep draining.)
          pulledRegularGithubIssue = true;
          continue;
        }

        if (plansCompleted === 0 && stuckSlugs.length === 0) {
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
        if (plansCompleted === 0 && stuckSlugs.length === 0) {
          console.log(
            `Backlog has ${detectResult.backlogCount} plan(s), but none are runnable yet.`,
          );
          console.log();
          printBlockedDiagnostics(detectResult.blocked, dirs.archiveDir);
        }
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
      rootFeedbackCommands: cfg.feedbackCommands,
      rootPrFeedbackCommands: cfg.prFeedbackCommands ?? "",
      workspacesConfig: cfg.workspaces
        ? JSON.stringify(cfg.workspaces)
        : undefined,
    });

    const feedbackCommands = scopeResult.feedbackCommands;
    const scopeHint = scopeResult.scopeHint;

    // PR-tier feedback commands: passed to the completion gate only (not the
    // agent prompt). Scope-resolved for monorepos via resolveScope above.
    const prFeedbackCommands = scopeResult.prFeedbackCommands;

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
        execQuiet("git rev-parse --abbrev-ref HEAD", cwd) ?? "unknown";
      if (currentBranch === baseBranch) {
        console.error(
          `ERROR: Resuming requires being on a feature branch, not '${baseBranch}'.`,
        );
        console.error(
          "Checkout the branch you want to resume, then run again.",
        );
        process.exit(1);
      }
      branch = currentBranch;
      console.log(`Resuming on existing branch: ${branch}`);
      ensureProgressFile(progressFile);
    } else if (isWorktree) {
      branch = execQuiet("git rev-parse --abbrev-ref HEAD", cwd) ?? "unknown";

      if (branch === baseBranch) {
        console.error(
          `ERROR: Running in a worktree on the base branch '${baseBranch}'.`,
        );
        console.error("Create a worktree on a feature branch instead:");
        console.error(
          `  git worktree add ../<dir> -b ${issueBranchName(planDesc)} ${baseBranch}`,
        );
        rollbackPlan(planFile, dirs.backlogDir);
        process.exit(1);
      }
      console.log(`Running in worktree on branch '${branch}'`);

      ensureProgressFile(progressFile);

      initReceipt(receiptFile, {
        worktree_path: cwd,
        branch,
        slug: planSlug,
        plan_file: basename(planFile),
        sandbox: effectiveSandbox,
      });
    } else {
      console.error("ERROR: Ralphai runs plans only inside managed worktrees.");
      rollbackPlan(planFile, dirs.backlogDir);
      process.exit(1);
    }

    // --- Write PID file so the CLI can discover and stop this runner ---
    const pidFile = join(wipDir, "runner.pid");
    writeFileSync(pidFile, String(process.pid), "utf8");
    activePidFile = pidFile;

    // --- Write feedback wrapper script to the WIP slug directory ---
    // Written here (not in prepareWorktree) so it lives in pipeline state
    // instead of the user's worktree, avoiding untracked-file noise.
    // Regenerated every run so config changes are picked up.
    writeFeedbackWrapper(wipDir, parseFeedbackCommands(feedbackCommands));

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
    let stuck = false;

    // Completion gate: tracks consecutive rejections to prevent infinite loops.
    // After maxGateRejections consecutive rejections the COMPLETE is accepted.
    const gateState = {
      gateRejectionCount: 0,
      lastGateRejection: undefined as string | undefined,
    };
    const maxGateRejections = 2;

    // Review pass: runs at most once per plan after the gate passes.
    let reviewDone = false;
    let reviewPassMadeChanges = false;

    /** Mark the current plan as stuck: cleanup resources, update labels. */
    function markStuck(reason: string): void {
      console.log();
      console.log(reason);
      if (ipcServer) {
        ipcServer.close();
        ipcServer = null;
        activeIpcServer = null;
      }
      if (activePidFile) {
        try {
          rmSync(activePidFile, { force: true });
        } catch {
          // Best-effort cleanup
        }
      }
      activePidFile = null;
      stuck = true;
      skippedSlugs.add(planSlug);
      stuckSlugs.push(planSlug);
      updateReceiptOutcome(receiptFile, "stuck");
      if (issueFm.source === "github" && issueFm.issue) {
        const repo = resolveIssueRepoSlug(issueRepo, issueFm.issueUrl);
        if (repo) {
          transitionStuck({ number: issueFm.issue, repo }, cwd);
          if (issueFm.prd) {
            prdTransitionStuck({ number: issueFm.prd, repo }, cwd);
          }
        }
      }
    }

    // Detect plan format once per plan; the result flows into the
    // iteration log header and future downstream consumers.
    const planContent = readFileSync(planFile, "utf-8");
    const { format: planFormat, totalTasks } = detectPlanFormat(planContent);
    let iterationNumber = 0;

    // Resolve feedback scope: explicit frontmatter overrides auto-detection.
    const fmFeedbackScope = extractFeedbackScope(planFile);
    const resolvedFeedbackScope =
      fmFeedbackScope || detectFeedbackScope(planContent);

    // Generate a per-plan nonce for sentinel tag authentication.
    // Injected into the prompt so agents echo it back; the runner
    // only recognizes tags whose nonce matches, preventing false
    // positives from tool output that contains bare sentinel strings.
    const nonce = generateNonce();

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
      // Check for the feedback wrapper script in the WIP slug directory
      // (pipeline state). When it exists the prompt references the
      // absolute path so the agent can invoke it from the worktree.
      const wrapperFile = join(wipDir, FEEDBACK_WRAPPER_FILENAME);
      const wrapperPath = existsSync(wrapperFile) ? wrapperFile : undefined;

      const prompt = assemblePrompt({
        planFile,
        progressFile,
        feedbackCommands,
        scopeHint,
        feedbackScope: resolvedFeedbackScope,
        learnings: accumulatedLearnings,
        planFormat,
        gateRejection: gateState.lastGateRejection,
        nonce,
        wrapperPath,
      });

      // --- Spawn agent (with output log persistence) ---
      const outputLogPath = join(wipDir, "agent-output.log");
      try {
        const header = `\n--- Iteration ${iterationNumber} ---\n`;
        writeFileSync(outputLogPath, header, { flag: "a" });
      } catch {
        // Best-effort; non-fatal if we can't write the header
      }
      const { output, exitCode, timedOut } = await executor.spawn({
        agentCommand,
        prompt,
        iterationTimeout,
        cwd,
        outputLogPath,
        ipcBroadcast: ipcServer
          ? (msg) => ipcServer!.broadcast(msg)
          : undefined,
        nonce,
        feedbackWrapperPath: wrapperPath,
      });

      if (timedOut) {
        console.log();
        console.log(
          `WARNING: Agent command timed out after ${iterationTimeout}s.`,
        );
      }

      // --- Process learnings block (before completion check) ---
      // Only recognize nonce-stamped tags to prevent false positives from
      // tool output that happens to contain bare sentinel strings.
      const learningsBlock = extractNoncedBlock(output, "learnings", nonce);
      if (learningsBlock === null) {
        console.log("WARNING: No <learnings> block found in agent output.");
      } else {
        const learningContent = parseLearningContent(learningsBlock);
        if (learningContent !== null) {
          if (!accumulatedLearnings.includes(learningContent)) {
            accumulatedLearnings.push(learningContent);
          }
          console.log(
            `Logged learning: ${learningContent.slice(0, 80)}${learningContent.length > 80 ? "…" : ""}`,
          );
        } else {
          console.log("No learning logged this iteration.");
        }
      }

      // --- Extract and append progress block ---
      // Only recognize nonce-stamped tags to prevent false positives.
      const progressContent = extractNoncedBlock(output, "progress", nonce);
      if (progressContent) {
        appendProgressBlock(progressFile, iterationNumber, progressContent);
        console.log(
          `Appended progress block from iteration ${iterationNumber}.`,
        );
        // Broadcast progress to connected IPC clients
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

      // --- Stuck detection ---
      const currentHash = getCurrentCommitHash(cwd) ?? "";
      if (currentHash === lastHash) {
        stuckCount++;
        console.log(
          `WARNING: No new commits this iteration (${stuckCount}/${maxStuck}).`,
        );
        if (stuckCount >= maxStuck) {
          markStuck(
            `Stuck: ${maxStuck} consecutive iterations with no progress on '${planSlug}'.`,
          );
          console.log(`Branch: ${branch}`);
          console.log(
            `Plan files remain in ${wipDir}/ — resume with another run.`,
          );
          break;
        }
      } else {
        stuckCount = 0;
        lastHash = currentHash;
      }

      // --- Update receipt tasks_completed from progress.md ---
      updateReceiptTasks(receiptFile, progressFile, planFormat);
      // Broadcast updated tasks-completed count to connected IPC clients
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
      if (detectCompletion(output, nonce)) {
        // --- Completion gate: verify before accepting ---
        const gateResult = runCompletionGate({
          progressFile,
          planFormat,
          totalTasks,
          feedbackCommands,
          prFeedbackCommands,
          cwd,
        });

        const gateFailureOpts = {
          maxGateRejections,
          nonce,
          totalTasks,
          progressFile,
          planFormat,
          markStuckFn: markStuck,
          state: gateState,
        };

        if (!gateResult.passed) {
          const disposition = handleGateFailure(
            gateResult,
            "",
            gateFailureOpts,
          );
          if (disposition === "rejected") continue;
          if (disposition === "stuck") break;
        }

        // Clear gate state on acceptance
        gateState.lastGateRejection = undefined;

        // --- Review pass: behavior-preserving simplification ---
        // Runs at most once per plan, after the gate passes. If the review
        // makes changes, re-run the gate; on failure follow normal rejection.
        if (review && !reviewDone) {
          const changedFiles = getChangedFiles(baseBranch, cwd);
          if (changedFiles.length === 0) {
            console.log("Review pass: no changed files — skipping.");
          } else {
            console.log(
              `Running review pass on ${changedFiles.length} changed files...`,
            );
            const feedbackStep = wrapperPath ?? feedbackCommands;
            try {
              const reviewResult = await runReviewPass({
                baseBranch,
                agentCommand,
                feedbackStep,
                iterationTimeout,
                cwd,
                outputLogPath,
                ipcBroadcast: ipcServer
                  ? (msg) => ipcServer!.broadcast(msg)
                  : undefined,
              });
              reviewDone = true;

              if (reviewResult.madeChanges) {
                console.log("Review pass: simplifications committed.");
                reviewPassMadeChanges = true;
                // Re-run the completion gate after review changes
                const reGateResult = runCompletionGate({
                  progressFile,
                  planFormat,
                  totalTasks,
                  feedbackCommands,
                  prFeedbackCommands,
                  cwd,
                });

                if (!reGateResult.passed) {
                  const disposition = handleGateFailure(
                    reGateResult,
                    " after review pass",
                    gateFailureOpts,
                  );
                  if (disposition === "rejected") continue;
                  if (disposition === "stuck") break;
                }
              } else {
                console.log("Review pass: no simplifications needed.");
              }
            } catch (err) {
              // Best-effort: agent failure or timeout during review should
              // not block PR creation.
              reviewDone = true;
              console.log(
                `WARNING: Review pass failed: ${err instanceof Error ? err.message : err}`,
              );
              console.log("Proceeding to PR creation.");
            }
          }
        }

        console.log();
        console.log(
          `Plan complete after ${iterationNumber} iterations: ${planDesc}`,
        );

        // Extract agent-generated PR description
        // Only recognize nonce-stamped tags to prevent false positives.
        const prSummary =
          extractNoncedBlock(output, "pr-summary", nonce) ?? undefined;
        if (prSummary) lastPrSummary = prSummary;

        // Remove PID file and close IPC server before archiving so they
        // don't end up in out/
        if (ipcServer) {
          // Broadcast completion before closing so IPC clients
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

        if (!skipPrCreation) {
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
            learnings: accumulatedLearnings,
            reviewPassMadeChanges,
          });
          console.log(prResult.message);

          // Persist PR URL to receipt before archiving (so it survives the move)
          if (prResult.ok && prResult.prUrl) {
            updateReceiptPrUrl(receiptFile, prResult.prUrl);
          }
        }

        archiveRun({
          wipFiles: [planFile],
          archiveDir: dirs.archiveDir,
          cwd,
        });

        // --- PRD done detection ---
        // When a sub-issue completes, check whether ALL sibling sub-issues
        // under the same PRD parent are now done. If so, transition the
        // PRD parent to done.
        if (issueFm.prd && issueFm.source === "github") {
          const prdRepo = resolveIssueRepoSlug(issueRepo, issueFm.issueUrl);
          if (prdRepo) {
            const allDone = checkAllPrdSubIssuesDone(prdRepo, issueFm.prd, cwd);
            if (allDone) {
              console.log(
                `All sub-issues of PRD #${issueFm.prd} are done — transitioning PRD to done.`,
              );
              prdTransitionDone({ number: issueFm.prd, repo: prdRepo }, cwd);
            }
          }
        }

        plansCompleted++;
        completed = true;
        break;
      }
    }

    if (!completed && !stuck && interrupted) {
      console.log();
      console.log(`Interrupted during plan: ${planDesc}`);
      console.log(`Plan files remain in ${wipDir}/ — resume with another run.`);
      console.log(`Branch: ${branch}`);
      break;
    }

    // --- --once: stop after a single completed (or stuck) plan ---
    if (once) {
      break;
    }

    // --- Stop after a pulled regular GitHub issue (not PRD sub-issues) ---
    if (pulledRegularGithubIssue) {
      break;
    }

    // Loop back to pick the next plan (drain-by-default)
  }

  // --- Exit summary ---
  printExitSummary(plansCompleted, stuckSlugs);

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

  return { stuckSlugs, lastPrSummary, accumulatedLearnings };
}
