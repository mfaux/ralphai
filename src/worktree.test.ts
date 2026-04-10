import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  runCliInProcess,
  runCliOutputInProcess,
  stripLogo,
} from "./test-utils.ts";
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

    it("init --yes fails inside a git worktree", async () => {
      const result = await runCliInProcess(
        ["init", "--yes"],
        worktreeDir,
        env(),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "Cannot initialize ralphai inside a git worktree",
      );
      expect(result.stderr).toContain("ralphai init");
      expect(result.stderr).toContain("main repository");
    });

    it("init --yes succeeds in the main repo (not a worktree)", async () => {
      const output = stripLogo(
        await runCliOutputInProcess(["init", "--yes"], mainRepo, env()),
      );
      expect(output).toContain("Ralphai initialized");
      expect(existsSync(getConfigFilePath(mainRepo, env()))).toBe(true);
    });

    it("run resolves .ralphai/ from the main worktree when invoked inside a worktree", async () => {
      // Initialize ralphai in the main repo (creates .ralphai/)
      await runCliOutputInProcess(["init", "--yes"], mainRepo, env());

      // Run --show-config from worktree — should find .ralphai/ and
      // config.json in global state and resolve config successfully
      const result = await runCliInProcess(
        ["run", "--show-config"],
        worktreeDir,
        env(),
      );
      expect(result.exitCode).toBe(0);
      // Config output should include the agent command from the main repo's config
      expect(result.stdout).toContain("agentCommand");
      // Should detect that we're in a worktree
      expect(result.stdout).toContain("worktree");
    });

    it("run resolves to the main repo when invoked from a worktree (not initialized)", async () => {
      const result = await runCliInProcess(["run"], worktreeDir, env());
      expect(result.exitCode).not.toBe(0);
      // Should resolve to the main repo and then fail because ralphai is not set up
      expect(result.stderr).toContain("Detected worktree");
      expect(result.stderr).toContain("not set up");
    });
  });
});
