import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, rmSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { execSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { runCliInProcess, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("runner config", () => {
  const ctx = useTempGitDir();

  /** Per-test RALPHAI_HOME so config goes to a temp dir, not ~/.ralphai. */
  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Resolve the global config file path for this test's cwd. */
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  // -------------------------------------------------------------------------
  // Init defaults
  // -------------------------------------------------------------------------

  it("init --yes does not include deprecated keys in config", async () => {
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());

    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(config.mode).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Run config tests
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("run config", () => {
    beforeEach(async () => {
      // Scaffold ralphai (creates .ralphai/ directory)
      await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    });

    it("run --show-config shows default values", async () => {
      const result = await runCliInProcess(
        ["run", "--show-config"],
        ctx.dir,
        testEnv(),
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("iterationTimeout   = off");
      expect(result.stdout).toContain("(default)");
    });

    it("run --dry-run produces preview output", async () => {
      const result = await runCliInProcess(["run", "--dry-run"], ctx.dir, {
        ...testEnv(),
        RALPHAI_AGENT_COMMAND: "echo mock",
        RALPHAI_NO_UPDATE_CHECK: "1",
      });
      expect(result.exitCode).toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("dry-run");
    });

    it("run --help shows usage information", async () => {
      const result = await runCliInProcess(
        ["run", "--help"],
        ctx.dir,
        testEnv(),
      );
      expect(result.exitCode).toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("--dry-run");
      expect(combined).toContain("--once");
    });

    it("run 3 is treated as an issue target (requires GitHub)", async () => {
      const result = await runCliInProcess(["run", "3"], ctx.dir, testEnv());
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      // Issue target requires GitHub repo detection — fails in test env
      expect(combined).toMatch(/GitHub repo|gh CLI/i);
    });

    it("built CLI runs the TS runner directly (no shell subprocess)", () => {
      const repoRoot = join(__dirname, "..");
      const distCli = join(repoRoot, "dist", "cli.mjs");

      // Read the baseBranch that init --yes wrote to global config so
      // the branch we create matches what the runner will validate.
      const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
      const branch = cfg.baseBranch || "main";
      execSync(`git checkout -b ${branch}`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
      execSync("git config user.name 'Test User'", {
        cwd: ctx.dir,
        stdio: "ignore",
      });
      execSync("git config user.email 'test@example.com'", {
        cwd: ctx.dir,
        stdio: "ignore",
      });
      execSync("git commit --allow-empty -m init", {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      execSync("bun run build", {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Remove sample plan so the backlog is empty for this test
      const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      const samplePlanFile = join(backlogDir, "hello-world.md");
      if (existsSync(samplePlanFile)) rmSync(samplePlanFile, { force: true });

      const output = execFileSync("node", [distCli, "run", "--dry-run"], {
        cwd: ctx.dir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...testEnv(),
          RALPHAI_NO_UPDATE_CHECK: "1",
          RALPHAI_AGENT_COMMAND: "echo test-agent",
        },
      });

      expect(output).toContain("No runnable work found.");
    });
  });
});
