/**
 * Tests for selectPlanForWorktree runner liveness checks.
 *
 * Verifies that in-progress plans with a live runner process are skipped
 * in both the unattended-plans path and the attended-plans fallback path.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { useTempDir } from "./test-utils.ts";
import { selectPlanForWorktree } from "./worktree/index.ts";
import type { WorktreeEntry } from "./worktree/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function setupPipeline(cwd: string): {
  ralphaiHome: string;
  backlogDir: string;
  wipDir: string;
} {
  const { getRepoPipelineDirs } = require("./global-state.ts");
  const { mkdtempSync } = require("fs");
  const { tmpdir } = require("os");

  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  const dirs = getRepoPipelineDirs(cwd, { RALPHAI_HOME: ralphaiHome });
  return { ralphaiHome, backlogDir: dirs.backlogDir, wipDir: dirs.wipDir };
}

function writePlan(wipDir: string, slug: string): void {
  const slugDir = join(wipDir, slug);
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(join(slugDir, `${slug}.md`), `# Plan: ${slug}\n`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("selectPlanForWorktree — runner liveness", () => {
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

  test("skips unattended in-progress plan with a live runner", () => {
    const { wipDir } = setupPipeline(ctx.dir);
    writePlan(wipDir, "live-plan");

    // No active worktrees (unattended), but runner is alive
    const result = selectPlanForWorktree(
      ctx.dir,
      undefined,
      [],
      undefined,
      () => true, // simulate live runner
    );

    // Should not return the plan — the live runner is handling it
    expect(result).toBeNull();
  });

  test("resumes unattended in-progress plan with dead runner", () => {
    const { wipDir } = setupPipeline(ctx.dir);
    writePlan(wipDir, "stale-plan");

    const result = selectPlanForWorktree(
      ctx.dir,
      undefined,
      [],
      undefined,
      () => false, // simulate dead runner
    );

    expect(result).not.toBeNull();
    expect(result!.slug).toBe("stale-plan");
    expect(result!.source).toBe("in-progress");
  });

  test("attended-plans fallback skips plans with a live runner", () => {
    const { wipDir } = setupPipeline(ctx.dir);
    writePlan(wipDir, "attended-plan");

    // Simulate active worktree for this plan
    const activeWorktrees: WorktreeEntry[] = [
      {
        path: "/tmp/fake-worktree",
        branch: "ralphai/attended-plan",
        head: "abc123",
        bare: false,
      },
    ];

    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));

    try {
      const result = selectPlanForWorktree(
        ctx.dir,
        undefined,
        activeWorktrees,
        undefined,
        () => true, // simulate live runner
      );

      // Should not return the attended plan because runner is alive
      expect(result).toBeNull();
    } finally {
      console.error = origError;
    }
  });

  test("attended-plans fallback resumes plan with dead runner", () => {
    const { wipDir } = setupPipeline(ctx.dir);
    writePlan(wipDir, "crashed-plan");

    // Simulate active worktree for this plan
    const activeWorktrees: WorktreeEntry[] = [
      {
        path: "/tmp/fake-worktree",
        branch: "ralphai/crashed-plan",
        head: "abc123",
        bare: false,
      },
    ];

    const result = selectPlanForWorktree(
      ctx.dir,
      undefined,
      activeWorktrees,
      undefined,
      () => false, // simulate dead runner (stale worktree)
    );

    expect(result).not.toBeNull();
    expect(result!.slug).toBe("crashed-plan");
    expect(result!.source).toBe("in-progress");
  });
});
