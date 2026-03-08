import { describe, it, expect } from "vitest";
import { existsSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";

describe("teardown command", () => {
  const ctx = useTempGitDir();

  it("teardown --yes removes .ralphai/ dir", () => {
    // First, set up ralphai
    runCliOutput(["init", "--yes"], ctx.dir);
    expect(existsSync(join(ctx.dir, ".ralphai"))).toBe(true);

    // Now tear down
    const output = stripLogo(runCliOutput(["teardown", "--yes"], ctx.dir));

    expect(output).toContain("Ralphai torn down");
    expect(existsSync(join(ctx.dir, ".ralphai"))).toBe(false);
  });

  it("teardown --yes prints not set up when .ralphai/ does not exist", () => {
    const output = stripLogo(runCliOutput(["teardown", "--yes"], ctx.dir));

    expect(output).toContain("not set up");
    expect(output).toContain(".ralphai/ does not exist");
  });

  it("teardown --yes <target-dir> tears down from target directory", () => {
    const targetDir = join(
      tmpdir(),
      `ralphai-teardown-target-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(targetDir, { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });

    try {
      // Set up ralphai in target
      runCliOutput(["init", "--yes", targetDir], ctx.dir);
      expect(existsSync(join(targetDir, ".ralphai"))).toBe(true);

      // Tear down from target
      const output = stripLogo(
        runCliOutput(["teardown", "--yes", targetDir], ctx.dir),
      );

      expect(output).toContain("Ralphai torn down");
      expect(existsSync(join(targetDir, ".ralphai"))).toBe(false);
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });
});

describe("reset command", () => {
  const ctx = useTempGitDir();

  it("reset --yes moves in-progress plans back to backlog", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    // Simulate an in-progress plan
    const inProgressDir = join(ctx.dir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-my-feature.md"), "# My Feature");

    const output = stripLogo(runCliOutput(["reset", "--yes"], ctx.dir));

    expect(output).toContain("Pipeline reset");
    // Plan should be back in backlog
    expect(
      existsSync(
        join(ctx.dir, ".ralphai", "pipeline", "backlog", "prd-my-feature.md"),
      ),
    ).toBe(true);
    // Plan should NOT be in in-progress
    expect(existsSync(join(inProgressDir, "prd-my-feature.md"))).toBe(false);
  });

  it("reset --yes deletes progress files", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const inProgressDir = join(ctx.dir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-test.md"), "# Test");
    writeFileSync(
      join(inProgressDir, "progress-test.md"),
      "## Progress Log\n### Task 1:\n**Status:** Complete",
    );

    runCliOutput(["reset", "--yes"], ctx.dir);

    expect(existsSync(join(inProgressDir, "progress-test.md"))).toBe(false);
  });

  it("reset --yes deletes receipt files", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const inProgressDir = join(ctx.dir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-test.md"), "# Test");
    writeFileSync(
      join(inProgressDir, "receipt-test.txt"),
      "started_at=2025-01-15T10:30:00Z\nsource=main\nbranch=ralphai/test\nslug=test\nturns_completed=3",
    );

    runCliOutput(["reset", "--yes"], ctx.dir);

    expect(existsSync(join(inProgressDir, "receipt-test.txt"))).toBe(false);
  });

  it("reset --yes handles multiple plans, progress, and receipts", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const inProgressDir = join(ctx.dir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-feature-a.md"), "# Feature A");
    writeFileSync(join(inProgressDir, "prd-feature-b.md"), "# Feature B");
    writeFileSync(
      join(inProgressDir, "progress-feature-a.md"),
      "## Progress Log",
    );
    writeFileSync(
      join(inProgressDir, "receipt-feature-a.txt"),
      "slug=feature-a",
    );
    writeFileSync(
      join(inProgressDir, "receipt-feature-b.txt"),
      "slug=feature-b",
    );

    const output = stripLogo(runCliOutput(["reset", "--yes"], ctx.dir));

    expect(output).toContain("2 plans moved to backlog");
    expect(output).toContain("Deleted 1 progress file");
    expect(output).toContain("Deleted 2 receipts");

    // Both plans should be in backlog
    expect(
      existsSync(
        join(ctx.dir, ".ralphai", "pipeline", "backlog", "prd-feature-a.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(ctx.dir, ".ralphai", "pipeline", "backlog", "prd-feature-b.md"),
      ),
    ).toBe(true);

    // in-progress should be clean (empty)
    const remaining = readdirSync(inProgressDir);
    expect(remaining).toEqual([]);
  });

  it("reset --yes reports nothing to reset when pipeline is clean", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const output = stripLogo(runCliOutput(["reset", "--yes"], ctx.dir));

    expect(output).toContain("Nothing to reset");
  });

  it("reset errors when .ralphai/ does not exist", () => {
    const result = runCli(["reset", "--yes"], ctx.dir);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  it("reset preserves in-progress directory", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const inProgressDir = join(ctx.dir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-test.md"), "# Test");

    runCliOutput(["reset", "--yes"], ctx.dir);

    // Directory should still exist
    expect(existsSync(inProgressDir)).toBe(true);
  });

  it("reset --yes force-removes dirty worktrees and deletes unmerged branches", () => {
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

    runCliOutput(["init", "--yes"], ctx.dir);

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
    const output = runCliOutput(["reset", "--yes"], ctx.dir);
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
