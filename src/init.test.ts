import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath, writeConfigFile } from "./config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("init command", () => {
  const ctx = useTempGitDir();

  /** Per-test RALPHAI_HOME so config goes to a temp dir, not ~/.ralphai. */
  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Resolve the global config file path for this test's cwd. */
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  it("init --yes writes config to global state", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("Ralphai initialized");

    // Config at global state dir (not in the repo)
    expect(existsSync(configPath())).toBe(true);
    expect(existsSync(join(ctx.dir, "ralphai.json"))).toBe(false);
  });

  it("init --yes creates no repo-local files except optional AGENTS.md", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // No .ralphai/ directory should be created
    expect(existsSync(join(ctx.dir, ".ralphai"))).toBe(false);

    // AGENTS.md is created (default updateAgentsMd=true when no existing section)
    expect(existsSync(join(ctx.dir, "AGENTS.md"))).toBe(true);
  });

  it("init --yes does not modify .gitignore", () => {
    // Create a pre-existing .gitignore
    writeFileSync(join(ctx.dir, ".gitignore"), "node_modules\n");

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const gitignore = readFileSync(join(ctx.dir, ".gitignore"), "utf-8");
    expect(gitignore).toBe("node_modules\n");
  });

  it("init --yes does not create .gitignore when none exists", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // .gitignore should not be created by init
    expect(existsSync(join(ctx.dir, ".gitignore"))).toBe(false);
  });

  it("init --yes generates config with auto-detected or default agent command", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    // Agent command is auto-detected from PATH or falls back to OpenCode
    expect(typeof parsed.agentCommand).toBe("string");
    expect(parsed.agentCommand.length).toBeGreaterThan(0);
    expect(parsed.baseBranch).toBeDefined();
    expect(parsed).not.toHaveProperty("protectedBranches");
    // feedbackCommands should be an empty array when not detected
    expect(parsed.feedbackCommands).toEqual([]);
    expect(parsed.autoCommit).toBe(false);
    expect(parsed.iterationTimeout).toBe(0);
  });

  it("init --yes writes all config keys with defaults", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);

    // Verify exactly 12 keys are present (includes repoPath)
    expect(Object.keys(parsed)).toHaveLength(12);

    // Core settings from wizard
    expect(typeof parsed.agentCommand).toBe("string");
    expect(parsed.agentCommand.length).toBeGreaterThan(0);
    expect(parsed.baseBranch).toBeDefined();
    expect(parsed.feedbackCommands).toEqual([]);

    expect(parsed.autoCommit).toBe(false);

    // Runtime defaults
    expect(parsed.iterationTimeout).toBe(0);
    expect(parsed.continuous).toBe(false);

    // Issue tracking defaults
    expect(parsed.issueSource).toBe("none");
    expect(parsed.issueLabel).toBe("ralphai");
    expect(parsed.issueInProgressLabel).toBe("ralphai:in-progress");
    expect(parsed.issueRepo).toBe("");
    expect(parsed.issueCommentProgress).toBe(true);
  });

  it("init --yes --agent-command uses the provided agent command", () => {
    runCli(["init", "--yes", "--agent-command=claude -p"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.agentCommand).toBe("claude -p");
    // Other keys should still get defaults
    expect(Object.keys(parsed)).toHaveLength(12);
    expect(parsed.autoCommit).toBe(false);
  });

  it("init --yes warns when agent command binary is not in PATH", () => {
    const result = runCli(
      ["init", "--yes", "--agent-command=nonexistent-agent-xyz -p"],
      ctx.dir,
      testEnv(),
    );
    const output = result.stdout + result.stderr;
    expect(output).toContain("not found in PATH");
    expect(output).toContain("nonexistent-agent-xyz");
    // Should still succeed (warning, not error)
    expect(existsSync(configPath())).toBe(true);
  });

  it("init --yes warns when no feedback commands are detected", () => {
    // ctx.dir has no package.json, so detectFeedbackCommands returns ""
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;
    expect(output).toContain("No build/test/lint scripts detected");
    expect(output).toContain("feedbackCommands");
    // Should still succeed (warning, not error)
    expect(existsSync(configPath())).toBe(true);
  });

  it("init --yes prints detection summary with detected values", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);
    // Summary should contain the header and detected values
    expect(output).toContain("Detected:");
    // Agent line shows auto-detected or fallback command
    expect(output).toMatch(/Agent:.*\S/);
    // Base branch (detected from git)
    expect(output).toMatch(/Branch:.*main|master/);
    // Feedback should show (none) since ctx.dir has no package.json
    expect(output).toContain("(none)");
    // Project should also show (none) since no package.json
    expect(output).toMatch(/Project:.*\(none\)/);
  });

  it("init --yes detection summary shows custom agent command", () => {
    const result = runCli(
      ["init", "--yes", "--agent-command=my-agent --flag"],
      ctx.dir,
      testEnv(),
    );
    const output = stripLogo(result.stdout || result.stderr);
    expect(output).toContain("Detected:");
    expect(output).toContain("my-agent --flag");
  });

  it("success output contains next steps", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("Ralphai initialized");
    expect(output).toContain("ralphai run");
    expect(output).toContain("$ ralphai");
    expect(output).toContain("config.json");
    expect(output).toContain("hello-world.md");
  });

  it("init --yes works without package.json", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("Ralphai initialized");
    expect(output).toContain("ralphai run");
  });

  it("init --yes <target-dir> writes config for the target directory", () => {
    // Create a separate target directory
    const targetDir = join(
      tmpdir(),
      `ralphai-target-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(targetDir, { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });

    const env = testEnv();

    try {
      // Run CLI from ctx.dir but point at targetDir
      const result = runCli(["init", "--yes", targetDir], ctx.dir, env);
      const output = stripLogo(result.stdout || result.stderr);

      expect(output).toContain("Ralphai initialized");

      // Config should be in global state for targetDir
      const targetConfigPath = getConfigFilePath(targetDir, env);
      expect(existsSync(targetConfigPath)).toBe(true);
      // No .ralphai/ directory in either location
      expect(existsSync(join(targetDir, ".ralphai"))).toBe(false);
      expect(existsSync(join(ctx.dir, ".ralphai"))).toBe(false);
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  it("scaffolded show-config includes worktree status in --show-config output", () => {
    // Worktree display is now handled by the TS show-config module.
    // Verify the TS module exists and contains worktree formatting.
    const showConfigTs = readFileSync(
      join(__dirname, "show-config.ts"),
      "utf-8",
    );
    expect(showConfigTs).toContain("worktree");
    expect(showConfigTs).toContain("mainWorktree");
  });

  it("scaffolded config resolution warns on unknown config keys instead of erroring", () => {
    // Unknown config key warnings are now handled by the TS config module.
    // Verify the TS config module handles unknown keys with a warning.
    const configTs = readFileSync(join(__dirname, "config.ts"), "utf-8");
    expect(configTs).toContain("unknown config key");
  });

  // -------------------------------------------------------------------------
  // AGENTS.md tests
  // -------------------------------------------------------------------------

  it("init --yes creates AGENTS.md with Ralphai section", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const agentsMd = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("## Ralphai");
    expect(agentsMd).toContain("autonomous execution");
    // Should NOT reference .ralphai/pipeline/backlog/ or .ralphai/PLANNING.md
    expect(agentsMd).not.toContain(".ralphai/pipeline/backlog/");
    expect(agentsMd).not.toContain(".ralphai/PLANNING.md");
  });

  it("init --yes appends Ralphai section to existing AGENTS.md", () => {
    writeFileSync(
      join(ctx.dir, "AGENTS.md"),
      "# Existing Instructions\n\nSome content.\n",
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const agentsMd = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("# Existing Instructions");
    expect(agentsMd).toContain("## Ralphai");
  });

  it("init --yes does not duplicate Ralphai section in AGENTS.md", () => {
    writeFileSync(
      join(ctx.dir, "AGENTS.md"),
      "# Instructions\n\n## Ralphai\n\nExisting section.\n",
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const agentsMd = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    // Section should not be duplicated
    const matches = agentsMd.match(/## Ralphai/g);
    expect(matches).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // --force tests
  // -------------------------------------------------------------------------

  it("init --force --yes overwrites existing config", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // Write custom config
    writeConfigFile(
      ctx.dir,
      { agentCommand: "my-agent", baseBranch: "main" },
      testEnv(),
    );

    // Force re-init
    const result = runCli(["init", "--force", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("Ralphai initialized");

    // Config should have been overwritten with auto-detected defaults
    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    // Agent command is auto-detected, so just verify it's not the custom one
    expect(parsed.agentCommand).not.toBe("my-agent");
  });

  // -------------------------------------------------------------------------
  // Init idempotency tests
  // -------------------------------------------------------------------------

  it("init --yes errors when already configured", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    // Second init should fail
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("already configured");
  });

  it("init error message suggests init --force", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    expect(result.stderr).toContain("ralphai init --force");
  });
});
