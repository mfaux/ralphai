import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { runCliInProcess, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath, writeConfigFile } from "./config.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";

// ---------------------------------------------------------------------------
// Doctor workspace feedback validation
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "doctor workspace feedback checks",
  () => {
    const ctx = useTempGitDir();

    function testEnv() {
      return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    }
    function configPath() {
      return getConfigFilePath(ctx.dir, testEnv());
    }

    /**
     * Helper: initialize a fully passing doctor environment so we can isolate
     * workspace-specific behavior without noise from unrelated check failures.
     */
    async function initCleanDoctor() {
      execSync(
        "git config user.email 'test@test.com' && git config user.name 'Test'",
        { cwd: ctx.dir, stdio: "ignore" },
      );
      execSync("git checkout -b main", { cwd: ctx.dir, stdio: "ignore" });
      writeFileSync(join(ctx.dir, "seed.txt"), "seed");
      // Ignore the RALPHAI_HOME dir so global config doesn't dirty the worktree
      writeFileSync(join(ctx.dir, ".gitignore"), ".ralphai-home/\n");
      execSync("git add -A && git commit -m 'init'", {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());

      execSync("git add -A && git commit -m 'add ralphai'", {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // Override agent.command and root hooks.feedback to always pass
      const config = JSON.parse(readFileSync(configPath(), "utf-8"));
      config.agent.command = "true";
      config.hooks.feedback = ["true"];

      // Seed a plan in the global backlog so the backlog check passes
      const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      writeFileSync(join(backlogDir, "seed-plan.md"), "# Plan: Seed\n");

      return config;
    }

    it("workspace feedback commands that exit 0 produce pass results", async () => {
      const config = await initCleanDoctor();

      config.workspaces = {
        "packages/web": { feedbackCommands: ["true"] },
      };
      writeConfigFile(ctx.dir, config, testEnv());

      const result = await runCliInProcess(["doctor"], ctx.dir, {
        ...testEnv(),
        NO_COLOR: "1",
      });
      const output = result.stdout;

      expect(output).toContain("feedback (packages/web)");
      expect(output).toContain("exits 0");
      expect(output).toContain("All checks passed");
      expect(result.exitCode).toBe(0);
    });

    it("workspace feedback commands that exit non-zero produce warn (not fail)", async () => {
      const config = await initCleanDoctor();

      config.workspaces = {
        "packages/api": { feedbackCommands: ["false"] },
      };
      writeConfigFile(ctx.dir, config, testEnv());

      const result = await runCliInProcess(["doctor"], ctx.dir, {
        ...testEnv(),
        NO_COLOR: "1",
      });
      const output = result.stdout;

      expect(output).toContain("feedback (packages/api)");
      expect(output).toContain("exits non-zero");
      // Warning sign should be present
      expect(output).toContain("\u26A0");
      // Should be a warning, not a failure — exit code 0
      expect(result.exitCode).toBe(0);
    });

    it("no workspaces config means no workspace checks run", async () => {
      const config = await initCleanDoctor();

      // Explicitly no workspaces key
      delete config.workspaces;
      writeConfigFile(ctx.dir, config, testEnv());

      const result = await runCliInProcess(["doctor"], ctx.dir, {
        ...testEnv(),
        NO_COLOR: "1",
      });
      const output = result.stdout;

      // Should not mention any workspace feedback
      expect(output).not.toContain("feedback (");
      expect(output).toContain("All checks passed");
      expect(result.exitCode).toBe(0);
    });

    it("multiple workspace entries are each validated independently", async () => {
      const config = await initCleanDoctor();

      config.workspaces = {
        "packages/web": { feedbackCommands: ["true"] },
        "packages/api": { feedbackCommands: ["false"] },
      };
      writeConfigFile(ctx.dir, config, testEnv());

      const result = await runCliInProcess(["doctor"], ctx.dir, {
        ...testEnv(),
        NO_COLOR: "1",
      });
      const output = result.stdout;

      // web should pass
      expect(output).toContain("feedback (packages/web)");
      // api should warn
      expect(output).toContain("feedback (packages/api)");
      expect(output).toContain("exits non-zero");
      // Overall: warnings only, exit code 0
      expect(result.exitCode).toBe(0);
    });
  },
);
