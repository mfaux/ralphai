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

/** Extract exit code from an execSync error, defaulting to 1. */
function exitCodeFrom(err: unknown): number {
  return err && typeof err === "object" && "status" in err
    ? ((err as { status: number }).status ?? 1)
    : 1;
}

/** Options for exec utilities that support timeout. */
export interface ExecOptions {
  /**
   * Subprocess timeout in milliseconds. When set, the child process
   * is killed with SIGTERM after this many milliseconds. The call
   * then throws (caught internally), so the caller sees `null` / `false`.
   *
   * Omit or set to `undefined` for no timeout (backward-compatible default).
   */
  timeout?: number;
}

/** Result of running a command with full exit/output details. */
export interface ExecRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command and return structured result with exit code and output.
 *
 * Unlike `execQuiet` (which swallows errors) and `execOk` (which returns
 * a boolean), this function always returns a result object — callers that
 * need to inspect exit codes and output (e.g. feedback commands) use this.
 */
export function execRun(
  cmd: string,
  cwd: string,
  options?: ExecOptions,
): ExecRunResult {
  try {
    const stdout = _execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(options?.timeout != null ? { timeout: options.timeout } : {}),
    });
    return { exitCode: 0, stdout: String(stdout).trim(), stderr: "" };
  } catch (err: unknown) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr).trim()
        : "";
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout: unknown }).stdout).trim()
        : "";
    return { exitCode: exitCodeFrom(err), stdout, stderr };
  }
}

/** Run a command and return trimmed stdout, or null on any error. */
export function execQuiet(
  cmd: string,
  cwd: string,
  options?: ExecOptions,
): string | null {
  try {
    return _execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(options?.timeout != null ? { timeout: options.timeout } : {}),
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

/**
 * Run a command with inherited stdio (output streams to the terminal).
 * Returns an `ExecRunResult` with the exit code. `stdout` and `stderr`
 * are always empty strings because the streams are inherited, not captured.
 *
 * Use this for commands whose output should be visible to the user in
 * real time (e.g. setup commands, cleanup operations).
 */
export function execInherit(cmd: string, cwd: string): ExecRunResult {
  try {
    _execSync(cmd, { cwd, stdio: "inherit" });
    return { exitCode: 0, stdout: "", stderr: "" };
  } catch (err: unknown) {
    return { exitCode: exitCodeFrom(err), stdout: "", stderr: "" };
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
 *
 * When called with a `timeout`, each subprocess is killed if it
 * exceeds the deadline — useful for TUI contexts where the CLI
 * must not hang indefinitely.
 */
export function checkGhAvailable(options?: ExecOptions): boolean {
  const timeoutOpt =
    options?.timeout != null ? { timeout: options.timeout } : {};
  try {
    _execSync("gh --version", {
      stdio: ["pipe", "pipe", "pipe"],
      ...timeoutOpt,
    });
  } catch {
    return false;
  }
  try {
    _execSync("gh auth status", {
      stdio: ["pipe", "pipe", "pipe"],
      ...timeoutOpt,
    });
  } catch {
    return false;
  }
  return true;
}
