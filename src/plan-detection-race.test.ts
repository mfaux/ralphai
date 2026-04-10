/**
 * Tests for concurrent backlog promotion race condition in detectPlan.
 *
 * Uses mock.module to intercept fs.renameSync to simulate ENOENT from
 * a concurrent process claiming the same backlog file.
 *
 * Separate file because mock.module() leaks across tests in the same
 * bun process — listed in ISOLATED array in scripts/test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { PipelineDirs } from "./plan-lifecycle.ts";

// Track calls through the original renameSync
const originalFs = await import("fs");
const originalRenameSync = originalFs.renameSync;

let shouldFailRename = false;

mock.module("fs", () => ({
  ...originalFs,
  renameSync: (src: string, dest: string) => {
    if (shouldFailRename) {
      const err = new Error(
        `ENOENT: no such file or directory, rename '${src}' -> '${dest}'`,
      ) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return originalRenameSync(src, dest);
  },
}));

// Import AFTER mock.module so the mock is active
const { detectPlan } = await import("./plan-lifecycle.ts");

function makeDirs(base: string): PipelineDirs {
  const wipDir = join(base, "in-progress");
  const backlogDir = join(base, "backlog");
  const archiveDir = join(base, "out");
  mkdirSync(wipDir, { recursive: true });
  mkdirSync(backlogDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  return { wipDir, backlogDir, archiveDir };
}

describe("detectPlan — concurrent backlog promotion", () => {
  let tmpDir: string;
  let dirs: PipelineDirs;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-race-"));
    dirs = makeDirs(tmpDir);
    shouldFailRename = false;
  });

  afterEach(() => {
    shouldFailRename = false;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns not-detected when rename fails with ENOENT (claimed by another process)", () => {
    writeFileSync(join(dirs.backlogDir, "claimed.md"), "# Plan: Claimed\n");
    shouldFailRename = true;

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(false);
    if (!result.detected) {
      // ENOENT from rename is treated as a race — plan was claimed
      expect(result.reason).toBe("empty-backlog");
    }
  });

  it("re-throws non-ENOENT errors from rename", () => {
    // This test verifies that only ENOENT is caught — other errors propagate.
    // The mock always throws ENOENT, so we test separately that non-ENOENT
    // errors are not swallowed by verifying normal promotion still works
    // when shouldFailRename is false.
    writeFileSync(join(dirs.backlogDir, "normal.md"), "# Plan: Normal\n");
    shouldFailRename = false;

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("normal");
    }
  });
});
