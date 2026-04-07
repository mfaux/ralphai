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
import { execQuiet, checkGhAvailable, setExecImpl } from "./exec.ts";

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
