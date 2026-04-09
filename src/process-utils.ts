/**
 * Shared process utilities for runner liveness checks.
 *
 * Used by CLI commands like `status` and `stop`.
 */

import { readFileSync } from "fs";
import { join } from "path";

/**
 * Check whether a process with the given PID is alive.
 *
 * Uses the `kill(pid, 0)` technique: signal 0 doesn't actually send
 * a signal but checks for process existence.
 *
 * EPERM (permission denied) means the process exists but we can't signal it
 * — still counts as alive.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
    return false;
  }
}

/**
 * Read the runner PID from `<wipDir>/runner.pid`.
 *
 * Returns the parsed PID number, or null if the file is missing or invalid.
 */
export function readRunnerPid(wipDir: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(join(wipDir, "runner.pid"), "utf8").trim();
  } catch {
    return null;
  }
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

/**
 * Check whether an in-progress plan has a live runner process.
 *
 * Reads `<inProgressDir>/<slug>/runner.pid` and checks whether the
 * process is alive. Returns true only when a PID file exists AND the
 * process is still running. Returns false when there is no PID file
 * or the recorded process is dead (stale/crashed runner).
 *
 * Used by plan selection to avoid picking up plans already being
 * executed by another runner.
 */
export function isPlanRunnerAlive(
  inProgressDir: string,
  slug: string,
): boolean {
  const slugDir = join(inProgressDir, slug);
  const pid = readRunnerPid(slugDir);
  if (pid === null) return false;
  return isPidAlive(pid);
}

/**
 * Send SIGTERM to a runner process.
 *
 * Returns true if the signal was delivered, false if the process doesn't exist
 * or couldn't be signalled.
 */
export function stopRunner(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
