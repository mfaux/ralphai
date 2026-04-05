/**
 * Doctor command — diagnostic health checks for a ralphai-configured repo.
 *
 * Validates config existence, git state, agent availability, feedback
 * commands, backlog content, and receipt integrity.
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { RESET, DIM, TEXT } from "./utils.ts";
import { listPlanSlugs, listPlanFolders } from "./plan-detection.ts";
import { getRepoPipelineDirs } from "./global-state.ts";
import { getConfigFilePath } from "./config.ts";
import { detectBaseBranch } from "./git-helpers.ts";

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function showDoctorHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai doctor`);
  console.log();
  console.log(
    `${DIM}Run diagnostic checks on your ralphai setup and report problems.${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

export interface DoctorCheckResult {
  status: "pass" | "fail" | "warn";
  message: string;
}

/** A single check descriptor — what to run and its label. */
export interface DoctorCheck {
  /** Human-readable name for the check (e.g., "config exists"). */
  name: string;
  /** The function that performs the check. May return one or many results. */
  run: (cwd: string) => DoctorCheckResult | DoctorCheckResult[];
}

/**
 * Build the ordered list of doctor checks, respecting conditional
 * dependencies (some checks are skipped when prerequisites fail).
 *
 * Returns an array of `DoctorCheck` descriptors. Each entry's `run`
 * function is safe to call independently — dependency gating is
 * handled by the caller via `collectDoctorChecks()`.
 *
 * Exported for the TUI doctor screen.
 */
export function buildDoctorChecks(cwd: string): DoctorCheck[] {
  // Run prerequisite checks first to determine which optional checks to include.
  const configExistsResult = checkConfigExists(cwd);
  const configValidResult = checkConfigValid(cwd);
  const gitRepoResult = checkGitRepo(cwd);

  const checks: DoctorCheck[] = [
    { name: "config exists", run: () => configExistsResult },
    { name: "config valid", run: () => configValidResult },
    { name: "git repo", run: () => gitRepoResult },
  ];

  // Conditional checks based on prerequisites
  if (gitRepoResult.status !== "fail") {
    checks.push({ name: "working tree clean", run: checkWorkingTreeClean });
    checks.push({ name: "base branch exists", run: checkBaseBranchExists });
  }

  if (configValidResult.status !== "fail") {
    checks.push({ name: "agent command", run: checkAgentCommand });
    checks.push({ name: "feedback commands", run: checkFeedbackCommands });
    checks.push({
      name: "workspace feedback commands",
      run: checkWorkspaceFeedbackCommands,
    });
  }

  if (configExistsResult.status !== "fail") {
    checks.push({ name: "backlog has plans", run: checkBacklogHasPlans });
    checks.push({ name: "orphaned receipts", run: checkOrphanedReceipts });
  }

  return checks;
}

/**
 * Run all doctor checks and collect their results.
 *
 * Returns a flat array of results in execution order. Unlike
 * `runRalphaiDoctor()`, this function does not print anything or
 * call `process.exit()`, making it suitable for the TUI.
 */
export function collectDoctorChecks(cwd: string): DoctorCheckResult[] {
  const checks = buildDoctorChecks(cwd);
  const results: DoctorCheckResult[] = [];

  for (const check of checks) {
    const result = check.run(cwd);
    if (Array.isArray(result)) {
      results.push(...result);
    } else {
      results.push(result);
    }
  }

  return results;
}

/**
 * Build a human-readable summary line from doctor check results.
 *
 * Returns "All checks passed" when there are no failures or warnings,
 * otherwise a comma-separated count like "2 warnings, 1 failure".
 */
export function buildDoctorSummary(results: DoctorCheckResult[]): string {
  let failures = 0;
  let warnings = 0;
  for (const r of results) {
    if (r.status === "fail") failures++;
    if (r.status === "warn") warnings++;
  }

  if (failures === 0 && warnings === 0) {
    return "All checks passed";
  }

  const parts: string[] = [];
  if (warnings > 0)
    parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);
  if (failures > 0)
    parts.push(`${failures} failure${failures !== 1 ? "s" : ""}`);
  return parts.join(", ");
}

/**
 * Map a check status to a Unicode icon.
 *
 * Exported for reuse in the TUI doctor screen.
 */
export function statusIcon(status: DoctorCheckResult["status"]): string {
  const icons: Record<DoctorCheckResult["status"], string> = {
    pass: "\u2713",
    fail: "\u2717",
    warn: "\u26A0",
  };
  return icons[status];
}

function checkConfigExists(cwd: string): DoctorCheckResult {
  const configPath = getConfigFilePath(cwd);
  if (existsSync(configPath)) {
    return { status: "pass", message: "config initialized (global state)" };
  }
  return { status: "fail", message: "config not found — run ralphai init" };
}

function checkConfigValid(cwd: string): DoctorCheckResult {
  const configPath = getConfigFilePath(cwd);
  if (!existsSync(configPath)) {
    return {
      status: "fail",
      message: "config.json not found — run ralphai init",
    };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const keys = Object.keys(config);
    return {
      status: "pass",
      message: `config.json valid (${keys.length} keys)`,
    };
  } catch {
    return {
      status: "fail",
      message: "config.json is not valid JSON",
    };
  }
}

function checkGitRepo(cwd: string): DoctorCheckResult {
  try {
    execSync("git rev-parse --git-dir", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const baseBranch = detectBaseBranch(cwd);
    return {
      status: "pass",
      message: `git repo detected (base branch: ${baseBranch})`,
    };
  } catch {
    return { status: "fail", message: "not a git repository" };
  }
}

function checkWorkingTreeClean(cwd: string): DoctorCheckResult {
  try {
    execSync("git diff --quiet HEAD", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: "pass", message: "working tree clean" };
  } catch {
    return { status: "warn", message: "working tree has uncommitted changes" };
  }
}

function checkBaseBranchExists(cwd: string): DoctorCheckResult {
  // Read baseBranch from config if available, else detect
  let baseBranch: string;
  const configPath = getConfigFilePath(cwd);
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    baseBranch = config.baseBranch || detectBaseBranch(cwd);
  } catch {
    baseBranch = detectBaseBranch(cwd);
  }

  try {
    execSync(`git show-ref --verify refs/heads/${baseBranch}`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      status: "pass",
      message: `base branch exists: ${baseBranch}`,
    };
  } catch {
    return {
      status: "fail",
      message: `base branch not found: ${baseBranch}`,
    };
  }
}

function checkAgentCommand(cwd: string): DoctorCheckResult {
  const configPath = getConfigFilePath(cwd);
  let agentCommand: string;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    agentCommand = config.agentCommand;
  } catch {
    return { status: "fail", message: "agent command: cannot read config" };
  }

  if (!agentCommand) {
    return { status: "fail", message: "agent command: not configured" };
  }

  // Extract the first token (the executable) from the command
  const executable = agentCommand.split(/\s+/)[0]!;

  try {
    execSync(`which ${executable}`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return {
      status: "pass",
      message: `agent: ${agentCommand} — found in PATH`,
    };
  } catch {
    return {
      status: "fail",
      message: `agent: ${executable} — not found in PATH`,
    };
  }
}

function checkFeedbackCommands(cwd: string): DoctorCheckResult[] {
  const configPath = getConfigFilePath(cwd);
  let feedbackCommands: string[];
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    feedbackCommands = config.feedbackCommands;
  } catch {
    return [];
  }

  if (
    !feedbackCommands ||
    !Array.isArray(feedbackCommands) ||
    feedbackCommands.length === 0
  ) {
    return [{ status: "warn", message: "feedback commands: none configured" }];
  }

  return feedbackCommands.map((cmd) => {
    try {
      execSync(cmd, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15000,
      });
      return {
        status: "pass" as const,
        message: `feedback: ${cmd} — exits 0`,
      };
    } catch {
      return {
        status: "warn" as const,
        message: `feedback: ${cmd} — exits non-zero`,
      };
    }
  });
}

function checkWorkspaceFeedbackCommands(cwd: string): DoctorCheckResult[] {
  const configPath = getConfigFilePath(cwd);
  let workspaces: Record<string, { feedbackCommands?: string[] }>;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    workspaces = config.workspaces;
  } catch {
    return [];
  }

  if (!workspaces || typeof workspaces !== "object") {
    return [];
  }

  const results: DoctorCheckResult[] = [];
  for (const [wsPath, wsConfig] of Object.entries(workspaces)) {
    const commands = wsConfig?.feedbackCommands;
    if (!commands || !Array.isArray(commands) || commands.length === 0) {
      continue;
    }
    for (const cmd of commands) {
      try {
        execSync(cmd, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 15000,
        });
        results.push({
          status: "pass" as const,
          message: `feedback (${wsPath}): ${cmd} — exits 0`,
        });
      } catch {
        results.push({
          status: "warn" as const,
          message: `feedback (${wsPath}): ${cmd} — exits non-zero`,
        });
      }
    }
  }
  return results;
}

function checkBacklogHasPlans(cwd: string): DoctorCheckResult {
  const { backlogDir } = getRepoPipelineDirs(cwd);
  if (!existsSync(backlogDir)) {
    return { status: "warn", message: "backlog: directory not found" };
  }
  const plans = listPlanSlugs(backlogDir, true);
  if (plans.length === 0) {
    return { status: "warn", message: "backlog: no plans queued" };
  }
  return {
    status: "pass",
    message: `backlog: ${plans.length} plan${plans.length !== 1 ? "s" : ""} ready`,
  };
}

function checkOrphanedReceipts(cwd: string): DoctorCheckResult {
  const { wipDir: inProgressDir } = getRepoPipelineDirs(cwd);
  if (!existsSync(inProgressDir)) {
    return { status: "pass", message: "no orphaned receipts" };
  }

  const orphaned: string[] = [];
  for (const slug of listPlanFolders(inProgressDir)) {
    const receiptPath = join(inProgressDir, slug, "receipt.txt");
    if (!existsSync(receiptPath)) continue;
    const planPath = join(inProgressDir, slug, `${slug}.md`);
    if (!existsSync(planPath)) {
      orphaned.push(`${slug}/receipt.txt`);
    }
  }

  if (orphaned.length > 0) {
    return {
      status: "warn",
      message: `orphaned receipts: ${orphaned.join(", ")}`,
    };
  }
  return { status: "pass", message: "no orphaned receipts" };
}

// ---------------------------------------------------------------------------
// Doctor command
// ---------------------------------------------------------------------------

export function runRalphaiDoctor(cwd: string): void {
  // Print header immediately so the user sees output right away.
  console.log();
  console.log(`${TEXT}ralphai doctor${RESET}`);
  console.log();

  const results = collectDoctorChecks(cwd);

  for (const result of results) {
    const icon = statusIcon(result.status);
    console.log(`  ${icon} ${DIM}${result.message}${RESET}`);
  }

  // --- Summary ---
  console.log();
  console.log(`  ${DIM}${buildDoctorSummary(results)}${RESET}`);
  console.log();

  // Exit code: 1 if any check failed, 0 otherwise (warnings don't count)
  const hasFailures = results.some((r) => r.status === "fail");
  if (hasFailures) {
    process.exit(1);
  }
}
