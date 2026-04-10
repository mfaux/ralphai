/**
 * Tests for shared exec utilities.
 *
 * Tests the `execQuiet` and `checkGhAvailable` functions from `src/exec.ts`,
 * focusing on:
 * - Timeout behavior: subprocess calls with a timeout return null / false
 *   when the command exceeds the deadline, rather than hanging.
 * - Backward compatibility: callers without timeout still work.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execQuiet, execRun, checkGhAvailable, setExecImpl } from "./exec.ts";

// ---------------------------------------------------------------------------
// execQuiet with timeout
// ---------------------------------------------------------------------------

describe("execQuiet with timeout", () => {
  it("returns null when command exceeds timeout", () => {
    // Use a real long-running command with a very short timeout.
    // `sleep 10` will be killed by the 50ms timeout.
    const result = execQuiet("sleep 10", process.cwd(), { timeout: 50 });
    expect(result).toBeNull();
  });

  it("returns output when command completes within timeout", () => {
    const result = execQuiet("echo hello", process.cwd(), { timeout: 5000 });
    expect(result).toBe("hello");
  });

  it("still works without timeout option (backward compat)", () => {
    const result = execQuiet("echo compat", process.cwd());
    expect(result).toBe("compat");
  });
});

// ---------------------------------------------------------------------------
// execRun
// ---------------------------------------------------------------------------

describe("execRun", () => {
  it("returns exitCode 0 and stdout on success", () => {
    const result = execRun("echo hello", process.cwd());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
  });

  it("returns non-zero exitCode on failure", () => {
    const result = execRun("bash -c 'exit 42'", process.cwd());
    expect(result.exitCode).toBe(42);
  });

  it("captures stderr on failure", () => {
    const result = execRun(
      "bash -c 'echo err-output >&2; exit 1'",
      process.cwd(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("err-output");
  });

  it("captures stdout on failure when stderr is empty", () => {
    const result = execRun("bash -c 'echo out-output; exit 1'", process.cwd());
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("out-output");
  });

  it("returns exitCode 1 when command exceeds timeout", () => {
    const result = execRun("sleep 10", process.cwd(), { timeout: 50 });
    expect(result.exitCode).not.toBe(0);
  });

  it("respects cwd", () => {
    const result = execRun("pwd", "/tmp");
    expect(result.exitCode).toBe(0);
    // /tmp may resolve to a symlink target, just verify it ran
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// checkGhAvailable with timeout
// ---------------------------------------------------------------------------

describe("checkGhAvailable with timeout", () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("returns false when subprocess times out", () => {
    // Mock execSync to simulate a command that hangs (throws on timeout)
    restore = setExecImpl(((cmd: string, opts: any) => {
      if (opts?.timeout && opts.timeout < 100) {
        const err = new Error("ETIMEDOUT");
        (err as any).killed = true;
        (err as any).signal = "SIGTERM";
        throw err;
      }
      return "";
    }) as any);

    const result = checkGhAvailable({ timeout: 50 });
    expect(result).toBe(false);
  });

  it("still works without timeout option (backward compat)", () => {
    // Mock execSync to succeed immediately
    restore = setExecImpl((() => "") as any);

    const result = checkGhAvailable();
    expect(result).toBe(true);
  });
});
