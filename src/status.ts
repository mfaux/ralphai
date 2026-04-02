/**
 * Status command — display pipeline state (backlog, in-progress, completed,
 * worktrees, and problems) with optional auto-refresh in TTY mode.
 */
import { existsSync } from "fs";
import { RESET, BOLD, DIM, TEXT } from "./utils.ts";
import { getConfigFilePath } from "./config.ts";
import { listRalphaiWorktrees } from "./worktree/index.ts";
import { gatherPipelineState } from "./pipeline-state.ts";
import type { WorktreeEntry } from "./worktree/index.ts";

// Re-export frontmatter utilities that were historically exported from ralphai.ts
export { extractScope, extractDependsOn } from "./frontmatter.ts";

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function showStatusHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai status [--once] [--no-color]`);
  console.log();
  console.log(
    `${DIM}Show pipeline status. Auto-refreshes every 3s in a terminal.${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--once${RESET}      ${DIM}Print once and exit (default in non-TTY)${RESET}`,
  );
  console.log(
    `  ${TEXT}--no-color${RESET}  ${DIM}Disable color output${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------

export function runRalphaiStatus(opts: { cwd: string; once?: boolean }): void {
  const { cwd, once } = opts;
  // Verify config exists (global state)
  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const isTTY = process.stdout.isTTY === true;

  // If non-TTY or --once, print once and return
  if (!isTTY || once) {
    printStatusOnce(cwd);
    return;
  }

  // Auto-watch mode: clear screen and reprint every 3 seconds
  const print = () => {
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen + move cursor to top
    printStatusOnce(cwd);
  };

  print();
  const interval = setInterval(print, 3000);

  const cleanup = () => {
    clearInterval(interval);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

export function printStatusOnce(cwd: string): void {
  let worktrees: WorktreeEntry[] = [];
  try {
    worktrees = listRalphaiWorktrees(cwd);
  } catch {
    // Not in a git repo or git not available
  }

  const state = gatherPipelineState(cwd, { worktrees });

  // --- Pipeline section ---
  console.log();
  console.log(`${TEXT}Pipeline${RESET}`);

  // Backlog
  console.log();
  console.log(
    `  ${TEXT}Backlog${RESET}      ${DIM}${state.backlog.length} plan${state.backlog.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const plan of state.backlog) {
    let suffix = "";
    const suffixParts: string[] = [];
    if (plan.scope) {
      suffixParts.push(`scope: ${plan.scope}`);
    }
    if (plan.dependsOn.length > 0) {
      suffixParts.push(`waiting on ${plan.dependsOn.join(", ")}`);
    }
    if (suffixParts.length > 0) {
      suffix = `${DIM}${suffixParts.join("  ")}${RESET}`;
    }
    console.log(
      `    ${DIM}${plan.filename}${RESET}${suffix ? "  " + suffix : ""}`,
    );
  }

  // In Progress
  console.log();
  console.log(
    `  ${TEXT}In Progress${RESET}  ${DIM}${state.inProgress.length} plan${state.inProgress.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const plan of state.inProgress) {
    const parts: string[] = [];

    if (plan.scope) {
      parts.push(`scope: ${plan.scope}`);
    }

    if (plan.totalTasks !== undefined && plan.totalTasks > 0) {
      parts.push(`${plan.tasksCompleted} of ${plan.totalTasks} tasks`);
    }

    if (plan.hasWorktree) {
      parts.push(`worktree: ${plan.slug}`);
    }

    // Liveness tag
    switch (plan.liveness.tag) {
      case "outcome":
        parts.push(`[${plan.liveness.outcome}]`);
        break;
      case "running":
        parts.push(`[running PID ${plan.liveness.pid}]`);
        break;
      case "stalled":
        parts.push(`${RESET}${BOLD}[stalled]${RESET}`);
        break;
      case "in_progress":
        parts.push("[in progress]");
        break;
    }

    const suffix =
      parts.length > 0 ? `${DIM}${parts.join("    ")}${RESET}` : "";
    console.log(
      `    ${DIM}${plan.filename}${RESET}${suffix ? "  " + suffix : ""}`,
    );
  }

  // Completed
  console.log();
  console.log(
    `  ${TEXT}Completed${RESET}    ${DIM}${state.completedSlugs.length} plan${state.completedSlugs.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const slug of state.completedSlugs) {
    console.log(`    ${DIM}${slug}.md${RESET}`);
  }

  // --- Worktrees section ---
  if (state.worktrees.length > 0) {
    console.log();
    console.log(`${TEXT}Worktrees${RESET}`);
    console.log();
    for (const wt of state.worktrees) {
      const wtState = wt.hasActivePlan ? "in-progress" : "idle";
      console.log(
        `  ${DIM}${wt.entry.branch}${RESET}  ${DIM}${wt.entry.path}${RESET}  ${DIM}[${wtState}]${RESET}`,
      );
    }
  }

  // --- Problems section ---
  if (state.problems.length > 0) {
    console.log();
    console.log(`${TEXT}Problems${RESET}`);
    console.log();
    for (const p of state.problems) {
      console.log(`  ${DIM}${p.message}${RESET}`);
    }
  }

  console.log();
}
