/**
 * Shared process-execution utilities.
 *
 * Every module that calls external commands (`gh`, `git`, etc.) should import
 * from here instead of using `child_process.execSync` directly.
 *
 * For testing, call `setExecImpl()` to swap the underlying `execSync` with a
 * mock — no `mock.module("child_process")` needed, no process isolation needed.
 */
import { execSync as realExecSync } from "child_process";

type ExecSyncFn = typeof realExecSync;

let _execSync: ExecSyncFn = realExecSync;

/**
 * Replace the underlying execSync implementation.
 * Returns a function that restores the previous implementation.
 *
 * Usage in tests:
 * ```ts
 * let restore: () => void;
 * beforeEach(() => { restore = setExecImpl(mockExecSync as any); });
 * afterEach(() => { restore(); });
 * ```
 */
export function setExecImpl(impl: ExecSyncFn): () => void {
  const prev = _execSync;
  _execSync = impl;
  return () => {
    _execSync = prev;
  };
}

/** Run a command and return trimmed stdout, or null on any error. */
export function execQuiet(cmd: string, cwd: string): string | null {
  try {
    return _execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Run a command and pipe `body` to its stdin, returning trimmed stdout or null.
 *
 * Used for `gh pr create --body-file -` and `gh pr edit --body-file -` so
 * the PR body never passes through shell interpolation.
 */
export function execWithStdin(
  cmd: string,
  body: string,
  cwd: string,
): string | null {
  try {
    return _execSync(cmd, {
      cwd,
      encoding: "utf-8",
      input: body,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/** Run a command, returning true if it exits 0. */
export function execOk(cmd: string, cwd: string): boolean {
  try {
    _execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the `gh` CLI is installed and authenticated.
 * Returns true if both `gh --version` and `gh auth status` pass.
 */
export function checkGhAvailable(): boolean {
  try {
    _execSync("gh --version", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return false;
  }
  try {
    _execSync("gh auth status", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return false;
  }
  return true;
}
