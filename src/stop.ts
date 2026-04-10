/**
 * stop command — stop running plan(s) by sending SIGTERM to their runners.
 *
 * Supports:
 *   ralphai stop <slug>    — stop a specific plan's runner
 *   ralphai stop --all     — stop all live runners
 *   ralphai stop           — auto-select if exactly one runner is live
 *   --dry-run              — print what would be stopped without sending signals
 */

import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { RESET, BOLD, DIM, TEXT } from "./utils.ts";
import { getRepoPipelineDirs, listPlanFolders } from "./plan-lifecycle.ts";
import { getConfigFilePath } from "./config.ts";
import { isPidAlive, readRunnerPid, stopRunner } from "./process-utils.ts";

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function showStopHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai stop [slug] [--all] [--dry-run]`);
  console.log();
  console.log(`${DIM}Stop running plan(s).${RESET}`);
  console.log();
  console.log(`${TEXT}Arguments:${RESET}`);
  console.log(
    `  ${TEXT}slug${RESET}      ${DIM}Plan slug to stop (auto-selects if only one running)${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--all${RESET}     ${DIM}Stop all running plans${RESET}`,
  );
  console.log(
    `  ${TEXT}--dry-run${RESET} ${DIM}Show what would be stopped without sending signals${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StopOptions {
  cwd: string;
  dryRun: boolean;
  slug?: string;
  all?: boolean;
}

interface LiveRunner {
  slug: string;
  pid: number;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function runRalphaiStop(options: StopOptions): void {
  const { cwd, dryRun, slug, all } = options;

  // Require config
  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const { wipDir } = getRepoPipelineDirs(cwd);
  const slugs = listPlanFolders(wipDir);

  // --- ralphai stop <slug> ---
  if (slug) {
    stopBySlug(wipDir, slug, dryRun);
    return;
  }

  // --- ralphai stop --all ---
  if (all) {
    stopAll(wipDir, slugs, dryRun);
    return;
  }

  // --- ralphai stop (auto-select) ---
  const liveRunners = findLiveRunners(wipDir, slugs);

  if (liveRunners.length === 0) {
    console.log("No running plans to stop.");
    return;
  }

  if (liveRunners.length === 1) {
    const runner = liveRunners[0]!;
    doStop(wipDir, runner.slug, runner.pid, dryRun);
    return;
  }

  // Multiple live runners — ask user to specify
  console.log("Multiple running plans found. Specify a slug to stop:");
  console.log();
  for (const runner of liveRunners) {
    console.log(
      `  ${TEXT}${runner.slug}${RESET}  ${DIM}PID ${runner.pid}${RESET}`,
    );
  }
  console.log();
  console.log(
    `${DIM}Run ${TEXT}ralphai stop <slug>${RESET}${DIM} or ${TEXT}ralphai stop --all${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findLiveRunners(wipDir: string, slugs: string[]): LiveRunner[] {
  const live: LiveRunner[] = [];
  for (const s of slugs) {
    const slugDir = join(wipDir, s);
    const pid = readRunnerPid(slugDir);
    if (pid !== null && isPidAlive(pid)) {
      live.push({ slug: s, pid });
    }
  }
  return live;
}

function stopBySlug(wipDir: string, slug: string, dryRun: boolean): void {
  const slugDir = join(wipDir, slug);
  if (!existsSync(slugDir)) {
    console.error(`Plan '${slug}' not found in in-progress.`);
    process.exit(1);
  }

  const pid = readRunnerPid(slugDir);
  if (pid === null) {
    console.error(`No runner.pid file for '${slug}'.`);
    process.exit(1);
  }

  if (!isPidAlive(pid)) {
    console.log(
      `Runner for '${slug}' (PID ${pid}) is not running. Cleaning up stale PID file.`,
    );
    cleanupPidFile(slugDir, dryRun);
    return;
  }

  doStop(wipDir, slug, pid, dryRun);
}

function stopAll(wipDir: string, slugs: string[], dryRun: boolean): void {
  const liveRunners = findLiveRunners(wipDir, slugs);

  if (liveRunners.length === 0) {
    console.log("No running plans to stop.");
    return;
  }

  let stopped = 0;
  for (const runner of liveRunners) {
    doStop(wipDir, runner.slug, runner.pid, dryRun);
    stopped++;
  }

  console.log();
  if (dryRun) {
    console.log(
      `${DIM}[dry-run] Would stop ${stopped} runner${stopped !== 1 ? "s" : ""}.${RESET}`,
    );
  } else {
    console.log(`Stopped ${stopped} runner${stopped !== 1 ? "s" : ""}.`);
  }
}

function doStop(
  wipDir: string,
  slug: string,
  pid: number,
  dryRun: boolean,
): void {
  const slugDir = join(wipDir, slug);

  if (dryRun) {
    console.log(`${DIM}[dry-run] Would stop '${slug}' (PID ${pid}).${RESET}`);
    return;
  }

  const sent = stopRunner(pid);
  if (sent) {
    console.log(`Stopped '${slug}' (PID ${pid}).`);
    cleanupPidFile(slugDir, false);
  } else {
    console.error(`Failed to stop '${slug}' (PID ${pid}).`);
  }
}

function cleanupPidFile(slugDir: string, dryRun: boolean): void {
  const pidFile = join(slugDir, "runner.pid");
  if (dryRun) return;
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }
}
