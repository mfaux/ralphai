/**
 * HITL (Human-in-the-Loop) command module.
 *
 * Implements `ralphai hitl <issue-number>` which opens the coding agent's
 * interactive TUI for a specific HITL sub-issue. This is the primary
 * interface for humans to collaborate with the agent on complex tasks
 * that can't be fully automated.
 *
 * Orchestration flow:
 *   1. Discover parent PRD via discoverParentIssue()
 *   2. Resolve or create worktree for the PRD branch
 *   3. Assemble prompt from the sub-issue body
 *   4. Spawn agent interactively (stdio: "inherit")
 *   5. On clean exit → remove HITL label, add done label
 *   6. On abnormal exit → leave labels unchanged
 */
import { spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

import { RESET, TEXT, DIM } from "./utils.ts";
import {
  resolveConfig,
  getConfigFilePath,
  DEFAULTS,
  type ResolvedConfig,
} from "./config.ts";
import {
  detectIssueRepo,
  discoverParentIssue,
  fetchIssueWithLabels,
  issueBranchName,
  slugify,
  commitTypeFromTitle,
} from "./issues.ts";
import { execQuiet } from "./exec.ts";
import { DONE_LABEL, IN_PROGRESS_LABEL, STUCK_LABEL } from "./labels.ts";
import { prepareWorktree, type SetupSandboxConfig } from "./worktree/index.ts";
import { isGitWorktree, ensureRepoHasCommit } from "./worktree/management.ts";
import { shellSplit } from "./runner.ts";
import { formatFileRef } from "./prompt.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HitlOptions {
  issueNumber: number;
  cwd: string;
  dryRun: boolean;
  runArgs: string[];
}

export interface HitlResult {
  exitCode: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the HITL interactive session for a sub-issue.
 *
 * Discovers the parent PRD, resolves the worktree, assembles the prompt,
 * and spawns the agent interactively. On clean exit (code 0), removes
 * the HITL label and adds `done`. On abnormal exit, leaves labels unchanged.
 */
export async function runHitl(options: HitlOptions): Promise<HitlResult> {
  const { issueNumber, cwd, dryRun, runArgs } = options;

  // --- Validate git context ---
  if (isGitWorktree(cwd)) {
    console.error("'ralphai hitl' must be run from the main repository.");
    console.error(
      "You are inside a worktree. Run this command from the main repo.",
    );
    process.exit(1);
  }

  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  // --- Resolve config ---
  const cfgResult = resolveConfig({
    cwd,
    envVars: process.env as Record<string, string | undefined>,
    cliArgs: runArgs,
  });
  const config = cfgResult.config;

  // --- Validate agentInteractiveCommand ---
  const agentInteractiveCommand = config.agentInteractiveCommand.value;
  if (!agentInteractiveCommand) {
    console.error(
      `${TEXT}Error:${RESET} agentInteractiveCommand is not configured.`,
    );
    console.error(
      `\nSet it in your ralphai config or via ${TEXT}RALPHAI_AGENT_INTERACTIVE_COMMAND${RESET} env var.`,
    );
    console.error(
      `${DIM}Example: ${TEXT}ralphai config agentInteractiveCommand${RESET}${DIM} to check the current value.${RESET}`,
    );
    process.exit(1);
  }

  // --- Detect GitHub repo ---
  const repo = detectIssueRepo(cwd, config.issueRepo.value);
  if (!repo) {
    console.error(
      "Could not detect GitHub repo from git remote. " +
        "Set issue-repo in config or ensure a remote is configured.",
    );
    process.exit(1);
  }

  // --- Discover parent PRD ---
  const prdLabel = config.prdLabel.value || DEFAULTS.prdLabel;
  const parentResult = discoverParentIssue(repo, issueNumber, cwd, prdLabel);

  if (!parentResult.hasParent) {
    console.error(
      `${TEXT}Error:${RESET} Issue #${issueNumber} has no parent issue.`,
    );
    console.error(
      `\nThe ${TEXT}hitl${RESET} command requires a sub-issue with a parent PRD.`,
    );
    console.error(`${DIM}Add a parent issue on GitHub, then retry.${RESET}`);
    process.exit(1);
  }

  if (!parentResult.parentHasPrdLabel) {
    console.error(
      `${TEXT}Error:${RESET} Parent issue #${parentResult.parentNumber} does not have the PRD label (${TEXT}${prdLabel}${RESET}).`,
    );
    console.error(
      `\nThe ${TEXT}hitl${RESET} command requires the parent to be a PRD.`,
    );
    console.error(
      `${DIM}Add the "${prdLabel}" label to issue #${parentResult.parentNumber} on GitHub, then retry.${RESET}`,
    );
    process.exit(1);
  }

  // --- Fetch issue body for prompt ---
  let issueInfo: {
    number: number;
    title: string;
    body: string;
    labels: string[];
  };
  try {
    issueInfo = fetchIssueWithLabels(repo, issueNumber, cwd);
  } catch (err: unknown) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // --- Derive PRD branch and slug from parent title ---
  const parentTitle = parentResult.parentTitle!;
  const prdSlug = slugify(commitTypeFromTitle(parentTitle).description);
  const branch = issueBranchName(parentTitle);
  const hitlLabel = config.issueHitlLabel.value || DEFAULTS.issueHitlLabel;

  // --- Dry-run ---
  if (dryRun) {
    console.log();
    console.log("========================================");
    console.log("  Ralphai dry-run — HITL session");
    console.log("========================================");
    console.log(`[dry-run] Sub-issue: #${issueNumber} — ${issueInfo.title}`);
    console.log(
      `[dry-run] Parent PRD: #${parentResult.parentNumber} — ${parentTitle}`,
    );
    console.log(`[dry-run] Branch: ${branch}`);
    console.log(`[dry-run] Worktree: ../.ralphai-worktrees/${prdSlug}/`);
    console.log(`[dry-run] Agent command: ${agentInteractiveCommand}`);
    console.log(
      `[dry-run] Would spawn agent interactively with stdio: "inherit"`,
    );
    console.log(
      `[dry-run] On clean exit: remove "${hitlLabel}" label, add "${DONE_LABEL}" label`,
    );
    console.log("[dry-run] On abnormal exit: labels unchanged");
    console.log(
      "[dry-run] No worktree created, no agent spawned, no labels modified.",
    );
    return { exitCode: 0, message: "Dry-run complete." };
  }

  // --- Prepare worktree ---
  ensureRepoHasCommit(cwd);
  const baseBranch = config.baseBranch.value;
  const setupCommand = config.setupCommand?.value ?? "";
  const feedbackCommands = config.feedbackCommands.value
    ? config.feedbackCommands.value.split(",").map((s: string) => s.trim())
    : [];

  // Build sandbox config for routing setup commands through Docker
  const setupSandboxConfig: SetupSandboxConfig = {
    sandbox: config.sandbox.value as "none" | "docker",
    agentCommand: config.agentCommand.value,
    dockerConfig:
      config.sandbox.value === "docker"
        ? {
            dockerImage: config.dockerImage.value || undefined,
            dockerEnvVars: config.dockerEnvVars.value
              ? config.dockerEnvVars.value
                  .split(",")
                  .map((s: string) => s.trim())
                  .filter(Boolean)
              : undefined,
            dockerMounts: config.dockerMounts.value
              ? config.dockerMounts.value
                  .split(",")
                  .map((s: string) => s.trim())
                  .filter(Boolean)
              : undefined,
          }
        : undefined,
    // Mount the main repo's .git directory for worktree support.
    // In HITL mode, cwd is always the main repo root, so worktrees
    // created from it need this path mounted in Docker for git
    // operations to work inside the container.
    mainGitDir:
      config.sandbox.value === "docker" ? join(cwd, ".git") : undefined,
  };

  const resolvedWorktreeDir = prepareWorktree(
    cwd,
    prdSlug,
    branch,
    baseBranch,
    setupCommand,
    setupSandboxConfig,
  );

  // --- Write temporary plan file for prompt ---
  const planContent = [
    "---",
    `source: github`,
    `issue: ${issueNumber}`,
    "---",
    "",
    issueInfo.body,
  ].join("\n");

  const tmpPlanDir = join(resolvedWorktreeDir, ".ralphai-hitl");
  mkdirSync(tmpPlanDir, { recursive: true });
  const planFile = join(tmpPlanDir, `hitl-${issueNumber}.md`);
  writeFileSync(planFile, planContent);

  // --- Assemble prompt ---
  const planRef = formatFileRef(planFile, "plan.md");
  const prompt = `${planRef}\n\nYou are working on sub-issue #${issueNumber} — ${issueInfo.title}.\nParent PRD: #${parentResult.parentNumber} — ${parentTitle}.\n\nImplement the requirements described in the plan above. This is an interactive session — ask for clarification if needed.`;

  // --- Spawn agent interactively ---
  console.log();
  console.log(
    `HITL session for sub-issue #${issueNumber} — ${issueInfo.title}`,
  );
  console.log(`Parent PRD: #${parentResult.parentNumber} — ${parentTitle}`);
  console.log(`Worktree: ${resolvedWorktreeDir}`);
  console.log(`Agent: ${agentInteractiveCommand}`);
  console.log();

  const exitCode = await spawnInteractiveAgent(
    agentInteractiveCommand,
    prompt,
    resolvedWorktreeDir,
  );

  // --- Label management based on exit code ---
  if (exitCode === 0) {
    // Clean exit: remove HITL label, add done
    execQuiet(
      `gh issue edit ${issueNumber} --repo "${repo}" --remove-label "${hitlLabel}" --remove-label "${IN_PROGRESS_LABEL}" --remove-label "${STUCK_LABEL}" --add-label "${DONE_LABEL}"`,
      cwd,
    );
    const message = `Sub-issue #${issueNumber} completed. Removed "${hitlLabel}" label, added "${DONE_LABEL}".`;
    console.log();
    console.log(message);
    return { exitCode: 0, message };
  } else {
    // Abnormal exit: leave labels unchanged
    const message = `Agent exited with code ${exitCode}. Labels unchanged for issue #${issueNumber}.`;
    console.log();
    console.log(message);
    return { exitCode, message };
  }
}

// ---------------------------------------------------------------------------
// Interactive agent spawning
// ---------------------------------------------------------------------------

/**
 * Spawn the agent command interactively with full terminal pass-through.
 *
 * Unlike the automated runner's `spawnAgent()`, this passes `stdio: "inherit"`
 * so the user gets the agent's full TUI experience. Stdin is NOT closed.
 *
 * Returns the exit code (0 for clean exit, non-zero for abnormal).
 */
export function spawnInteractiveAgent(
  agentCommand: string,
  prompt: string,
  cwd: string,
): Promise<number> {
  return new Promise((resolve) => {
    const parts = shellSplit(agentCommand);
    const cmd = parts[0]!;
    const args = [...parts.slice(1), prompt];

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        cwd,
        stdio: "inherit",
      });
    } catch (err) {
      console.error(
        `Failed to spawn agent: ${err instanceof Error ? err.message : err}`,
      );
      resolve(1);
      return;
    }

    // Handle Ctrl+C gracefully — let the child process handle SIGINT first.
    // If the child exits, we capture its exit code.
    child.on("close", (code) => {
      resolve(code ?? 1);
    });

    child.on("error", (err) => {
      console.error(`Agent error: ${err.message}`);
      resolve(1);
    });
  });
}
