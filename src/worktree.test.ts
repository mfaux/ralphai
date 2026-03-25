import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";
import { writeConfigFile, getConfigFilePath } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

describe("worktree", () => {
  // -------------------------------------------------------------------------
  // Worktree detection (has its own mainRepo/worktreeDir setup)
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("worktree detection", () => {
    let mainRepo: string;
    let worktreeDir: string;
    let ralphaiHome: string;

    /** Per-test RALPHAI_HOME so config goes to a temp dir, not ~/.ralphai. */
    const env = () => ({ RALPHAI_HOME: ralphaiHome });

    beforeEach(() => {
      // Create a main repo with at least one commit (worktrees need a commit)
      mainRepo = join(
        tmpdir(),
        `ralphai-wt-main-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(mainRepo, { recursive: true });
      execSync("git init", { cwd: mainRepo, stdio: "ignore" });
      execSync("git config user.name 'Test'", {
        cwd: mainRepo,
        stdio: "ignore",
      });
      execSync("git config user.email 'test@test.com'", {
        cwd: mainRepo,
        stdio: "ignore",
      });
      execSync("git commit --allow-empty -m init", {
        cwd: mainRepo,
        stdio: "ignore",
      });

      // Create a worktree
      worktreeDir = join(
        tmpdir(),
        `ralphai-wt-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      execSync(
        `git worktree add ${JSON.stringify(worktreeDir)} -b test-worktree`,
        { cwd: mainRepo, stdio: "ignore" },
      );

      // Isolated RALPHAI_HOME for this test
      ralphaiHome = join(mainRepo, ".ralphai-home");
    });

    afterEach(() => {
      // Remove worktree before removing main repo
      try {
        execSync(`git worktree remove ${JSON.stringify(worktreeDir)} --force`, {
          cwd: mainRepo,
          stdio: "ignore",
        });
      } catch {
        /* ignore */
      }
      if (existsSync(mainRepo)) {
        rmSync(mainRepo, { recursive: true, force: true });
      }
      if (existsSync(worktreeDir)) {
        rmSync(worktreeDir, { recursive: true, force: true });
      }
    });

    it("init --yes fails inside a git worktree", () => {
      const result = runCli(["init", "--yes"], worktreeDir, env());
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "Cannot initialize ralphai inside a git worktree",
      );
      expect(result.stderr).toContain("ralphai init");
      expect(result.stderr).toContain("main repository");
    });

    it("init --yes succeeds in the main repo (not a worktree)", () => {
      const output = stripLogo(
        runCliOutput(["init", "--yes"], mainRepo, env()),
      );
      expect(output).toContain("Ralphai initialized");
      expect(existsSync(getConfigFilePath(mainRepo, env()))).toBe(true);
    });

    it("run resolves .ralphai/ from the main worktree when invoked inside a worktree", () => {
      // Initialize ralphai in the main repo (creates .ralphai/)
      runCliOutput(["init", "--yes"], mainRepo, env());

      // Run --show-config from worktree — should find .ralphai/ and
      // config.json in global state and resolve config successfully
      const result = runCli(["run", "--show-config"], worktreeDir, env());
      expect(result.exitCode).toBe(0);
      // Config output should include the agent command from the main repo's config
      expect(result.stdout).toContain("agentCommand");
      // Should detect that we're in a worktree
      expect(result.stdout).toContain("worktree");
    });

    it("run rejects execution from inside a worktree when not initialized", () => {
      const result = runCli(["run"], worktreeDir, env());
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must be run from the main repository");
    });
  });

  // -------------------------------------------------------------------------
  // Worktree subcommand (uses shared testDir via useTempGitDir)
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("worktree subcommand", () => {
    const ctx = useTempGitDir();

    function testEnv() {
      return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    }

    /** Create an initial commit so worktree operations work (CI has no global git config). */
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

    it("help text includes worktree command", () => {
      const result = runCli([], ctx.dir);
      const output = stripLogo(result.stdout);
      expect(output).toContain("worktree");
    });

    it("worktree --help shows worktree-specific help", () => {
      const output = runCliOutput(["worktree", "--help"], ctx.dir);
      expect(output).toContain("ralphai worktree");
      expect(output).toContain("list");
      expect(output).toContain("clean");
      expect(output).toContain("Use ralphai run");
    });

    it("worktree refuses inside a worktree", () => {
      // Set up a main repo with a worktree
      gitInitialCommit(ctx.dir);
      const worktreeDir = join(ctx.dir, "wt");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/test HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // Initialize ralphai so the worktree guard runs (it checks before .ralphai)
      runCli(["init", "--yes"], ctx.dir, testEnv());
      const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      writeFileSync(join(backlogDir, "prd-test.md"), "# Test plan\n");

      const result = runCli(["worktree"], worktreeDir, testEnv());
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("no longer starts runs");

      // Clean up worktree
      execSync(`git worktree remove "${worktreeDir}"`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
    });

    it("worktree without subcommand is rejected", () => {
      gitInitialCommit(ctx.dir);
      const result = runCli(["worktree"], ctx.dir, testEnv());
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("no longer starts runs");
    });

    it("worktree list shows no worktrees initially", () => {
      gitInitialCommit(ctx.dir);
      const output = runCliOutput(["worktree", "list"], ctx.dir, testEnv());
      expect(output).toContain("No active ralphai worktrees");
    });

    it("worktree list shows ralphai worktrees", () => {
      gitInitialCommit(ctx.dir);

      // Create a worktree on a ralphai/* branch
      const wtPath = join(ctx.dir, "wt-list-test");
      execSync(`git worktree add "${wtPath}" -b ralphai/my-feature HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      const output = runCliOutput(["worktree", "list"], ctx.dir, testEnv());
      expect(output).toContain("ralphai/my-feature");
      expect(output).toContain(wtPath);

      // Clean up
      execSync(`git worktree remove "${wtPath}"`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
    });

    it("worktree clean removes completed worktrees", () => {
      gitInitialCommit(ctx.dir);

      // Create a worktree on a ralphai/* branch
      const wtPath = join(ctx.dir, "wt-clean-test");
      execSync(`git worktree add "${wtPath}" -b ralphai/done-feature HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // No in-progress plan exists for this slug, so it should be cleaned
      const output = runCliOutput(["worktree", "clean"], ctx.dir, testEnv());
      expect(output).toContain("Removing:");
      expect(output).toContain("Cleaned 1 worktree(s)");
      expect(existsSync(wtPath)).toBe(false);
    });

    it("worktree clean preserves in-progress worktrees", () => {
      gitInitialCommit(ctx.dir);

      // Create a worktree on a ralphai/* branch
      // Slug is now filename minus .md, so prd-active-feature.md -> slug prd-active-feature
      const wtPath = join(ctx.dir, "wt-keep-test");
      execSync(
        `git worktree add "${wtPath}" -b ralphai/prd-active-feature HEAD`,
        {
          cwd: ctx.dir,
          stdio: "ignore",
        },
      );

      // Create matching in-progress plan in global state
      const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      const planDir = join(wipDir, "prd-active-feature");
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, "prd-active-feature.md"), "# Active plan\n");

      const output = runCliOutput(["worktree", "clean"], ctx.dir, testEnv());
      expect(output).toContain("Keeping:");
      expect(output).toContain("plan still in progress");
      expect(existsSync(wtPath)).toBe(true);

      // Clean up
      execSync(`git worktree remove "${wtPath}"`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
    });

    it("run --plan selects a specific plan", () => {
      gitInitialCommit(ctx.dir);

      // Initialize config and create two plans in global backlog
      runCli(["init", "--yes"], ctx.dir, testEnv());
      const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      writeFileSync(join(backlogDir, "prd-first.md"), "# First\n");
      writeFileSync(join(backlogDir, "prd-second.md"), "# Second\n");

      // Use RALPHAI_AGENT_COMMAND=true so the runner exits quickly (1 task)
      const result = runCli(
        ["run", "--plan=prd-second.md"],
        ctx.dir,
        { ...testEnv(), RALPHAI_AGENT_COMMAND: "true" },
        30000,
      );

      // The output should mention the second plan's slug, not the first
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("ralphai/prd-second");
    });

    it("run reuses an existing in-progress worktree and auto-resumes", () => {
      gitInitialCommit(ctx.dir);

      // Initialize config in global state
      runCli(["init", "--yes"], ctx.dir, testEnv());

      // Remove sample plan so only the in-progress plan is available
      const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      const samplePlan = join(backlogDir, "hello-ralphai.md");
      if (existsSync(samplePlan)) rmSync(samplePlan, { force: true });

      // Create in-progress plan in global state
      const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      const planDir = join(wipDir, "prd-resume");
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, "prd-resume.md"), "# Resume test\n");

      const worktreeDir = join(ctx.dir, "wt-resume");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/prd-resume HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // Use RALPHAI_AGENT_COMMAND=true so the runner exits quickly
      const result = runCli(
        ["run"],
        ctx.dir,
        { ...testEnv(), RALPHAI_AGENT_COMMAND: "true" },
        30000,
      );
      const combined = result.stdout + result.stderr;

      expect(combined).toContain(`Reusing existing worktree: ${worktreeDir}`);
    });

    it("worktree clean with no ralphai worktrees", () => {
      gitInitialCommit(ctx.dir);
      const output = runCliOutput(["worktree", "clean"], ctx.dir, testEnv());
      expect(output).toContain("No ralphai worktrees to clean");
    });

    it("run reuses the worktree referenced by receipt state", () => {
      gitInitialCommit(ctx.dir);

      // Set up initialized ralphai config in global state
      const env = testEnv();
      writeConfigFile(ctx.dir, { agentCommand: "true" }, env);

      // Write receipt to global state wip directory
      const { wipDir } = getRepoPipelineDirs(ctx.dir, env);
      const planDir = join(wipDir, "dark-mode");
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, "dark-mode.md"), "# Dark mode\n");
      writeFileSync(
        join(planDir, "receipt.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          `worktree_path=${join(ctx.dir, "wt-dark-mode")}`,
          "branch=ralphai/dark-mode",
          "slug=dark-mode",
        ].join("\n"),
      );

      execSync(
        `git worktree add "${join(ctx.dir, "wt-dark-mode")}" -b ralphai/dark-mode HEAD`,
        { cwd: ctx.dir, stdio: "ignore" },
      );

      const result = runCli(["run"], ctx.dir, env);
      const combined = result.stdout + result.stderr;

      expect(combined).toContain(
        `Reusing existing worktree: ${join(ctx.dir, "wt-dark-mode")}`,
      );
    });

    it("worktree run entrypoint is rejected", () => {
      gitInitialCommit(ctx.dir);

      const env = testEnv();
      writeConfigFile(ctx.dir, { agentCommand: "claude -p" }, env);

      const result = runCli(["worktree"], ctx.dir, env);
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(1);
      expect(combined).toContain("no longer starts runs");
    });

    it("worktree clean archives receipt file", () => {
      gitInitialCommit(ctx.dir);

      const env = testEnv();
      const { wipDir, archiveDir } = getRepoPipelineDirs(ctx.dir, env);

      // Create a worktree with no active plan (so clean will remove it)
      const worktreeDir = join(ctx.dir, "wt-done");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/done HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // Write a receipt for the slug "done" in global state
      const planDir = join(wipDir, "done");
      mkdirSync(planDir, { recursive: true });
      writeFileSync(
        join(planDir, "receipt.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "worktree_path=" + worktreeDir,
          "branch=ralphai/done",
          "slug=done",
        ].join("\n"),
      );

      const result = runCli(["worktree", "clean"], ctx.dir, env);
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(combined).toContain("Archived receipt: done/receipt.txt");

      // Receipt should no longer exist in in-progress
      expect(existsSync(join(wipDir, "done", "receipt.txt"))).toBe(false);

      // Receipt should exist in out/
      expect(existsSync(archiveDir)).toBe(true);
      const archivedReceipt = join(archiveDir, "done", "receipt.txt");
      expect(existsSync(archivedReceipt)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
