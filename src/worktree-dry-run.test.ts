import { describe, it, expect } from "vitest";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { runCli, useTempGitDir } from "./test-utils.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

describe.skipIf(process.platform === "win32")("worktree --dry-run", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Create an initial commit so worktree operations work. */
  function gitInitialCommit(cwd: string): void {
    execSync("git config user.name 'Test'", { cwd, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd,
      stdio: "ignore",
    });
    execSync("git commit --allow-empty -m 'initial'", {
      cwd,
      stdio: "ignore",
    });
  }

  /** Set up a backlog plan in global state and return the plan filename. */
  function setupBacklogPlan(cwd: string, slug = "prd-dry-test"): string {
    const { backlogDir } = getRepoPipelineDirs(cwd, testEnv());
    const filename = `${slug}.md`;
    writeFileSync(join(backlogDir, filename), `# Dry-run test plan\n`);
    return filename;
  }

  /** Return true if a ralphai/* branch exists for the given slug. */
  function ralphaBranchExists(cwd: string, slug: string): boolean {
    const branches = execSync(`git branch --list "ralphai/${slug}"`, {
      cwd,
      encoding: "utf-8",
    }).trim();
    return branches.length > 0;
  }

  it("--dry-run does not create a worktree or branch", () => {
    gitInitialCommit(ctx.dir);
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const slug = "prd-dry-test";
    setupBacklogPlan(ctx.dir, slug);

    const result = runCli(["worktree", "--dry-run"], ctx.dir, testEnv(), 30000);

    const combined = result.stdout + result.stderr;

    // Should contain dry-run output from the TS runner
    expect(combined).toContain("dry-run");

    // No worktree directory for this plan should have been created
    const worktreeBase = join(ctx.dir, "..", ".ralphai-worktrees");
    const planWorktree = join(worktreeBase, slug);
    expect(existsSync(planWorktree)).toBe(false);

    // No ralphai/<slug> branch should exist
    expect(ralphaBranchExists(ctx.dir, slug)).toBe(false);
  });

  it("-n shorthand does not create a worktree or branch", () => {
    gitInitialCommit(ctx.dir);
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const slug = "prd-dry-short";
    setupBacklogPlan(ctx.dir, slug);

    runCli(["worktree", "-n"], ctx.dir, testEnv(), 30000);

    // No worktree directory for this plan should have been created
    const worktreeBase = join(ctx.dir, "..", ".ralphai-worktrees");
    const planWorktree = join(worktreeBase, slug);
    expect(existsSync(planWorktree)).toBe(false);

    // No ralphai/<slug> branch should exist
    expect(ralphaBranchExists(ctx.dir, slug)).toBe(false);
  });

  it("--dry-run with --plan still does not create a worktree", () => {
    gitInitialCommit(ctx.dir);
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const slug = "prd-specific-dry";
    const filename = setupBacklogPlan(ctx.dir, slug);

    runCli(
      ["worktree", `--plan=${filename}`, "--dry-run"],
      ctx.dir,
      testEnv(),
      30000,
    );

    // No worktree directory for this plan should have been created
    const worktreeBase = join(ctx.dir, "..", ".ralphai-worktrees");
    const planWorktree = join(worktreeBase, slug);
    expect(existsSync(planWorktree)).toBe(false);

    // No ralphai/<slug> branch should exist
    expect(ralphaBranchExists(ctx.dir, slug)).toBe(false);
  });
});
