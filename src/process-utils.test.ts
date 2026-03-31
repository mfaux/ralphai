/**
 * Tests for process utilities: isPidAlive, readRunnerPid, stopRunner.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import { isPidAlive, readRunnerPid, stopRunner } from "./process-utils.ts";

// ---------------------------------------------------------------------------
// isPidAlive
// ---------------------------------------------------------------------------

describe("isPidAlive", () => {
  test("returns true for the current process PID", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test("returns false for a very large non-existent PID", () => {
    expect(isPidAlive(999999999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readRunnerPid
// ---------------------------------------------------------------------------

describe("readRunnerPid", () => {
  const ctx = useTempDir();

  test("returns number from valid PID file", () => {
    const dir = join(ctx.dir, "valid-pid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "runner.pid"), "12345\n");
    expect(readRunnerPid(dir)).toBe(12345);
  });

  test("returns null when PID file is missing", () => {
    const dir = join(ctx.dir, "no-pid");
    mkdirSync(dir, { recursive: true });
    expect(readRunnerPid(dir)).toBeNull();
  });

  test("returns null for non-numeric content", () => {
    const dir = join(ctx.dir, "bad-pid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "runner.pid"), "not-a-number\n");
    expect(readRunnerPid(dir)).toBeNull();
  });

  test("returns null for empty file", () => {
    const dir = join(ctx.dir, "empty-pid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "runner.pid"), "");
    expect(readRunnerPid(dir)).toBeNull();
  });

  test("handles whitespace around PID", () => {
    const dir = join(ctx.dir, "whitespace-pid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "runner.pid"), "  42  \n");
    expect(readRunnerPid(dir)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// stopRunner
// ---------------------------------------------------------------------------

describe("stopRunner", () => {
  test("returns false for a non-existent PID", () => {
    expect(stopRunner(999999999)).toBe(false);
  });
});
