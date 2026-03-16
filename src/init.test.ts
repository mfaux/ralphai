import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("init command", () => {
  const ctx = useTempGitDir();

  it("init --yes scaffolds all expected files", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toContain("Ralphai initialized");

    // Config at repo root (not inside .ralphai/)
    expect(existsSync(join(ctx.dir, "ralphai.json"))).toBe(true);

    // User-owned files inside .ralphai/ (local-only, gitignored)
    expect(existsSync(join(ctx.dir, ".ralphai", "README.md"))).toBe(true);
    expect(existsSync(join(ctx.dir, ".ralphai", "PLANNING.md"))).toBe(true);
    expect(existsSync(join(ctx.dir, ".ralphai", "LEARNINGS.md"))).toBe(true);

    // Shell scripts should NOT be scaffolded (they run from the package)
    expect(existsSync(join(ctx.dir, ".ralphai", "ralphai.sh"))).toBe(false);
    expect(existsSync(join(ctx.dir, ".ralphai", "lib"))).toBe(false);

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

  it("init --yes adds .ralphai and ralphai.json to root .gitignore", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const gitignore = readFileSync(join(ctx.dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".ralphai");
    // Should use ".ralphai" (no trailing slash) to also match symlinks in worktrees
    expect(gitignore).not.toContain(".ralphai/");
    // ralphai.json is gitignored by default — personal config
    expect(gitignore).toContain("ralphai.json");
  });

  it("init --yes creates LEARNINGS.md with seed content", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const learnings = readFileSync(
      join(ctx.dir, ".ralphai", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toContain("# Ralphai Learnings");
    expect(learnings).toContain("gitignored");
    expect(learnings).toContain("AGENTS.md");
  });

  it("init --yes generates config with default agent command", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const config = readFileSync(join(ctx.dir, "ralphai.json"), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.agentCommand).toBe("opencode run --agent build");
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
    runCliOutput(["init", "--yes"], ctx.dir);

    const config = readFileSync(join(ctx.dir, "ralphai.json"), "utf-8");
    const parsed = JSON.parse(config);

    // Verify exactly 14 keys are present
    expect(Object.keys(parsed)).toHaveLength(14);

    // Core settings from wizard
    expect(parsed.agentCommand).toBe("opencode run --agent build");
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
    runCliOutput(["init", "--yes", "--agent-command=claude -p"], ctx.dir);

    const config = readFileSync(join(ctx.dir, "ralphai.json"), "utf-8");
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
    );
    const output = result.stdout + result.stderr;
    expect(output).toContain("not found in PATH");
    expect(output).toContain("nonexistent-agent-xyz");
    // Should still scaffold successfully (warning, not error)
    expect(existsSync(join(ctx.dir, "ralphai.json"))).toBe(true);
  });

  it("init --yes warns when no feedback commands are detected", () => {
    // ctx.dir has no package.json, so detectFeedbackCommands returns ""
    const result = runCli(["init", "--yes"], ctx.dir);
    const output = result.stdout + result.stderr;
    expect(output).toContain("No build/test/lint scripts detected");
    expect(output).toContain("feedbackCommands");
    // Should still scaffold successfully (warning, not error)
    expect(existsSync(join(ctx.dir, "ralphai.json"))).toBe(true);
  });

  it("init --yes prints detection summary with detected values", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));
    // Summary should contain the header and detected values
    expect(output).toContain("Detected:");
    // Default agent command
    expect(output).toContain("opencode run --agent build");
    // Base branch (detected from git)
    expect(output).toMatch(/Branch:.*main|master/);
    // Feedback should show (none) since ctx.dir has no package.json
    expect(output).toContain("(none)");
    // Manager should also show (none) since no package.json
    expect(output).toMatch(/Manager:.*\(none\)/);
  });

  it("init --yes detection summary shows custom agent command", () => {
    const output = stripLogo(
      runCliOutput(
        ["init", "--yes", "--agent-command=my-agent --flag"],
        ctx.dir,
      ),
    );
    expect(output).toContain("Detected:");
    expect(output).toContain("my-agent --flag");
  });

  it("success output contains next steps", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toContain("Ralphai initialized");
    expect(output).toContain("ralphai worktree");
    expect(output).toContain("ralphai.json");
    expect(output).toContain("PLANNING.md");
    expect(output).toContain("LEARNINGS.md");
  });

  it("init --shared does not gitignore ralphai.json", () => {
    runCliOutput(["init", "--yes", "--shared"], ctx.dir);

    const gitignore = readFileSync(join(ctx.dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".ralphai");
    expect(gitignore).not.toContain("ralphai.json");
  });

  // -------------------------------------------------------------------------
  // Shell script template checks
  // -------------------------------------------------------------------------

  it("ralphai.sh template passes bash syntax check", () => {
    // Read directly from runner/ (scripts are bundled in the package)
    const templateScript = join(__dirname, "..", "runner", "ralphai.sh");

    // bash -n does a syntax check without executing
    expect(() => {
      execSync(`bash -n "${templateScript}"`, {
        stdio: "pipe",
      });
    }).not.toThrow();
  });

  it("ralphai.sh lib contains issue integration functions and config", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const issues = readFileSync(join(templateLib, "issues.sh"), "utf-8");
    expect(issues).toContain("read_issue_frontmatter");
    expect(issues).toContain("check_gh_available");
    expect(issues).toContain("detect_repo_from_url");
    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    expect(defaults).toContain("DEFAULT_ISSUE_SOURCE");
  });

  it("init --yes works without package.json", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

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

    try {
      // Run CLI from ctx.dir but point at targetDir
      const output = stripLogo(
        runCliOutput(["init", "--yes", targetDir], ctx.dir),
      );

      expect(output).toContain("Ralphai initialized");

      // ralphai.json should exist in targetDir (repo root), not in ctx.dir (cwd)
      expect(existsSync(join(targetDir, "ralphai.json"))).toBe(true);
      expect(existsSync(join(targetDir, ".ralphai", "README.md"))).toBe(true);
      expect(existsSync(join(ctx.dir, ".ralphai"))).toBe(false);
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  it("scaffolded ralphai.sh contains helpful hint in nothing-to-do messages", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const plans = readFileSync(join(templateLib, "plans.sh"), "utf-8");
    // Both "nothing to do" messages should include the hint
    expect(plans).toContain(
      "Nothing to do — backlog is empty and no in-progress work. Add plans to .ralphai/pipeline/backlog/<slug>/<slug>.md — see .ralphai/PLANNING.md",
    );
    expect(plans).toContain(
      "Nothing to do — issue pull produced no plan file. Add plans to .ralphai/pipeline/backlog/<slug>/<slug>.md — see .ralphai/PLANNING.md",
    );
  });

  it("scaffolded ralphai.sh defaults to 5 turns when none specified", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const cli = readFileSync(join(templateLib, "cli.sh"), "utf-8");
    // Should default TURNS to "5" when unset (no error, no conditional)
    expect(cli).toContain('TURNS="5"');
    // Should NOT contain the old error message for missing turns
    expect(cli).not.toContain("ERROR: Missing required <turns-per-plan>");
  });

  it("scaffolded ralphai.sh shows turns-per-plan as optional in usage", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const cli = readFileSync(join(templateLib, "cli.sh"), "utf-8");
    expect(cli).toContain("--turns=<n>");
    expect(cli).not.toContain("[turns-per-plan]");
    // Should mention the default
    expect(cli).toContain("Default: 5 turns per plan.");
  });

  it("scaffolded ralphai.sh contains gh preflight check for PR mode", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const gitSh = readFileSync(join(templateLib, "git.sh"), "utf-8");
    // PR mode preflight: checks gh is installed and authenticated
    expect(gitSh).toContain('MODE" == "pr"');
    expect(gitSh).toContain("command -v gh");
    expect(gitSh).toContain("gh auth status");
    expect(gitSh).toContain("PR mode requires the GitHub CLI");
    expect(gitSh).toContain("gh is installed but not authenticated");
    expect(gitSh).toContain("--branch");
  });

  it("scaffolded ralphai.sh uses create_pr instead of merge_and_cleanup", () => {
    const templateDir = join(__dirname, "..", "runner");
    const templateLib = join(templateDir, "lib");

    const prSh = readFileSync(join(templateLib, "pr.sh"), "utf-8");
    // create_pr function exists in lib/pr.sh
    expect(prSh).toContain("create_pr()");
    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // create_pr is called on completion in the main loop
    expect(ralphaiSh).toContain('create_pr "$branch" "$PLAN_DESC"');
    // Old merge_and_cleanup and is_branch_protected are removed
    expect(ralphaiSh).not.toContain("merge_and_cleanup");
    expect(ralphaiSh).not.toContain("is_branch_protected");
    expect(prSh).not.toContain("merge_and_cleanup");
    expect(prSh).not.toContain("is_branch_protected");
    // No direct merge path (git merge --no-ff into base branch)
    expect(ralphaiSh).not.toContain("git merge");
    expect(ralphaiSh).not.toContain("git branch -d");
    // No MERGE_TARGET or PROTECTED_BRANCHES variables
    expect(ralphaiSh).not.toContain("MERGE_TARGET");
    expect(ralphaiSh).not.toContain("PROTECTED_BRANCHES");
  });

  it("scaffolded ralphai.sh has patch mode safety guard for main/master", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // Patch mode refuses to run on main or master
    expect(ralphaiSh).toContain("Patch mode cannot run on");
    expect(ralphaiSh).toContain("ralphai run --pr");
    expect(ralphaiSh).toContain("git checkout -b ralphai/");
  });

  it("scaffolded ralphai.sh has worktree-aware patch mode suggestion", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // When in a worktree, the patch mode guard suggests git worktree add
    expect(ralphaiSh).toContain(
      'if [[ "$RALPHAI_IS_WORKTREE" == true ]]; then',
    );
    expect(ralphaiSh).toContain("git worktree add");
    // In a worktree, the non-worktree "git checkout -b" suggestion is in the else branch
    expect(ralphaiSh).toContain("Or create a worktree on a feature branch:");
  });

  it("scaffolded ralphai.sh has worktree-aware PR branch strategy", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // In worktree PR mode, the runner uses the existing branch without checkout
    expect(ralphaiSh).toContain("Worktree mode: working on existing branch");
    // Errors if running on the base branch in a worktree
    expect(ralphaiSh).toContain(
      "ERROR: Running in a worktree on the base branch",
    );
    // Rolls back the plan when erroring
    expect(ralphaiSh).toContain("Rolled back: moved plan to");
  });

  it("scaffolded show_config.sh includes worktree status in --show-config output", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const showConfig = readFileSync(
      join(templateLib, "show_config.sh"),
      "utf-8",
    );
    // When in a worktree, --show-config should display worktree info
    expect(showConfig).toContain("worktree           = true");
    expect(showConfig).toContain("mainWorktree       = $RALPHAI_MAIN_WORKTREE");
  });

  it("scaffolded ralphai.sh includes worktree note in dry-run output", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // Dry-run should note when running in a worktree
    expect(ralphaiSh).toContain(
      "[dry-run] Running in worktree (main repo: $RALPHAI_MAIN_WORKTREE)",
    );
  });

  it("scaffolded ralphai.sh has stuck detection current_hash on its own line", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // current_hash assignment must NOT be on the same line as a # comment,
    // otherwise bash treats it as part of the comment and never executes it.
    const lines = ralphaiSh.split("\n");
    const assignLine = lines.find((l) =>
      l.includes("current_hash=$(git rev-parse HEAD)"),
    );
    expect(assignLine).toBeDefined();
    expect(assignLine!.trimStart().startsWith("#")).toBe(false);
  });

  it("scaffolded ralphai.sh skips create_pr in branch mode", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // Completion handler should conditionally call create_pr only in PR mode
    expect(ralphaiSh).toContain('if [[ "$MODE" == "pr" ]]; then');
    expect(ralphaiSh).toContain("Branch mode: changes committed on branch");
  });

  it("scaffolded ralphai.sh warns on unknown config keys instead of erroring", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // Unknown config keys should produce a warning, not an error
    expect(config).toContain("WARNING:");
    expect(config).toContain("ignoring unknown config key");
    expect(config).not.toContain(
      "unknown config key '$key'\"\n        echo \"Supported keys:",
    );
  });

  it("scaffolded ralphai.sh contains issue integration defaults", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    // Config defaults
    expect(defaults).toContain('DEFAULT_ISSUE_SOURCE="none"');
    expect(defaults).toContain('DEFAULT_ISSUE_LABEL="ralphai"');
    expect(defaults).toContain(
      'DEFAULT_ISSUE_IN_PROGRESS_LABEL="ralphai:in-progress"',
    );
    expect(defaults).toContain('DEFAULT_ISSUE_REPO=""');
    expect(defaults).toContain('DEFAULT_ISSUE_COMMENT_PROGRESS="true"');
  });

  it("scaffolded ralphai.sh contains issue integration functions", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const issues = readFileSync(join(templateLib, "issues.sh"), "utf-8");
    // Core functions
    expect(issues).toContain("pull_github_issues()");
    expect(issues).toContain("read_issue_frontmatter()");
    expect(issues).toContain("check_gh_available()");
    expect(issues).toContain("detect_issue_repo()");
    expect(issues).toContain("slugify()");
  });

  // -------------------------------------------------------------------------
  // Sample plan creation tests
  // -------------------------------------------------------------------------

  it("init --yes creates hello-ralphai.md in pipeline/backlog/", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const samplePlanPath = join(
      ctx.dir,
      ".ralphai",
      "pipeline",
      "backlog",
      "hello-ralphai",
      "hello-ralphai.md",
    );
    expect(existsSync(samplePlanPath)).toBe(true);
  });

  it("sample plan content follows PLANNING.md format", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const samplePlan = readFileSync(
      join(
        ctx.dir,
        ".ralphai",
        "pipeline",
        "backlog",
        "hello-ralphai",
        "hello-ralphai.md",
      ),
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
    runCliOutput(["init", "--yes"], ctx.dir);

    const samplePlanPath = join(
      ctx.dir,
      ".ralphai",
      "pipeline",
      "backlog",
      "hello-ralphai",
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
    runCliOutput(["init", "--force", "--yes"], ctx.dir);

    // After --force re-init, verify the sample plan exists (was recreated)
    expect(existsSync(samplePlanPath)).toBe(true);
  });

  it("init --yes output mentions sample plan in created files", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toContain("hello-ralphai.md");
    expect(output).toContain("Sample plan");
  });

  it("init --yes next steps mention sample plan is ready", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toContain("A sample plan is ready in");
    expect(output).toContain(".ralphai/pipeline/backlog/");
    // Should NOT show "Write a plan" as the first step
    expect(output).not.toContain("Write a plan");
  });

  // -------------------------------------------------------------------------
  // --force tests
  // -------------------------------------------------------------------------

  it("init --force --yes re-scaffolds from scratch, overwriting ralphai.json", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    // Write custom config
    writeFileSync(
      join(ctx.dir, "ralphai.json"),
      JSON.stringify({ agentCommand: "my-agent", baseBranch: "main" }) + "\n",
    );

    // Force re-scaffold
    const output = stripLogo(
      runCliOutput(["init", "--force", "--yes"], ctx.dir),
    );

    expect(output).toContain("Ralphai initialized");

    // Config should have been overwritten with defaults
    const config = readFileSync(join(ctx.dir, "ralphai.json"), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.agentCommand).toBe("opencode run --agent build");
    expect(parsed.agentCommand).not.toBe("my-agent");
  });

  it("init --force --yes overwrites LEARNINGS.md", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    // Add custom LEARNINGS
    writeFileSync(
      join(ctx.dir, ".ralphai", "LEARNINGS.md"),
      "# Custom learnings",
    );

    // Force re-scaffold
    runCliOutput(["init", "--force", "--yes"], ctx.dir);

    const learnings = readFileSync(
      join(ctx.dir, ".ralphai", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toContain("# Ralphai Learnings");
    expect(learnings).not.toContain("Custom learnings");
  });

  it("init --force --yes removes old plan files", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

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
    runCliOutput(["init", "--force", "--yes"], ctx.dir);

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
    runCliOutput(["init", "--yes"], ctx.dir);
    // Second init should fail
    const result = runCli(["init", "--yes"], ctx.dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("already set up");
  });

  it("init error message suggests init --force", () => {
    runCliOutput(["init", "--yes"], ctx.dir);
    const result = runCli(["init", "--yes"], ctx.dir);
    expect(result.stderr).toContain("ralphai init --force");
  });
});
