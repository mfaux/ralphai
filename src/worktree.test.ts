import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { runCli, runCliOutput, stripLogo } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";

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
});
