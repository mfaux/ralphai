/**
 * Tests for selectPlanForWorktree with GitHub issue pull fallback.
 *
 * Verifies that when the local backlog is empty and issueSource is "github",
 * the plan selection attempts to pull a GitHub issue before giving up.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { useTempDir } from "./test-utils.ts";
import { selectPlanForWorktree } from "./worktree/index.ts";
import type { PullIssueResult } from "./issue-lifecycle.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Initialize a git repo so getRepoPipelineDirs can detect the repo root. */
function initRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "pipe",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "init.txt"), "init\n");
  execSync('git add -A && git commit -m "init"', {
    cwd: dir,
    stdio: "pipe",
  });
}

/**
 * Set up global pipeline directories for the test repo.
 * Mirrors the pattern used in runner.test.ts.
 */
function setupPipeline(cwd: string): {
  ralphaiHome: string;
  backlogDir: string;
  wipDir: string;
} {
  // Import getRepoPipelineDirs dynamically since we need to set RALPHAI_HOME first
  const { getRepoPipelineDirs } = require("./global-state.ts");
  const { mkdtempSync } = require("fs");
  const { tmpdir } = require("os");

  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  const dirs = getRepoPipelineDirs(cwd, { RALPHAI_HOME: ralphaiHome });
  return { ralphaiHome, backlogDir: dirs.backlogDir, wipDir: dirs.wipDir };
}

// ---------------------------------------------------------------------------
// Tests: issueSource "github" pulls issue when backlog is empty
// ---------------------------------------------------------------------------

describe("selectPlanForWorktree — GitHub issue fallback", () => {
  const ctx = useTempDir();
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.RALPHAI_HOME;
    initRepo(ctx.dir);
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.RALPHAI_HOME;
    else process.env.RALPHAI_HOME = savedHome;
  });

  test("calls pullFn when backlog is empty and issueSource is 'github'", () => {
    const { backlogDir } = setupPipeline(ctx.dir);
    let pullCalled = false;

    // Provide a pullFn that simulates pulling a GitHub issue into the backlog
    const pullFn = (): PullIssueResult => {
      pullCalled = true;
      // Write a plan file into the backlog to simulate a successful pull
      writeFileSync(
        join(backlogDir, "fix-some-bug.md"),
        "---\nsource: github\nissue: 42\n---\n# Fix some bug\n",
      );
      return { pulled: true, message: "Pulled issue #42" };
    };

    const result = selectPlanForWorktree(ctx.dir, undefined, [], {
      issueSource: "github",
      pullFn,
    });

    expect(pullCalled).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("fix-some-bug");
    expect(result!.source).toBe("backlog");
  });

  test("returns null with clear message when issueSource is 'github' but no issues available", () => {
    setupPipeline(ctx.dir);
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));

    try {
      const pullFn = (): PullIssueResult => {
        return { pulled: false, message: "No open issues found" };
      };

      const result = selectPlanForWorktree(ctx.dir, undefined, [], {
        issueSource: "github",
        pullFn,
      });

      expect(result).toBeNull();
      const output = errors.join("\n");
      expect(output).toContain("No plans in backlog");
      expect(output).toContain("GitHub");
    } finally {
      console.error = origError;
    }
  });

  test("does not call pullFn when issueSource is 'none'", () => {
    setupPipeline(ctx.dir);
    let pullCalled = false;
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));

    try {
      const pullFn = (): PullIssueResult => {
        pullCalled = true;
        return { pulled: false, message: "should not be called" };
      };

      const result = selectPlanForWorktree(ctx.dir, undefined, [], {
        issueSource: "none",
        pullFn,
      });

      expect(result).toBeNull();
      expect(pullCalled).toBe(false);
      const output = errors.join("\n");
      expect(output).toContain("No plans in backlog");
    } finally {
      console.error = origError;
    }
  });

  test("does not call pullFn when no github options provided (backward compat)", () => {
    setupPipeline(ctx.dir);
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));

    try {
      // No githubOptions = default behavior (no pull attempt)
      const result = selectPlanForWorktree(ctx.dir, undefined, []);

      expect(result).toBeNull();
      const output = errors.join("\n");
      expect(output).toContain("No plans in backlog");
      // Should NOT mention GitHub since no github options provided
      expect(output).not.toContain("GitHub");
    } finally {
      console.error = origError;
    }
  });
});
