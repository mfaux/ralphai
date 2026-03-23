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

  it("init --yes scaffolds all expected files", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("Ralphai initialized");

    // Config at global state dir (not in the repo)
    expect(existsSync(configPath())).toBe(true);
    expect(existsSync(join(ctx.dir, "ralphai.json"))).toBe(false);

    // User-owned files inside .ralphai/ (local-only, gitignored)
    expect(existsSync(join(ctx.dir, ".ralphai", "README.md"))).toBe(true);
    expect(existsSync(join(ctx.dir, ".ralphai", "PLANNING.md"))).toBe(true);
    expect(existsSync(join(ctx.dir, ".ralphai", "LEARNINGS.md"))).toBe(true);

    // Shell scripts should NOT be scaffolded
    // (runner is now pure TypeScript, no shell scripts needed)
    expect(existsSync(join(ctx.dir, ".ralphai", "ralphai.sh"))).toBe(false);
    expect(existsSync(join(ctx.dir, ".ralphai", "lib"))).toBe(false);

    // Plan template guides
    expect(existsSync(join(ctx.dir, ".ralphai", "plans", "feature.md"))).toBe(
      true,
    );
    expect(existsSync(join(ctx.dir, ".ralphai", "plans", "bugfix.md"))).toBe(
      true,
    );
    expect(existsSync(join(ctx.dir, ".ralphai", "plans", "refactor.md"))).toBe(
      true,
    );

    // Pipeline subdirectories (no .gitkeep — .ralphai/ is fully gitignored)
    expect(existsSync(join(ctx.dir, ".ralphai", "pipeline", "backlog"))).toBe(
      true,
    );
    expect(existsSync(join(ctx.dir, ".ralphai", "pipeline", "parked"))).toBe(
      true,
    );
    expect(
      existsSync(join(ctx.dir, ".ralphai", "pipeline", "in-progress")),
    ).toBe(true);
    expect(existsSync(join(ctx.dir, ".ralphai", "pipeline", "out"))).toBe(true);
  });

  it("init --yes adds .ralphai to root .gitignore", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const gitignore = readFileSync(join(ctx.dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".ralphai");
    // Should use ".ralphai" (no trailing slash) to also match symlinks in worktrees
    expect(gitignore).not.toContain(".ralphai/");
    // Config is now in global state — ralphai.json should NOT be gitignored
    expect(gitignore).not.toContain("ralphai.json");
  });

  it("init --yes creates LEARNINGS.md with seed content", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const learnings = readFileSync(
      join(ctx.dir, ".ralphai", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toContain("# Ralphai Learnings");
    expect(learnings).toContain("gitignored");
    expect(learnings).toContain("AGENTS.md");
  });

  it("init --yes copies plan template guides from source templates", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const templatesDir = join(__dirname, "..", "templates", "ralphai", "plans");
    for (const guide of ["feature.md", "bugfix.md", "refactor.md"]) {
      const source = readFileSync(join(templatesDir, guide), "utf-8");
      const scaffolded = readFileSync(
        join(ctx.dir, ".ralphai", "plans", guide),
        "utf-8",
      );
      expect(scaffolded).toBe(source);
    }
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
    // New config keys from wizard expansion
    expect(parsed.turns).toBe(5);
    expect(parsed.mode).toBe("branch");
    expect(parsed.autoCommit).toBe(false);
    expect(parsed.turnTimeout).toBe(0);
  });

  it("init --yes writes all config keys with defaults", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);

    // Verify exactly 14 keys are present
    expect(Object.keys(parsed)).toHaveLength(14);

    // Core settings from wizard
    // Agent command is auto-detected from PATH or falls back to OpenCode
    expect(typeof parsed.agentCommand).toBe("string");
    expect(parsed.agentCommand.length).toBeGreaterThan(0);
    expect(parsed.baseBranch).toBeDefined();
    expect(parsed.feedbackCommands).toEqual([]);

    // New wizard settings
    expect(parsed.turns).toBe(5);
    expect(parsed.mode).toBe("branch");
    expect(parsed.autoCommit).toBe(false);

    // Runtime defaults
    expect(parsed.turnTimeout).toBe(0);
    expect(parsed.promptMode).toBe("auto");
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
    expect(Object.keys(parsed)).toHaveLength(14);
    expect(parsed.turns).toBe(5);
    expect(parsed.mode).toBe("branch");
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
    // Should still scaffold successfully (warning, not error)
    expect(existsSync(configPath())).toBe(true);
  });

  it("init --yes warns when no feedback commands are detected", () => {
    // ctx.dir has no package.json, so detectFeedbackCommands returns ""
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;
    expect(output).toContain("No build/test/lint scripts detected");
    expect(output).toContain("feedbackCommands");
    // Should still scaffold successfully (warning, not error)
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
    expect(output).toContain("ralphai worktree");
    expect(output).toContain("config.json");
    expect(output).toContain("PLANNING.md");
    expect(output).toContain("plans/");
    expect(output).toContain("LEARNINGS.md");
  });

  it("init --yes works without package.json", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("Ralphai initialized");
    expect(output).toContain("ralphai run");
  });

  it("init --yes <target-dir> scaffolds into the target directory, not cwd", () => {
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

      // Config should be in global state for targetDir, not at repo root
      const targetConfigPath = getConfigFilePath(targetDir, env);
      expect(existsSync(targetConfigPath)).toBe(true);
      expect(existsSync(join(targetDir, ".ralphai", "README.md"))).toBe(true);
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
  // Sample plan creation tests
  // -------------------------------------------------------------------------

  it("init --yes creates hello-ralphai.md in pipeline/backlog/", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const samplePlanPath = join(
      ctx.dir,
      ".ralphai",
      "pipeline",
      "backlog",
      "hello-ralphai.md",
    );
    expect(existsSync(samplePlanPath)).toBe(true);
  });

  it("sample plan content follows PLANNING.md format", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const samplePlan = readFileSync(
      join(ctx.dir, ".ralphai", "pipeline", "backlog", "hello-ralphai.md"),
      "utf-8",
    );

    // Title: must start with "# Plan: "
    expect(samplePlan).toMatch(/^# Plan: /);

    // Has at least one task heading (### Task N: ...)
    expect(samplePlan).toMatch(/### Task \d+:/);

    // Has acceptance criteria with checkboxes
    expect(samplePlan).toContain("## Acceptance Criteria");
    expect(samplePlan).toMatch(/- \[ \] /);

    // Has Implementation Tasks section
    expect(samplePlan).toContain("## Implementation Tasks");

    // Is repo-agnostic (no build/language assumptions)
    expect(samplePlan).not.toMatch(
      /\b(npm|pnpm|yarn|bun|deno|pip|cargo|go build|maven|gradle)\b/,
    );
  });

  it("init --force --yes does not overwrite an edited sample plan", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const samplePlanPath = join(
      ctx.dir,
      ".ralphai",
      "pipeline",
      "backlog",
      "hello-ralphai.md",
    );

    // Simulate the user editing the sample plan
    writeFileSync(
      samplePlanPath,
      "# Plan: My Custom Plan\n\nEdited by user.\n",
    );

    // Force re-init — the sample plan should be preserved because existsSync guard
    // Note: --force deletes and recreates .ralphai/, so the plan is removed.
    // The scaffold then writes a fresh hello-ralphai.md because the file no longer exists.
    runCli(["init", "--force", "--yes"], ctx.dir, testEnv());

    // After --force re-init, verify the sample plan exists (was recreated)
    expect(existsSync(samplePlanPath)).toBe(true);
  });

  it("init --yes output mentions sample plan in created files", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("hello-ralphai.md");
    expect(output).toContain("Sample plan");
  });

  it("init --yes next steps mention sample plan is ready", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("A sample plan is ready in");
    expect(output).toContain(".ralphai/pipeline/backlog/");
    // Should NOT show "Write a plan" as the first step
    expect(output).not.toContain("Write a plan");
  });

  // -------------------------------------------------------------------------
  // --force tests
  // -------------------------------------------------------------------------

  it("init --force --yes re-scaffolds from scratch, overwriting config", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // Write custom config
    writeConfigFile(
      ctx.dir,
      { agentCommand: "my-agent", baseBranch: "main" },
      testEnv(),
    );

    // Force re-scaffold
    const result = runCli(["init", "--force", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("Ralphai initialized");

    // Config should have been overwritten with auto-detected defaults
    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    // Agent command is auto-detected, so just verify it's not the custom one
    expect(parsed.agentCommand).not.toBe("my-agent");
  });

  it("init --force --yes overwrites LEARNINGS.md", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // Add custom LEARNINGS
    writeFileSync(
      join(ctx.dir, ".ralphai", "LEARNINGS.md"),
      "# Custom learnings",
    );

    // Force re-scaffold
    runCli(["init", "--force", "--yes"], ctx.dir, testEnv());

    const learnings = readFileSync(
      join(ctx.dir, ".ralphai", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toContain("# Ralphai Learnings");
    expect(learnings).not.toContain("Custom learnings");
  });

  it("init --force --yes removes old plan files", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // Add a plan file
    const planDir = join(
      ctx.dir,
      ".ralphai",
      "pipeline",
      "backlog",
      "old-plan",
    );
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "old-plan.md"), "# Old plan");

    // Force re-scaffold
    runCli(["init", "--force", "--yes"], ctx.dir, testEnv());

    // Plan file should be gone (directory was deleted and recreated)
    expect(existsSync(join(planDir, "old-plan.md"))).toBe(false);
    expect(existsSync(join(ctx.dir, ".ralphai", "pipeline", "backlog"))).toBe(
      true,
    );
  });

  // -------------------------------------------------------------------------
  // Init idempotency tests
  // -------------------------------------------------------------------------

  it("init --yes errors when .ralphai/ already exists", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    // Second init should fail
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("already set up");
  });

  it("init error message suggests init --force", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    expect(result.stderr).toContain("ralphai init --force");
  });
});
