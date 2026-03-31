/**
 * Tests for stale socket detection.
 *
 * Tests isPidAlive, checkSocketStatus, and removeStaleSocket with real
 * PID checks and filesystem operations.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  isPidAlive,
  checkSocketStatus,
  removeStaleSocket,
} from "./stale-socket.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function freshDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "stale-socket-test-"));
  return tmpDir;
}

function cleanup(): void {
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

// ---------------------------------------------------------------------------
// isPidAlive
// ---------------------------------------------------------------------------

describe("isPidAlive", () => {
  test("returns true for the current process PID", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test("returns false for a very large non-existent PID", () => {
    // PID 4194304 is the max on most Linux systems, use something high
    expect(isPidAlive(99999999)).toBe(false);
  });

  test("returns true for PID 1 (init/systemd — always running)", () => {
    // PID 1 should be alive. On some CI environments with limited
    // permissions, this may throw EPERM, which still counts as alive.
    expect(isPidAlive(1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkSocketStatus
// ---------------------------------------------------------------------------

describe("checkSocketStatus", () => {
  test("returns no-pid-file when PID file does not exist", () => {
    const dir = freshDir();
    const result = checkSocketStatus(join(dir, "runner.pid"));
    expect(result).toEqual({ status: "no-pid-file" });
    cleanup();
  });

  test("returns no-pid-file when PID file contains invalid content", () => {
    const dir = freshDir();
    const pidPath = join(dir, "runner.pid");
    writeFileSync(pidPath, "not-a-number\n");
    const result = checkSocketStatus(pidPath);
    expect(result).toEqual({ status: "no-pid-file" });
    cleanup();
  });

  test("returns valid with PID when runner process is alive", () => {
    const dir = freshDir();
    const pidPath = join(dir, "runner.pid");
    writeFileSync(pidPath, String(process.pid));
    const result = checkSocketStatus(pidPath);
    expect(result).toEqual({ status: "valid", pid: process.pid });
    cleanup();
  });

  test("returns stale when runner process is dead", () => {
    const dir = freshDir();
    const pidPath = join(dir, "runner.pid");
    writeFileSync(pidPath, "99999999");
    const result = checkSocketStatus(pidPath);
    expect(result).toEqual({ status: "stale", reason: "dead-pid" });
    cleanup();
  });

  test("handles PID file with whitespace and newlines", () => {
    const dir = freshDir();
    const pidPath = join(dir, "runner.pid");
    writeFileSync(pidPath, `  ${process.pid}  \n`);
    const result = checkSocketStatus(pidPath);
    expect(result).toEqual({ status: "valid", pid: process.pid });
    cleanup();
  });

  test("returns no-pid-file for empty PID file", () => {
    const dir = freshDir();
    const pidPath = join(dir, "runner.pid");
    writeFileSync(pidPath, "");
    const result = checkSocketStatus(pidPath);
    expect(result).toEqual({ status: "no-pid-file" });
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// removeStaleSocket
// ---------------------------------------------------------------------------

describe("removeStaleSocket", () => {
  test("removes an existing socket file", () => {
    const dir = freshDir();
    const socketPath = join(dir, "runner.sock");
    writeFileSync(socketPath, "stale-socket-placeholder");
    expect(existsSync(socketPath)).toBe(true);

    removeStaleSocket(socketPath);
    expect(existsSync(socketPath)).toBe(false);
    cleanup();
  });

  test("does not throw when socket file does not exist", () => {
    const dir = freshDir();
    const socketPath = join(dir, "nonexistent.sock");
    expect(() => removeStaleSocket(socketPath)).not.toThrow();
    cleanup();
  });

  test("does not throw for a directory path", () => {
    const dir = freshDir();
    const subdir = join(dir, "subdir");
    mkdirSync(subdir);
    // unlinkSync on a directory will fail, but removeStaleSocket
    // should swallow the error
    expect(() => removeStaleSocket(subdir)).not.toThrow();
    cleanup();
  });
});
