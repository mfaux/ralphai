import { describe, it, expect } from "bun:test";
import { existsSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import {
  runCliInProcess,
  runCliOutputInProcess,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";

describe("reset command", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("reset --yes moves in-progress plans back to backlog", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    // Simulate an in-progress plan
    const { wipDir: inProgressDir, backlogDir } = getRepoPipelineDirs(
      ctx.dir,
      testEnv(),
    );
    const planDir = join(inProgressDir, "prd-my-feature");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-my-feature.md"), "# My Feature");

    const output = stripLogo(
      await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Pipeline reset");
    // Plan should be back in backlog as a flat file
    expect(existsSync(join(backlogDir, "prd-my-feature.md"))).toBe(true);
    // Slug-folder should NOT exist in backlog
    expect(existsSync(join(backlogDir, "prd-my-feature"))).toBe(false);
    // Plan should NOT be in in-progress
    expect(existsSync(join(inProgressDir, "prd-my-feature"))).toBe(false);
  });

  it("reset --yes deletes progress files", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: inProgressDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(inProgressDir, "prd-test");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-test.md"), "# Test");
    writeFileSync(
      join(planDir, "progress.md"),
      "## Progress Log\n### Task 1:\n**Status:** Complete",
    );

    await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv());

    expect(existsSync(join(inProgressDir, "prd-test", "progress.md"))).toBe(
      false,
    );
  });

  it("reset --yes deletes receipt files", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: inProgressDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(inProgressDir, "prd-test");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-test.md"), "# Test");
    writeFileSync(
      join(planDir, "receipt.txt"),
      "started_at=2025-01-15T10:30:00Z\nbranch=ralphai/test\nslug=test",
    );

    await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv());

    expect(existsSync(join(inProgressDir, "prd-test", "receipt.txt"))).toBe(
      false,
    );
  });

  it("reset --yes handles multiple plans, progress, and receipts", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: inProgressDir, backlogDir } = getRepoPipelineDirs(
      ctx.dir,
      testEnv(),
    );
    const planDirA = join(inProgressDir, "prd-feature-a");
    const planDirB = join(inProgressDir, "prd-feature-b");
    mkdirSync(planDirA, { recursive: true });
    mkdirSync(planDirB, { recursive: true });
    writeFileSync(join(planDirA, "prd-feature-a.md"), "# Feature A");
    writeFileSync(join(planDirB, "prd-feature-b.md"), "# Feature B");
    writeFileSync(join(planDirA, "progress.md"), "## Progress Log");
    writeFileSync(join(planDirA, "receipt.txt"), "slug=feature-a");
    writeFileSync(join(planDirB, "receipt.txt"), "slug=feature-b");

    const output = stripLogo(
      await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("2 plans moved to backlog");
    expect(output).toContain("Deleted progress.md and receipt.txt in 2 plans");

    // Both plans should be in backlog as flat files
    expect(existsSync(join(backlogDir, "prd-feature-a.md"))).toBe(true);
    expect(existsSync(join(backlogDir, "prd-feature-b.md"))).toBe(true);
    // Slug-folders should NOT exist in backlog
    expect(existsSync(join(backlogDir, "prd-feature-a"))).toBe(false);
    expect(existsSync(join(backlogDir, "prd-feature-b"))).toBe(false);

    // in-progress should be clean (empty)
    const remaining = readdirSync(inProgressDir);
    expect(remaining).toEqual([]);
  });

  it("reset --yes reports nothing to reset when pipeline is clean", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const output = stripLogo(
      await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Nothing to reset");
  });

  it("reset errors when config does not exist", async () => {
    const result = await runCliInProcess(
      ["reset", "--yes"],
      ctx.dir,
      testEnv(),
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  it("reset preserves in-progress directory", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: inProgressDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(inProgressDir, "prd-test");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-test.md"), "# Test");

    await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv());

    // Directory should still exist
    expect(existsSync(inProgressDir)).toBe(true);
  });

  it("reset --yes force-removes dirty worktrees and deletes unmerged branches", async () => {
    // Set up git identity for commits
    execSync(
      'git config user.email "test@test.com" && git config user.name "Test"',
      { cwd: ctx.dir, stdio: "ignore" },
    );
    // Create initial commit
    execSync("git commit --allow-empty -m 'init'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    // Create a worktree on a ralphai/* branch
    const wtPath = join(ctx.dir, "wt-dirty");
    execSync(`git worktree add "${wtPath}" -b ralphai/dirty-test HEAD`, {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    // Make the worktree dirty (uncommitted changes)
    writeFileSync(join(wtPath, "dirty-file.txt"), "dirty");
    execSync("git add dirty-file.txt", { cwd: wtPath, stdio: "ignore" });

    // Reset should force-remove the dirty worktree
    const output = await runCliOutputInProcess(
      ["reset", "--yes"],
      ctx.dir,
      testEnv(),
    );
    expect(output).toContain("Pipeline reset");
    expect(existsSync(wtPath)).toBe(false);

    // Branch should be force-deleted even though it's not merged
    const branchCheck = execSync("git branch --list ralphai/dirty-test", {
      cwd: ctx.dir,
      encoding: "utf-8",
    }).trim();
    expect(branchCheck).toBe("");
  });
});
