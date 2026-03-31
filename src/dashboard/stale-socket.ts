/**
 * Stale socket detection for the dashboard.
 *
 * Before connecting to a runner's IPC socket, the dashboard checks whether
 * the runner process is still alive. This prevents connecting to orphaned
 * sockets left by crashed runners.
 *
 * Three outcomes:
 * 1. PID is alive → socket is probably valid, attempt connection.
 * 2. PID is dead → socket is stale, delete it and fall back to polling.
 * 3. PID file missing → no runner, fall back to polling.
 */

import { readFileSync, rmSync } from "fs";

// ---------------------------------------------------------------------------
// PID liveness check
// ---------------------------------------------------------------------------

/**
 * Check whether a process with the given PID is alive.
 *
 * Uses the `kill(pid, 0)` technique: signal 0 doesn't actually send
 * a signal but checks for process existence.
 *
 * Returns `true` if the process exists, `false` if it doesn't.
 * EPERM (permission denied) means the process exists but we can't signal it
 * — still counts as alive.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // EPERM means the process exists but we lack permission
    if (err && typeof err === "object" && "code" in err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stale socket detection
// ---------------------------------------------------------------------------

export type SocketStatus =
  | { status: "valid"; pid: number }
  | { status: "stale"; reason: "dead-pid" }
  | { status: "no-pid-file" };

/**
 * Check whether a runner's IPC socket is stale.
 *
 * @param pidFilePath - Path to the runner.pid file (e.g., `wip/<slug>/runner.pid`)
 * @param socketPath  - Path to the runner.sock file (for cleanup)
 * @returns The socket status: valid (PID alive), stale (PID dead), or no-pid-file.
 */
export function checkSocketStatus(pidFilePath: string): SocketStatus {
  let pidStr: string;
  try {
    pidStr = readFileSync(pidFilePath, "utf8").trim();
  } catch {
    return { status: "no-pid-file" };
  }

  const pid = parseInt(pidStr, 10);
  if (isNaN(pid)) {
    return { status: "no-pid-file" };
  }

  if (isPidAlive(pid)) {
    return { status: "valid", pid };
  }

  return { status: "stale", reason: "dead-pid" };
}

/**
 * Clean up a stale socket file.
 *
 * Best-effort: if the file doesn't exist or can't be deleted, silently ignore.
 */
export function removeStaleSocket(socketPath: string): void {
  try {
    rmSync(socketPath, { force: true });
  } catch {
    // Best-effort cleanup
  }
}
