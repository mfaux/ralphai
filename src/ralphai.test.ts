import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
  readdirSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { runCli, runCliOutput, stripLogo } from "./test-utils.ts";
import {
  detectInstallerPM,
  buildUpdateCommand,
  checkForUpdate,
} from "./self-update.ts";
import { compareVersions } from "./utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ralphai command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ralphai-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    // Initialize a git repo so detectBaseBranch() works
    execSync("git init", { cwd: testDir, stdio: "ignore" });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("init --yes scaffolds all expected files", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    expect(output).toContain("Ralphai initialized");

    // Config at repo root (not inside .ralphai/)
    expect(existsSync(join(testDir, "ralphai.json"))).toBe(true);

    // User-owned files inside .ralphai/ (local-only, gitignored)
    expect(existsSync(join(testDir, ".ralphai", "README.md"))).toBe(true);
    expect(existsSync(join(testDir, ".ralphai", "PLANNING.md"))).toBe(true);
    expect(existsSync(join(testDir, ".ralphai", "LEARNINGS.md"))).toBe(true);

    // Shell scripts should NOT be scaffolded (they run from the package)
    expect(existsSync(join(testDir, ".ralphai", "ralphai.sh"))).toBe(false);
    expect(existsSync(join(testDir, ".ralphai", "lib"))).toBe(false);

    // Pipeline subdirectories (no .gitkeep — .ralphai/ is fully gitignored)
    expect(existsSync(join(testDir, ".ralphai", "pipeline", "backlog"))).toBe(
      true,
    );
    expect(existsSync(join(testDir, ".ralphai", "pipeline", "wip"))).toBe(true);
    expect(
      existsSync(join(testDir, ".ralphai", "pipeline", "in-progress")),
    ).toBe(true);
    expect(existsSync(join(testDir, ".ralphai", "pipeline", "out"))).toBe(true);
  });

  it("init --yes adds .ralphai to root .gitignore", () => {
    runCliOutput(["init", "--yes"], testDir);

    const gitignore = readFileSync(join(testDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".ralphai");
    // Should use ".ralphai" (no trailing slash) to also match symlinks in worktrees
    expect(gitignore).not.toContain(".ralphai/");
  });

  it("init --yes creates LEARNINGS.md with seed content", () => {
    runCliOutput(["init", "--yes"], testDir);

    const learnings = readFileSync(
      join(testDir, ".ralphai", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toContain("# Ralphai Learnings");
    expect(learnings).toContain("gitignored");
    expect(learnings).toContain("AGENTS.md");
  });

  it("init --yes generates config with default agent command", () => {
    runCliOutput(["init", "--yes"], testDir);

    const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
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
    expect(parsed.maxStuck).toBe(3);
    expect(parsed.turnTimeout).toBe(0);
  });

  it("init --yes writes all config keys with defaults", () => {
    runCliOutput(["init", "--yes"], testDir);

    const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
    const parsed = JSON.parse(config);

    // Verify exactly 17 keys are present
    expect(Object.keys(parsed)).toHaveLength(17);

    // Core settings from wizard
    expect(parsed.agentCommand).toBe("opencode run --agent build");
    expect(parsed.baseBranch).toBeDefined();
    expect(parsed.feedbackCommands).toEqual([]);

    // New wizard settings
    expect(parsed.turns).toBe(5);
    expect(parsed.mode).toBe("branch");
    expect(parsed.autoCommit).toBe(false);
    expect(parsed.maxStuck).toBe(3);

    // Runtime defaults
    expect(parsed.turnTimeout).toBe(0);
    expect(parsed.promptMode).toBe("auto");
    expect(parsed.continuous).toBe(false);
    expect(parsed.fallbackAgents).toBe("");

    // Issue tracking defaults
    expect(parsed.issueSource).toBe("none");
    expect(parsed.issueLabel).toBe("ralphai");
    expect(parsed.issueInProgressLabel).toBe("ralphai:in-progress");
    expect(parsed.issueRepo).toBe("");
    expect(parsed.issueCloseOnComplete).toBe(true);
    expect(parsed.issueCommentProgress).toBe(true);
  });

  it("init --yes --agent-command uses the provided agent command", () => {
    runCliOutput(["init", "--yes", "--agent-command=claude -p"], testDir);

    const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.agentCommand).toBe("claude -p");
    // Other keys should still get defaults
    expect(Object.keys(parsed)).toHaveLength(17);
    expect(parsed.turns).toBe(5);
    expect(parsed.mode).toBe("branch");
    expect(parsed.autoCommit).toBe(false);
    expect(parsed.maxStuck).toBe(3);
  });

  it("success output contains next steps", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    expect(output).toContain("Ralphai initialized");
    expect(output).toContain("dry-run");
    expect(output).toContain("ralphai.json");
    expect(output).toContain("PLANNING.md");
    expect(output).toContain("LEARNINGS.md");
  });

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
    expect(defaults).toContain("DEFAULT_ISSUE_CLOSE_ON_COMPLETE");
  });

  it("init --yes works without package.json", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    expect(output).toContain("Ralphai initialized");
    expect(output).toContain("ralphai run --dry-run");
  });

  it("init --yes <target-dir> scaffolds into the target directory, not cwd", () => {
    // Create a separate target directory
    const targetDir = join(tmpdir(), `ralphai-target-${Date.now()}`);
    mkdirSync(targetDir, { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });

    try {
      // Run CLI from testDir but point at targetDir
      const output = stripLogo(
        runCliOutput(["init", "--yes", targetDir], testDir),
      );

      expect(output).toContain("Ralphai initialized");

      // ralphai.json should exist in targetDir (repo root), not in testDir (cwd)
      expect(existsSync(join(targetDir, "ralphai.json"))).toBe(true);
      expect(existsSync(join(targetDir, ".ralphai", "README.md"))).toBe(true);
      expect(existsSync(join(testDir, ".ralphai"))).toBe(false);
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
      "Nothing to do — backlog is empty and no in-progress work. Add plans to .ralphai/pipeline/backlog/ — see .ralphai/PLANNING.md",
    );
    expect(plans).toContain(
      "Nothing to do — issue pull produced no plan file. Add plans to .ralphai/pipeline/backlog/ — see .ralphai/PLANNING.md",
    );
  });

  it("scaffolded ralphai.sh defaults to 5 turns when none specified", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // Should default TURNS to "5" when unset (no error, no conditional)
    expect(config).toContain('TURNS="5"');
    // Should NOT contain the old error message for missing turns
    expect(config).not.toContain("ERROR: Missing required <turns-per-plan>");
  });

  it("scaffolded ralphai.sh shows turns-per-plan as optional in usage", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    expect(config).toContain("--turns=<n>");
    expect(config).not.toContain("[turns-per-plan]");
    // Should mention the default
    expect(config).toContain("Default: 5 turns per plan.");
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
    expect(gitSh).toContain("--direct");
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

  it("scaffolded ralphai.sh has direct mode safety guard for main/master", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // Direct mode refuses to run on main or master
    expect(ralphaiSh).toContain("Direct mode cannot run on");
    expect(ralphaiSh).toContain("ralphai run --pr");
    expect(ralphaiSh).toContain("git checkout -b ralphai/");
  });

  it("scaffolded ralphai.sh has worktree-aware direct mode suggestion", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // When in a worktree, the direct mode guard suggests git worktree add
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

  it("scaffolded config.sh includes worktree status in --show-config output", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // When in a worktree, --show-config should display worktree info
    expect(config).toContain("worktree           = true");
    expect(config).toContain("mainWorktree       = $RALPHAI_MAIN_WORKTREE");
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

  it("scaffolded ralphai.sh skips create_pr in direct mode", () => {
    const templateDir = join(__dirname, "..", "runner");

    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // Completion handler should conditionally call create_pr only in PR mode
    expect(ralphaiSh).toContain('if [[ "$MODE" == "pr" ]]; then');
    expect(ralphaiSh).toContain("Direct mode: commits are on branch");
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
    expect(defaults).toContain('DEFAULT_ISSUE_CLOSE_ON_COMPLETE="true"');
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
  // Uninstall tests
  // -------------------------------------------------------------------------

  it("uninstall --yes removes .ralphai/ dir", () => {
    // First, set up ralphai
    runCliOutput(["init", "--yes"], testDir);
    expect(existsSync(join(testDir, ".ralphai"))).toBe(true);

    // Now uninstall
    const output = stripLogo(runCliOutput(["uninstall", "--yes"], testDir));

    expect(output).toContain("Ralphai uninstalled");
    expect(existsSync(join(testDir, ".ralphai"))).toBe(false);
  });

  it("uninstall --yes prints not set up when .ralphai/ does not exist", () => {
    const output = stripLogo(runCliOutput(["uninstall", "--yes"], testDir));

    expect(output).toContain("not set up");
    expect(output).toContain(".ralphai/ does not exist");
  });

  it("uninstall --yes <target-dir> uninstalls from target directory", () => {
    const targetDir = join(tmpdir(), `ralphai-uninstall-target-${Date.now()}`);
    mkdirSync(targetDir, { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });

    try {
      // Set up ralphai in target
      runCliOutput(["init", "--yes", targetDir], testDir);
      expect(existsSync(join(targetDir, ".ralphai"))).toBe(true);

      // Uninstall from target
      const output = stripLogo(
        runCliOutput(["uninstall", "--yes", targetDir], testDir),
      );

      expect(output).toContain("Ralphai uninstalled");
      expect(existsSync(join(targetDir, ".ralphai"))).toBe(false);
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  // -------------------------------------------------------------------------
  // Reset tests
  // -------------------------------------------------------------------------

  it("reset --yes moves in-progress plans back to backlog", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Simulate an in-progress plan
    const inProgressDir = join(testDir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-my-feature.md"), "# My Feature");

    const output = stripLogo(runCliOutput(["reset", "--yes"], testDir));

    expect(output).toContain("Pipeline reset");
    // Plan should be back in backlog
    expect(
      existsSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-my-feature.md"),
      ),
    ).toBe(true);
    // Plan should NOT be in in-progress
    expect(existsSync(join(inProgressDir, "prd-my-feature.md"))).toBe(false);
  });

  it("reset --yes deletes progress files", () => {
    runCliOutput(["init", "--yes"], testDir);

    const inProgressDir = join(testDir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-test.md"), "# Test");
    writeFileSync(
      join(inProgressDir, "progress-test.md"),
      "## Progress Log\n### Task 1:\n**Status:** Complete",
    );

    runCliOutput(["reset", "--yes"], testDir);

    expect(existsSync(join(inProgressDir, "progress-test.md"))).toBe(false);
  });

  it("reset --yes deletes receipt files", () => {
    runCliOutput(["init", "--yes"], testDir);

    const inProgressDir = join(testDir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-test.md"), "# Test");
    writeFileSync(
      join(inProgressDir, "receipt-test.txt"),
      "started_at=2025-01-15T10:30:00Z\nsource=main\nbranch=ralphai/test\nslug=test\nagent=claude -p\nturns_completed=3",
    );

    runCliOutput(["reset", "--yes"], testDir);

    expect(existsSync(join(inProgressDir, "receipt-test.txt"))).toBe(false);
  });

  it("reset --yes handles multiple plans, progress, and receipts", () => {
    runCliOutput(["init", "--yes"], testDir);

    const inProgressDir = join(testDir, ".ralphai", "pipeline", "in-progress");
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

    const output = stripLogo(runCliOutput(["reset", "--yes"], testDir));

    expect(output).toContain("2 plans moved to backlog");
    expect(output).toContain("Deleted 1 progress file");
    expect(output).toContain("Deleted 2 receipts");

    // Both plans should be in backlog
    expect(
      existsSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-feature-a.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-feature-b.md"),
      ),
    ).toBe(true);

    // in-progress should be clean (empty)
    const remaining = readdirSync(inProgressDir);
    expect(remaining).toEqual([]);
  });

  it("reset --yes reports nothing to reset when pipeline is clean", () => {
    runCliOutput(["init", "--yes"], testDir);

    const output = stripLogo(runCliOutput(["reset", "--yes"], testDir));

    expect(output).toContain("Nothing to reset");
  });

  it("reset errors when .ralphai/ does not exist", () => {
    const result = runCli(["reset", "--yes"], testDir);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  it("reset preserves in-progress directory", () => {
    runCliOutput(["init", "--yes"], testDir);

    const inProgressDir = join(testDir, ".ralphai", "pipeline", "in-progress");
    writeFileSync(join(inProgressDir, "prd-test.md"), "# Test");

    runCliOutput(["reset", "--yes"], testDir);

    // Directory should still exist
    expect(existsSync(inProgressDir)).toBe(true);
  });

  it("reset --yes force-removes dirty worktrees and deletes unmerged branches", () => {
    // Set up git identity for commits
    execSync(
      'git config user.email "test@test.com" && git config user.name "Test"',
      { cwd: testDir, stdio: "ignore" },
    );
    // Create initial commit
    execSync("git commit --allow-empty -m 'init'", {
      cwd: testDir,
      stdio: "ignore",
    });

    runCliOutput(["init", "--yes"], testDir);

    // Create a worktree on a ralphai/* branch
    const wtPath = join(testDir, "wt-dirty");
    execSync(`git worktree add "${wtPath}" -b ralphai/dirty-test HEAD`, {
      cwd: testDir,
      stdio: "ignore",
    });

    // Make the worktree dirty (uncommitted changes)
    writeFileSync(join(wtPath, "dirty-file.txt"), "dirty");
    execSync("git add dirty-file.txt", { cwd: wtPath, stdio: "ignore" });

    // Reset should force-remove the dirty worktree
    const output = runCliOutput(["reset", "--yes"], testDir);
    expect(output).toContain("Pipeline reset");
    expect(existsSync(wtPath)).toBe(false);

    // Branch should be force-deleted even though it's not merged
    const branchCheck = execSync("git branch --list ralphai/dirty-test", {
      cwd: testDir,
      encoding: "utf-8",
    }).trim();
    expect(branchCheck).toBe("");
  });

  // -------------------------------------------------------------------------
  // --force tests
  // -------------------------------------------------------------------------

  it("init --force --yes re-scaffolds from scratch, overwriting ralphai.json", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Write custom config
    writeFileSync(
      join(testDir, "ralphai.json"),
      JSON.stringify({ agentCommand: "my-agent", baseBranch: "main" }) + "\n",
    );

    // Force re-scaffold
    const output = stripLogo(
      runCliOutput(["init", "--force", "--yes"], testDir),
    );

    expect(output).toContain("Ralphai initialized");

    // Config should have been overwritten with defaults
    const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.agentCommand).toBe("opencode run --agent build");
    expect(parsed.agentCommand).not.toBe("my-agent");
  });

  it("init --force --yes overwrites LEARNINGS.md", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Add custom LEARNINGS
    writeFileSync(
      join(testDir, ".ralphai", "LEARNINGS.md"),
      "# Custom learnings",
    );

    // Force re-scaffold
    runCliOutput(["init", "--force", "--yes"], testDir);

    const learnings = readFileSync(
      join(testDir, ".ralphai", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toContain("# Ralphai Learnings");
    expect(learnings).not.toContain("Custom learnings");
  });

  it("init --force --yes removes old plan files", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Add a plan file
    writeFileSync(
      join(testDir, ".ralphai", "pipeline", "backlog", "old-plan.md"),
      "# Old plan",
    );

    // Force re-scaffold
    runCliOutput(["init", "--force", "--yes"], testDir);

    // Plan file should be gone (directory was deleted and recreated)
    expect(
      existsSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "old-plan.md"),
      ),
    ).toBe(false);
    expect(existsSync(join(testDir, ".ralphai", "pipeline", "backlog"))).toBe(
      true,
    );
  });

  // -------------------------------------------------------------------------
  // Package manager detection tests
  // -------------------------------------------------------------------------

  describe("package manager detection", () => {
    it("detects pnpm from pnpm-lock.yaml and populates feedbackCommands", () => {
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          {
            name: "test",
            scripts: { build: "tsc", test: "vitest", lint: "eslint ." },
          },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([
        "pnpm build",
        "pnpm test",
        "pnpm lint",
      ]);
    });

    it("detects npm from package-lock.json and populates feedbackCommands", () => {
      writeFileSync(join(testDir, "package-lock.json"), "{}");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          { name: "test", scripts: { build: "tsc", test: "jest" } },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual(["npm run build", "npm test"]);
    });

    it("detects yarn from yarn.lock and populates feedbackCommands", () => {
      writeFileSync(join(testDir, "yarn.lock"), "");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          {
            name: "test",
            scripts: { build: "tsc", test: "jest", lint: "eslint ." },
          },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([
        "yarn build",
        "yarn test",
        "yarn lint",
      ]);
    });

    it("detects bun from bun.lockb and populates feedbackCommands", () => {
      writeFileSync(join(testDir, "bun.lockb"), "");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          {
            name: "test",
            scripts: { build: "tsc", test: "bun test", lint: "eslint" },
          },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([
        "bun run build",
        "bun test",
        "bun run lint",
      ]);
    });

    it("detects deno from deno.json and reads tasks", () => {
      writeFileSync(
        join(testDir, "deno.json"),
        JSON.stringify(
          { tasks: { build: "deno compile", lint: "deno lint" } },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      // No test task in deno.json, but deno has a built-in test runner
      expect(parsed.feedbackCommands).toEqual([
        "deno task build",
        "deno task lint",
        "deno test",
      ]);
    });

    it("detects PM from packageManager field when no lock file exists", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          {
            name: "test",
            packageManager: "pnpm@9.0.0",
            scripts: { build: "tsc", test: "vitest" },
          },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual(["pnpm build", "pnpm test"]);
    });

    it("only includes scripts that actually exist in package.json", () => {
      writeFileSync(join(testDir, "package-lock.json"), "{}");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "test", scripts: { test: "jest" } }, null, 2),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual(["npm test"]);
    });

    it("defaults feedbackCommands to empty array when no scripts exist", () => {
      // pnpm project with only "start" script → no feedback commands detected
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          { name: "test", scripts: { start: "node index.js" } },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([]);
    });

    it("defaults feedbackCommands to empty array for non-JS projects", () => {
      // No package.json, no deno.json — nothing to detect
      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([]);
    });

    it("defaults feedbackCommands to empty array when no matching scripts detected", () => {
      // pnpm project with no matching scripts → feedbackCommands is empty array
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          { name: "test", scripts: { start: "node index.js" } },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([]);
    });

    it("feedbackCommands is empty array for non-JS projects (no package.json)", () => {
      // No package.json, no deno.json — nothing to detect
      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([]);
    });

    it("feedbackCommands is empty array when no matching scripts detected", () => {
      // pnpm project with no matching scripts → feedbackCommands is empty array
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          { name: "test", scripts: { start: "node index.js" } },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([]);
    });

    it("detects type-check and format:check scripts", () => {
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          {
            name: "test",
            scripts: {
              build: "tsc",
              test: "vitest",
              "type-check": "tsc --noEmit",
              lint: "eslint .",
              "format:check": "prettier --check .",
            },
          },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      expect(parsed.feedbackCommands).toEqual([
        "pnpm build",
        "pnpm test",
        "pnpm type-check",
        "pnpm lint",
        "pnpm format:check",
      ]);
    });

    it("lock file takes priority over packageManager field", () => {
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          {
            name: "test",
            packageManager: "yarn@4.0.0",
            scripts: { build: "tsc", test: "vitest" },
          },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(join(testDir, "ralphai.json"), "utf-8");
      const parsed = JSON.parse(config);
      // pnpm should win because lock file beats packageManager field
      expect(parsed.feedbackCommands).toEqual(["pnpm build", "pnpm test"]);
    });
  });

  // -------------------------------------------------------------------------
  // Subcommand behavior tests
  // -------------------------------------------------------------------------

  it("(no subcommand) shows help text listing all subcommands", () => {
    const result = runCli([], testDir);
    const output = stripLogo(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(output).toContain("Commands:");
    expect(output).toContain("init");
    expect(output).toContain("run");
    expect(output).toContain("update");
    expect(output).toContain("uninstall");
    expect(output).toContain("reset");
  });

  it("init --yes errors when .ralphai/ already exists", () => {
    runCliOutput(["init", "--yes"], testDir);
    // Second init should fail
    const result = runCli(["init", "--yes"], testDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("already set up");
  });

  it("init error message suggests init --force", () => {
    runCliOutput(["init", "--yes"], testDir);
    const result = runCli(["init", "--yes"], testDir);
    expect(result.stderr).toContain("ralphai init --force");
  });

  it("run errors when .ralphai/ does not exist", () => {
    const result = runCli(["run"], testDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  // -------------------------------------------------------------------------
  // Worktree detection tests
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("worktree detection", () => {
    let mainRepo: string;
    let worktreeDir: string;

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
      const result = runCli(["init", "--yes"], worktreeDir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "Cannot initialize ralphai inside a git worktree",
      );
      expect(result.stderr).toContain("ralphai init");
      expect(result.stderr).toContain("main repository");
    });

    it("init --yes succeeds in the main repo (not a worktree)", () => {
      const output = stripLogo(runCliOutput(["init", "--yes"], mainRepo));
      expect(output).toContain("Ralphai initialized");
      expect(existsSync(join(mainRepo, "ralphai.json"))).toBe(true);
    });

    it("run resolves .ralphai/ from the main worktree when invoked inside a worktree", () => {
      // Initialize ralphai in the main repo (creates .ralphai/)
      runCliOutput(["init", "--yes"], mainRepo);

      // Create a stub runner script that just prints success
      const stubScript = join(mainRepo, "stub-runner.sh");
      writeFileSync(stubScript, '#!/bin/bash\necho "STUB_OK"\n');
      chmodSync(stubScript, 0o755);

      // Run from worktree — should find .ralphai/ in the main repo
      const result = runCli(["run"], worktreeDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("STUB_OK");
      expect(result.exitCode).toBe(0);
    });

    it("run shows 'not set up' when .ralphai/ is missing from both worktree and main repo", () => {
      // Do NOT init — .ralphai/ doesn't exist anywhere
      const result = runCli(["run"], worktreeDir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not set up");
      expect(result.stderr).toContain("ralphai init");
    });

    it("defaults.sh resolves pipeline paths to main worktree when sourced inside a worktree", () => {
      const defaultsPath = join(
        __dirname,
        "..",
        "runner",
        "lib",
        "defaults.sh",
      );
      // Source defaults.sh from the worktree directory and print resolved variables
      const script = `#!/bin/bash
set -e
source ${JSON.stringify(defaultsPath)}
echo "IS_WORKTREE=$RALPHAI_IS_WORKTREE"
echo "MAIN_WORKTREE=$RALPHAI_MAIN_WORKTREE"
echo "WIP_DIR=$WIP_DIR"
echo "BACKLOG_DIR=$BACKLOG_DIR"
echo "ARCHIVE_DIR=$ARCHIVE_DIR"
echo "CONFIG_FILE=$CONFIG_FILE"
echo "PROGRESS_FILE=$PROGRESS_FILE"
`;
      const scriptFile = join(
        tmpdir(),
        `ralphai-defaults-wt-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
      );
      try {
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
          cwd: worktreeDir,
        });
        expect(result).toContain("IS_WORKTREE=true");
        expect(result).toContain(`MAIN_WORKTREE=${mainRepo}`);
        expect(result).toContain(
          `WIP_DIR=${mainRepo}/.ralphai/pipeline/in-progress`,
        );
        expect(result).toContain(
          `BACKLOG_DIR=${mainRepo}/.ralphai/pipeline/backlog`,
        );
        expect(result).toContain(
          `ARCHIVE_DIR=${mainRepo}/.ralphai/pipeline/out`,
        );
        // Config is at repo root and checked out by git, so stays relative
        expect(result).toContain("CONFIG_FILE=ralphai.json");
        expect(result).toContain(
          `PROGRESS_FILE=${mainRepo}/.ralphai/pipeline/in-progress/progress.md`,
        );
      } finally {
        try {
          rmSync(scriptFile);
        } catch {
          /* ignore */
        }
      }
    });

    it("defaults.sh uses relative paths when .ralphai symlink exists in worktree", () => {
      // Create .ralphai/ directory in the main repo
      const ralphaiDir = join(mainRepo, ".ralphai");
      mkdirSync(join(ralphaiDir, "pipeline", "in-progress"), {
        recursive: true,
      });
      mkdirSync(join(ralphaiDir, "pipeline", "backlog"), { recursive: true });
      mkdirSync(join(ralphaiDir, "pipeline", "out"), { recursive: true });

      // Create symlink in the worktree pointing to main repo's .ralphai/
      symlinkSync(ralphaiDir, join(worktreeDir, ".ralphai"));

      const defaultsPath = join(
        __dirname,
        "..",
        "runner",
        "lib",
        "defaults.sh",
      );
      const script = `#!/bin/bash
set -e
source ${JSON.stringify(defaultsPath)}
echo "IS_WORKTREE=$RALPHAI_IS_WORKTREE"
echo "WIP_DIR=$WIP_DIR"
echo "BACKLOG_DIR=$BACKLOG_DIR"
echo "ARCHIVE_DIR=$ARCHIVE_DIR"
echo "CONFIG_FILE=$CONFIG_FILE"
echo "PROGRESS_FILE=$PROGRESS_FILE"
`;
      const scriptFile = join(
        tmpdir(),
        `ralphai-defaults-symlink-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
      );
      try {
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
          cwd: worktreeDir,
        });
        // Should detect worktree
        expect(result).toContain("IS_WORKTREE=true");
        // But paths should be RELATIVE (not absolute) thanks to the symlink
        expect(result).toContain("WIP_DIR=.ralphai/pipeline/in-progress");
        expect(result).toContain("BACKLOG_DIR=.ralphai/pipeline/backlog");
        expect(result).toContain("ARCHIVE_DIR=.ralphai/pipeline/out");
        expect(result).toContain("CONFIG_FILE=ralphai.json");
        expect(result).toContain(
          "PROGRESS_FILE=.ralphai/pipeline/in-progress/progress.md",
        );
      } finally {
        try {
          rmSync(scriptFile);
        } catch {
          /* ignore */
        }
      }
    });

    it("defaults.sh keeps relative paths when sourced in the main repo (not a worktree)", () => {
      const defaultsPath = join(
        __dirname,
        "..",
        "runner",
        "lib",
        "defaults.sh",
      );
      const script = `#!/bin/bash
set -e
source ${JSON.stringify(defaultsPath)}
echo "IS_WORKTREE=$RALPHAI_IS_WORKTREE"
echo "MAIN_WORKTREE=$RALPHAI_MAIN_WORKTREE"
echo "WIP_DIR=$WIP_DIR"
echo "BACKLOG_DIR=$BACKLOG_DIR"
echo "ARCHIVE_DIR=$ARCHIVE_DIR"
echo "CONFIG_FILE=$CONFIG_FILE"
echo "PROGRESS_FILE=$PROGRESS_FILE"
`;
      const scriptFile = join(
        tmpdir(),
        `ralphai-defaults-main-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
      );
      try {
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
          cwd: mainRepo,
        });
        expect(result).toContain("IS_WORKTREE=false");
        expect(result).toContain("MAIN_WORKTREE=");
        // Verify MAIN_WORKTREE is empty (not set)
        expect(result).toMatch(/MAIN_WORKTREE=\n/);
        // Paths should remain relative
        expect(result).toContain("WIP_DIR=.ralphai/pipeline/in-progress");
        expect(result).toContain("BACKLOG_DIR=.ralphai/pipeline/backlog");
        expect(result).toContain("ARCHIVE_DIR=.ralphai/pipeline/out");
        expect(result).toContain("CONFIG_FILE=ralphai.json");
        expect(result).toContain(
          "PROGRESS_FILE=.ralphai/pipeline/in-progress/progress.md",
        );
      } finally {
        try {
          rmSync(scriptFile);
        } catch {
          /* ignore */
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Agent type detection tests
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains detect_agent_type function", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const prompt = readFileSync(join(templateLib, "prompt.sh"), "utf-8");
    expect(prompt).toContain("detect_agent_type()");
    expect(prompt).toContain("DETECTED_AGENT_TYPE=");
  });

  describe.skipIf(process.platform === "win32")(
    "detect_agent_type mapping",
    () => {
      /** Helper: source ralphai.sh's detect_agent_type and return the result */
      function detectAgent(agentCommand: string): string {
        // Extract just the function and call it with a given AGENT_COMMAND
        const result = execSync(
          `bash -c 'AGENT_COMMAND=${JSON.stringify(agentCommand)}; detect_agent_type() { local cmd; cmd=$(echo "$AGENT_COMMAND" | tr "[:upper:]" "[:lower:]"); case "$cmd" in *claude*) DETECTED_AGENT_TYPE="claude" ;; *opencode*) DETECTED_AGENT_TYPE="opencode" ;; *codex*) DETECTED_AGENT_TYPE="codex" ;; *gemini*) DETECTED_AGENT_TYPE="gemini" ;; *aider*) DETECTED_AGENT_TYPE="aider" ;; *goose*) DETECTED_AGENT_TYPE="goose" ;; *kiro*) DETECTED_AGENT_TYPE="kiro" ;; *amp*) DETECTED_AGENT_TYPE="amp" ;; *) DETECTED_AGENT_TYPE="unknown" ;; esac; }; detect_agent_type; echo "$DETECTED_AGENT_TYPE"'`,
          { encoding: "utf-8" },
        ).trim();
        return result;
      }

      it("detects claude from command string", () => {
        expect(detectAgent("claude -p")).toBe("claude");
      });

      it("detects claude from wrapped command", () => {
        expect(detectAgent("npx claude -p")).toBe("claude");
      });

      it("detects opencode", () => {
        expect(detectAgent("opencode run --agent build")).toBe("opencode");
      });

      it("detects opencode from full path", () => {
        expect(detectAgent("/usr/local/bin/opencode run")).toBe("opencode");
      });

      it("detects codex", () => {
        expect(detectAgent("codex exec")).toBe("codex");
      });

      it("detects gemini", () => {
        expect(detectAgent("gemini")).toBe("gemini");
      });

      it("detects aider", () => {
        expect(detectAgent("aider --yes")).toBe("aider");
      });

      it("detects goose", () => {
        expect(detectAgent("goose run")).toBe("goose");
      });

      it("detects kiro", () => {
        expect(detectAgent("kiro")).toBe("kiro");
      });

      it("detects amp", () => {
        expect(detectAgent("amp run")).toBe("amp");
      });

      it("returns unknown for unrecognized commands", () => {
        expect(detectAgent("my-custom-agent")).toBe("unknown");
      });

      it("handles case-insensitive matching", () => {
        expect(detectAgent("Claude -p")).toBe("claude");
        expect(detectAgent("OPENCODE run")).toBe("opencode");
      });
    },
  );

  // -------------------------------------------------------------------------
  // Prompt formatting tests (format_file_ref + resolve_prompt_mode)
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains format_file_ref and resolve_prompt_mode functions", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const prompt = readFileSync(join(templateLib, "prompt.sh"), "utf-8");
    expect(prompt).toContain("format_file_ref()");
    expect(prompt).toContain("resolve_prompt_mode()");
    expect(prompt).toContain("RESOLVED_PROMPT_MODE=");
    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    expect(defaults).toContain('DEFAULT_PROMPT_MODE="auto"');
  });

  describe.skipIf(process.platform === "win32")(
    "format_file_ref and resolve_prompt_mode",
    () => {
      /**
       * Helper: run the resolve_prompt_mode + format_file_ref functions in bash
       * with a given PROMPT_MODE, DETECTED_AGENT_TYPE, and filepath.
       * Writes the script to a temp file to avoid newline escaping issues with bash -c.
       */
      function formatRef(opts: {
        promptMode: string;
        agentType: string;
        filepath: string;
        fileContent?: string;
      }): string {
        const setupFile =
          opts.fileContent !== undefined
            ? `printf '%s' ${JSON.stringify(opts.fileContent)} > ${JSON.stringify(opts.filepath)}`
            : "";
        const cleanupFile =
          opts.fileContent !== undefined
            ? `rm -f ${JSON.stringify(opts.filepath)}`
            : "";

        const script = `#!/bin/bash
PROMPT_MODE=${JSON.stringify(opts.promptMode)}
DETECTED_AGENT_TYPE=${JSON.stringify(opts.agentType)}
RESOLVED_PROMPT_MODE=""
resolve_prompt_mode() {
  if [[ "$PROMPT_MODE" == "at-path" || "$PROMPT_MODE" == "inline" ]]; then
    RESOLVED_PROMPT_MODE="$PROMPT_MODE"
    return
  fi
  case "$DETECTED_AGENT_TYPE" in
    claude|opencode) RESOLVED_PROMPT_MODE="at-path" ;;
    *)               RESOLVED_PROMPT_MODE="at-path" ;;
  esac
}
format_file_ref() {
  local filepath="$1"
  if [[ "$RESOLVED_PROMPT_MODE" == "inline" ]]; then
    if [[ -f "$filepath" ]]; then
      printf '<file path="%s">\\n%s\\n</file>' "$filepath" "$(cat "$filepath")"
    else
      printf '@%s' "$filepath"
    fi
  else
    printf '@%s' "$filepath"
  fi
}
resolve_prompt_mode
${setupFile}
format_file_ref ${JSON.stringify(opts.filepath)}
${cleanupFile}
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-test-script-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
        );
        try {
          writeFileSync(scriptFile, script);
          const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
            encoding: "utf-8",
          });
          return result;
        } finally {
          try {
            rmSync(scriptFile);
          } catch {
            /* ignore */
          }
        }
      }

      it("at-path mode returns @filepath", () => {
        const result = formatRef({
          promptMode: "at-path",
          agentType: "claude",
          filepath: "plan.md",
        });
        expect(result).toBe("@plan.md");
      });

      it("auto mode with claude agent returns @filepath", () => {
        const result = formatRef({
          promptMode: "auto",
          agentType: "claude",
          filepath: ".ralphai/pipeline/in-progress/prd-foo.md",
        });
        expect(result).toBe("@.ralphai/pipeline/in-progress/prd-foo.md");
      });

      it("auto mode with opencode agent returns @filepath", () => {
        const result = formatRef({
          promptMode: "auto",
          agentType: "opencode",
          filepath: "LEARNINGS.md",
        });
        expect(result).toBe("@LEARNINGS.md");
      });

      it("auto mode with unknown agent returns @filepath (conservative default)", () => {
        const result = formatRef({
          promptMode: "auto",
          agentType: "unknown",
          filepath: "plan.md",
        });
        expect(result).toBe("@plan.md");
      });

      it("inline mode embeds file contents with <file> wrapper", () => {
        const tmpFile = join(tmpdir(), `ralphai-fmt-test-${Date.now()}.md`);
        try {
          writeFileSync(tmpFile, "# Test Plan\nDo stuff.");
          const result = formatRef({
            promptMode: "inline",
            agentType: "claude",
            filepath: tmpFile,
          });
          expect(result).toContain(`<file path="${tmpFile}">`);
          expect(result).toContain("# Test Plan");
          expect(result).toContain("Do stuff.");
          expect(result).toContain("</file>");
        } finally {
          try {
            rmSync(tmpFile);
          } catch {
            /* ignore */
          }
        }
      });

      it("inline mode falls back to @filepath for non-existent files", () => {
        const result = formatRef({
          promptMode: "inline",
          agentType: "claude",
          filepath: "/tmp/ralphai-nonexistent-file-12345.md",
        });
        expect(result).toBe("@/tmp/ralphai-nonexistent-file-12345.md");
      });

      it("resolve_prompt_mode caches explicit at-path regardless of agent", () => {
        const result = formatRef({
          promptMode: "at-path",
          agentType: "aider",
          filepath: "foo.md",
        });
        expect(result).toBe("@foo.md");
      });

      it("resolve_prompt_mode caches explicit inline regardless of agent", () => {
        const tmpFile = join(tmpdir(), `ralphai-fmt-inline-${Date.now()}.md`);
        try {
          writeFileSync(tmpFile, "content here");
          const result = formatRef({
            promptMode: "inline",
            agentType: "opencode",
            filepath: tmpFile,
          });
          expect(result).toContain('<file path="');
          expect(result).toContain("content here");
        } finally {
          try {
            rmSync(tmpFile);
          } catch {
            /* ignore */
          }
        }
      });
    },
  );

  // -------------------------------------------------------------------------
  // promptMode config key tests (config file, env var, CLI flag)
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains promptMode config infrastructure", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // Config file loader reads promptMode from JSON
    expect(config).toContain('"promptMode"');
    expect(config).toContain("CONFIG_PROMPT_MODE=");
    // Env var override
    expect(config).toContain("RALPHAI_PROMPT_MODE");
    // CLI flag
    expect(config).toContain("--prompt-mode=");
    expect(config).toContain("CLI_PROMPT_MODE=");
  });

  describe.skipIf(process.platform === "win32")(
    "promptMode config precedence",
    () => {
      /**
       * Helper: create a minimal bash script that sources the config loading
       * functions from ralphai.sh and tests PROMPT_MODE resolution.
       * We inline the relevant functions to avoid needing a full git repo.
       */
      function resolvePromptMode(opts: {
        configValue?: string;
        envValue?: string;
        cliValue?: string;
      }): string {
        const configContent = opts.configValue
          ? `promptMode=${opts.configValue}`
          : "";
        const envExport = opts.envValue
          ? `export RALPHAI_PROMPT_MODE=${JSON.stringify(opts.envValue)}`
          : "";
        const cliFlag = opts.cliValue ? `--prompt-mode=${opts.cliValue}` : "";

        // Build a script that simulates the config loading pipeline
        const script = `#!/bin/bash
set -e

# Defaults
DEFAULT_PROMPT_MODE="auto"
PROMPT_MODE="$DEFAULT_PROMPT_MODE"
CLI_PROMPT_MODE=""

# Simulate load_config
CONFIG_PROMPT_MODE=""
config_content=${JSON.stringify(configContent)}
if [[ -n "$config_content" ]]; then
  key="\${config_content%%=*}"
  value="\${config_content#*=}"
  if [[ "$key" == "promptMode" ]]; then
    if [[ "$value" != "auto" && "$value" != "at-path" && "$value" != "inline" ]]; then
      echo "ERROR: 'promptMode' must be 'auto', 'at-path', or 'inline', got '$value'"
      exit 1
    fi
    CONFIG_PROMPT_MODE="$value"
  fi
fi

# Simulate apply_config
if [[ -n "\${CONFIG_PROMPT_MODE:-}" ]]; then
  PROMPT_MODE="$CONFIG_PROMPT_MODE"
fi

# Simulate apply_env_overrides
${envExport}
if [[ -n "\${RALPHAI_PROMPT_MODE:-}" ]]; then
  if [[ "$RALPHAI_PROMPT_MODE" != "auto" && "$RALPHAI_PROMPT_MODE" != "at-path" && "$RALPHAI_PROMPT_MODE" != "inline" ]]; then
    echo "ERROR: RALPHAI_PROMPT_MODE must be 'auto', 'at-path', or 'inline', got '$RALPHAI_PROMPT_MODE'"
    exit 1
  fi
  PROMPT_MODE="$RALPHAI_PROMPT_MODE"
fi

# Simulate CLI flag parsing
for arg in ${cliFlag}; do
  case "$arg" in
    --prompt-mode=*)
      CLI_PROMPT_MODE="\${arg#--prompt-mode=}"
      if [[ "$CLI_PROMPT_MODE" != "auto" && "$CLI_PROMPT_MODE" != "at-path" && "$CLI_PROMPT_MODE" != "inline" ]]; then
        echo "ERROR: --prompt-mode must be 'auto', 'at-path', or 'inline', got '$CLI_PROMPT_MODE'"
        exit 1
      fi
      ;;
  esac
done

# Simulate CLI override merge
if [[ -n "$CLI_PROMPT_MODE" ]]; then
  PROMPT_MODE="$CLI_PROMPT_MODE"
fi

echo "$PROMPT_MODE"
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-pm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
        );
        try {
          writeFileSync(scriptFile, script);
          const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
            encoding: "utf-8",
          });
          return result.trim();
        } finally {
          try {
            rmSync(scriptFile);
          } catch {
            /* ignore */
          }
        }
      }

      it("defaults to auto when no overrides", () => {
        expect(resolvePromptMode({})).toBe("auto");
      });

      it("config file sets promptMode", () => {
        expect(resolvePromptMode({ configValue: "inline" })).toBe("inline");
      });

      it("env var overrides config file", () => {
        expect(
          resolvePromptMode({
            configValue: "inline",
            envValue: "at-path",
          }),
        ).toBe("at-path");
      });

      it("CLI flag overrides env var", () => {
        expect(
          resolvePromptMode({
            envValue: "at-path",
            cliValue: "inline",
          }),
        ).toBe("inline");
      });

      it("CLI flag overrides config and env", () => {
        expect(
          resolvePromptMode({
            configValue: "inline",
            envValue: "at-path",
            cliValue: "auto",
          }),
        ).toBe("auto");
      });

      it("rejects invalid config value", () => {
        expect(() => resolvePromptMode({ configValue: "bad" })).toThrow();
      });

      it("rejects invalid env var value", () => {
        expect(() => resolvePromptMode({ envValue: "bad" })).toThrow();
      });

      it("rejects invalid CLI flag value", () => {
        expect(() => resolvePromptMode({ cliValue: "bad" })).toThrow();
      });
    },
  );

  // -------------------------------------------------------------------------
  // --continuous config infrastructure tests
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains continuous config infrastructure", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    expect(defaults).toContain('DEFAULT_CONTINUOUS="false"');
    expect(defaults).toContain('CONTINUOUS="$DEFAULT_CONTINUOUS"');
    expect(defaults).toContain('CLI_CONTINUOUS=""');

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // Config file loader case
    expect(config).toContain("continuous)");
    expect(config).toContain("CONFIG_CONTINUOUS=");
    // Env var override
    expect(config).toContain("RALPHAI_CONTINUOUS");
    // CLI flag
    expect(config).toContain("--continuous)");
    expect(config).toContain('CLI_CONTINUOUS="true"');
    // Help text
    expect(config).toContain(
      "Keep processing backlog plans after the first completes",
    );
    // Supported keys list
    expect(config).toContain("continuous,");
    // Show-config output
    expect(config).toContain("continuous         =");
  });

  describe.skipIf(process.platform === "win32")(
    "continuous config precedence",
    () => {
      /**
       * Helper: simulates the config loading pipeline for CONTINUOUS
       * and returns the resolved value.
       */
      function resolveContinuous(opts: {
        configValue?: string;
        envValue?: string;
        cliFlag?: boolean;
      }): string {
        const configContent = opts.configValue
          ? `continuous=${opts.configValue}`
          : "";
        const envExport = opts.envValue
          ? `export RALPHAI_CONTINUOUS=${JSON.stringify(opts.envValue)}`
          : "";
        const cliArg = opts.cliFlag ? "--continuous" : "";

        const script = `#!/bin/bash
set -e

# Defaults
DEFAULT_CONTINUOUS="false"
CONTINUOUS="$DEFAULT_CONTINUOUS"
CLI_CONTINUOUS=""

# Simulate load_config
CONFIG_CONTINUOUS=""
config_content=${JSON.stringify(configContent)}
if [[ -n "$config_content" ]]; then
  key="\${config_content%%=*}"
  value="\${config_content#*=}"
  if [[ "$key" == "continuous" ]]; then
    if [[ "$value" != "true" && "$value" != "false" ]]; then
      echo "ERROR: 'continuous' must be 'true' or 'false', got '$value'"
      exit 1
    fi
    CONFIG_CONTINUOUS="$value"
  fi
fi

# Simulate apply_config
if [[ -n "\${CONFIG_CONTINUOUS:-}" ]]; then
  CONTINUOUS="$CONFIG_CONTINUOUS"
fi

# Simulate apply_env_overrides
${envExport}
if [[ -n "\${RALPHAI_CONTINUOUS:-}" ]]; then
  if [[ "$RALPHAI_CONTINUOUS" != "true" && "$RALPHAI_CONTINUOUS" != "false" ]]; then
    echo "ERROR: RALPHAI_CONTINUOUS must be 'true' or 'false', got '$RALPHAI_CONTINUOUS'"
    exit 1
  fi
  CONTINUOUS="$RALPHAI_CONTINUOUS"
fi

# Simulate CLI flag parsing
for arg in ${cliArg}; do
  case "$arg" in
    --continuous)
      CLI_CONTINUOUS="true"
      ;;
  esac
done

# Simulate CLI override merge
if [[ -n "$CLI_CONTINUOUS" ]]; then
  CONTINUOUS="$CLI_CONTINUOUS"
fi

echo "$CONTINUOUS"
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-cont-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
        );
        try {
          writeFileSync(scriptFile, script);
          const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
            encoding: "utf-8",
          });
          return result.trim();
        } finally {
          try {
            rmSync(scriptFile);
          } catch {
            /* ignore */
          }
        }
      }

      it("defaults to false when no overrides", () => {
        expect(resolveContinuous({})).toBe("false");
      });

      it("config file sets continuous", () => {
        expect(resolveContinuous({ configValue: "true" })).toBe("true");
      });

      it("env var overrides config file", () => {
        expect(
          resolveContinuous({
            configValue: "true",
            envValue: "false",
          }),
        ).toBe("false");
      });

      it("CLI flag overrides env var", () => {
        expect(
          resolveContinuous({
            envValue: "false",
            cliFlag: true,
          }),
        ).toBe("true");
      });

      it("CLI flag overrides config and env", () => {
        expect(
          resolveContinuous({
            configValue: "false",
            envValue: "false",
            cliFlag: true,
          }),
        ).toBe("true");
      });

      it("rejects invalid config value", () => {
        expect(() => resolveContinuous({ configValue: "bad" })).toThrow();
      });

      it("rejects invalid env var value", () => {
        expect(() => resolveContinuous({ envValue: "bad" })).toThrow();
      });
    },
  );

  // -------------------------------------------------------------------------
  // --auto-commit config infrastructure tests
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains autoCommit config infrastructure", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    expect(defaults).toContain('DEFAULT_AUTO_COMMIT="false"');
    expect(defaults).toContain('AUTO_COMMIT="$DEFAULT_AUTO_COMMIT"');
    expect(defaults).toContain('CLI_AUTO_COMMIT=""');

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // Config file loader reads autoCommit from JSON
    expect(config).toContain('"autoCommit"');
    expect(config).toContain("CONFIG_AUTO_COMMIT=");
    // Env var override
    expect(config).toContain("RALPHAI_AUTO_COMMIT");
    // CLI flags
    expect(config).toContain("--auto-commit)");
    expect(config).toContain("--no-auto-commit)");
    expect(config).toContain('CLI_AUTO_COMMIT="true"');
    expect(config).toContain('CLI_AUTO_COMMIT="false"');
    // Help text
    expect(config).toContain("Enable auto-commit of agent changes");
    expect(config).toContain("Disable auto-commit");
    // Supported keys list
    expect(config).toContain("autoCommit");
    // Show-config output
    expect(config).toContain("autoCommit         =");
  });

  it("scaffolded ralphai.sh gates per-turn auto-commit on AUTO_COMMIT and MODE", () => {
    const templateDir = join(__dirname, "..", "runner");
    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");

    // Direct mode with autoCommit=false skips auto-commit
    expect(ralphaiSh).toContain(
      'AUTO_COMMIT" == "false" && "$MODE" == "direct"',
    );
    expect(ralphaiSh).toContain("autoCommit=false, skipping recovery commit");
  });

  it("scaffolded git.sh gates resume recovery on AUTO_COMMIT and MODE", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");
    const gitSh = readFileSync(join(templateLib, "git.sh"), "utf-8");

    // Resume with autoCommit=false in direct mode skips recovery commit
    expect(gitSh).toContain('AUTO_COMMIT" == "false" && "$MODE" == "direct"');
    expect(gitSh).toContain("autoCommit=false, skipping recovery commit");
  });

  describe.skipIf(process.platform === "win32")(
    "autoCommit config precedence",
    () => {
      /**
       * Helper: simulates the config loading pipeline for AUTO_COMMIT
       * and returns the resolved value.
       */
      function resolveAutoCommit(opts: {
        configValue?: string;
        envValue?: string;
        cliFlag?: "auto-commit" | "no-auto-commit";
      }): string {
        const configContent = opts.configValue
          ? `autoCommit=${opts.configValue}`
          : "";
        const envExport = opts.envValue
          ? `export RALPHAI_AUTO_COMMIT=${JSON.stringify(opts.envValue)}`
          : "";
        let cliArg = "";
        if (opts.cliFlag === "auto-commit") cliArg = "--auto-commit";
        else if (opts.cliFlag === "no-auto-commit") cliArg = "--no-auto-commit";

        const script = `#!/bin/bash
set -e

# Defaults
DEFAULT_AUTO_COMMIT="false"
AUTO_COMMIT="$DEFAULT_AUTO_COMMIT"
CLI_AUTO_COMMIT=""

# Simulate load_config
CONFIG_AUTO_COMMIT=""
config_content=${JSON.stringify(configContent)}
if [[ -n "$config_content" ]]; then
  key="\${config_content%%=*}"
  value="\${config_content#*=}"
  if [[ "$key" == "autoCommit" ]]; then
    if [[ "$value" != "true" && "$value" != "false" ]]; then
      echo "ERROR: 'autoCommit' must be true or false, got '$value'"
      exit 1
    fi
    CONFIG_AUTO_COMMIT="$value"
  fi
fi

# Simulate apply_config
if [[ -n "\${CONFIG_AUTO_COMMIT:-}" ]]; then
  AUTO_COMMIT="$CONFIG_AUTO_COMMIT"
fi

# Simulate apply_env_overrides
${envExport}
if [[ -n "\${RALPHAI_AUTO_COMMIT:-}" ]]; then
  if [[ "$RALPHAI_AUTO_COMMIT" != "true" && "$RALPHAI_AUTO_COMMIT" != "false" ]]; then
    echo "ERROR: RALPHAI_AUTO_COMMIT must be 'true' or 'false', got '$RALPHAI_AUTO_COMMIT'"
    exit 1
  fi
  AUTO_COMMIT="$RALPHAI_AUTO_COMMIT"
fi

# Simulate CLI flag parsing
for arg in ${cliArg}; do
  case "$arg" in
    --auto-commit)
      CLI_AUTO_COMMIT="true"
      ;;
    --no-auto-commit)
      CLI_AUTO_COMMIT="false"
      ;;
  esac
done

# Simulate CLI override merge
if [[ -n "$CLI_AUTO_COMMIT" ]]; then
  AUTO_COMMIT="$CLI_AUTO_COMMIT"
fi

echo "$AUTO_COMMIT"
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-ac-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
        );
        try {
          writeFileSync(scriptFile, script);
          const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
            encoding: "utf-8",
          });
          return result.trim();
        } finally {
          try {
            rmSync(scriptFile);
          } catch {
            /* ignore */
          }
        }
      }

      it("defaults to false when no overrides", () => {
        expect(resolveAutoCommit({})).toBe("false");
      });

      it("config file sets autoCommit to true", () => {
        expect(resolveAutoCommit({ configValue: "true" })).toBe("true");
      });

      it("config file sets autoCommit to false", () => {
        expect(resolveAutoCommit({ configValue: "false" })).toBe("false");
      });

      it("env var overrides config file", () => {
        expect(
          resolveAutoCommit({
            configValue: "true",
            envValue: "false",
          }),
        ).toBe("false");
      });

      it("env var sets autoCommit when no config", () => {
        expect(resolveAutoCommit({ envValue: "true" })).toBe("true");
      });

      it("--auto-commit CLI flag overrides env var", () => {
        expect(
          resolveAutoCommit({
            envValue: "false",
            cliFlag: "auto-commit",
          }),
        ).toBe("true");
      });

      it("--no-auto-commit CLI flag overrides env var", () => {
        expect(
          resolveAutoCommit({
            envValue: "true",
            cliFlag: "no-auto-commit",
          }),
        ).toBe("false");
      });

      it("CLI flag overrides config and env", () => {
        expect(
          resolveAutoCommit({
            configValue: "false",
            envValue: "false",
            cliFlag: "auto-commit",
          }),
        ).toBe("true");
      });

      it("rejects invalid config value", () => {
        expect(() => resolveAutoCommit({ configValue: "bad" })).toThrow();
      });

      it("rejects invalid env var value", () => {
        expect(() => resolveAutoCommit({ envValue: "bad" })).toThrow();
      });
    },
  );

  // -------------------------------------------------------------------------
  // Prompt construction wiring tests (format_file_ref used in prompt)
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh wires format_file_ref into prompt construction and detect_plan", () => {
    const templateDir = join(__dirname, "..", "runner");
    const templateLib = join(templateDir, "lib");

    const plans = readFileSync(join(templateLib, "plans.sh"), "utf-8");
    const prompt = readFileSync(join(templateLib, "prompt.sh"), "utf-8");
    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // detect_plan: FILE_REFS uses format_file_ref
    expect(plans).toContain('FILE_REFS="$FILE_REFS $(format_file_ref "$f")"');
    // detect_plan: dry-run chosen
    expect(plans).toContain('FILE_REFS=" $(format_file_ref "$chosen")"');
    // detect_plan: normal chosen
    expect(plans).toContain('FILE_REFS=" $(format_file_ref "$dest")"');
    // LEARNINGS_REF uses format_file_ref
    expect(prompt).toContain(
      'LEARNINGS_REF=" $(format_file_ref "$RALPHAI_LEARNINGS_FILE")"',
    );
    // Prompt construction uses format_file_ref for progress file
    expect(ralphaiSh).toContain(
      '$(format_file_ref "${PROGRESS_FILE}")${LEARNINGS_REF}',
    );
    // Backlog selection refs use format_file_ref
    expect(plans).toContain(
      'backlog_refs="$backlog_refs $(format_file_ref "$f")"',
    );
    // Should NOT have any hardcoded @$var or @${VAR} file references in
    // prompt construction or detect_plan FILE_REFS assignments
    expect(plans).not.toMatch(/FILE_REFS=.*@\$/);
    expect(prompt).not.toContain('LEARNINGS_REF=" @');
  });

  // -------------------------------------------------------------------------
  // Run default turn tests
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("run default turns", () => {
    let stubScript: string;

    beforeEach(() => {
      // Scaffold ralphai (creates .ralphai/ directory)
      runCliOutput(["init", "--yes"], testDir);
      // Create a stub script that echoes args (used via RALPHAI_RUNNER_SCRIPT env var)
      stubScript = join(testDir, "stub-runner.sh");
      writeFileSync(stubScript, '#!/bin/bash\necho "ARGS:$*"\n');
      chmodSync(stubScript, 0o755);
    });

    it("run without args lets the runner apply its default turn count", () => {
      const result = runCli(["run"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:");
      expect(result.stdout).not.toContain("ARGS:5");
    });

    it("run -- --turns=5 passes explicit turn count to ralphai.sh", () => {
      const result = runCli(["run", "--", "--turns=5"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--turns=5");
    });

    it("run -- --dry-run passes flags to ralphai.sh", () => {
      const result = runCli(["run", "--", "--dry-run"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--dry-run");
    });

    it("run -- --turns=5 --resume passes multiple args to ralphai.sh", () => {
      const result = runCli(["run", "--", "--turns=5", "--resume"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--turns=5 --resume");
    });

    it("run --turns=3 passes turn count without -- separator", () => {
      const result = runCli(["run", "--turns=3"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--turns=3");
    });

    it("run --dry-run passes flags without -- separator", () => {
      const result = runCli(["run", "--dry-run"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--dry-run");
    });

    it("run --turns=3 --resume passes multiple args without -- separator", () => {
      const result = runCli(["run", "--turns=3", "--resume"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--turns=3 --resume");
    });

    it("run 3 is rejected by the bundled runner", () => {
      const result = runCli(["run", "3"], testDir);
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      expect(combined).toContain("Unrecognized argument: 3");
    });

    it("run --show-config shows turns from config file", () => {
      // Modify ralphai.json to set turns: 3
      const configPath = join(testDir, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.turns = 3;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(["run", "--show-config"], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("turns              = 3");
      expect(result.stdout).toContain("(config (ralphai.json))");
    });

    it("RALPHAI_TURNS env var overrides config file turns", () => {
      const configPath = join(testDir, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.turns = 3;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(["run", "--show-config"], testDir, {
        RALPHAI_TURNS: "10",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("turns              = 10");
      expect(result.stdout).toContain("(env (RALPHAI_TURNS=10))");
    });

    it("CLI --turns overrides both config and env var", () => {
      const configPath = join(testDir, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.turns = 3;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(["run", "--turns=7", "--show-config"], testDir, {
        RALPHAI_TURNS: "10",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("turns              = 7");
      expect(result.stdout).toContain("(cli (--turns=7))");
    });

    it("turns: 0 in config displays as unlimited", () => {
      const configPath = join(testDir, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.turns = 0;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(["run", "--show-config"], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("turns              = unlimited");
      expect(result.stdout).toContain("(config (ralphai.json))");
    });

    it("built CLI can locate the bundled runner script", () => {
      const repoRoot = join(__dirname, "..");
      const distCli = join(repoRoot, "dist", "cli.mjs");

      execSync("git checkout -b main", {
        cwd: testDir,
        stdio: "ignore",
      });
      execSync("git config user.name 'Test User'", {
        cwd: testDir,
        stdio: "ignore",
      });
      execSync("git config user.email 'test@example.com'", {
        cwd: testDir,
        stdio: "ignore",
      });
      execSync("git commit --allow-empty -m init", {
        cwd: testDir,
        stdio: "ignore",
      });

      execSync("pnpm build", {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const output = execFileSync(
        "node",
        [distCli, "run", "--dry-run", "--pr"],
        {
          cwd: testDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            RALPHAI_NO_UPDATE_CHECK: "1",
            RALPHAI_AGENT_COMMAND: "echo test-agent",
          },
        },
      );

      expect(output).toContain("No runnable work found.");
    });
  });

  // -------------------------------------------------------------------------
  // GitHub Issues integration tests
  // -------------------------------------------------------------------------

  describe("GitHub Issues integration", () => {
    it("init --yes defaults issueSource to none in config", () => {
      runCliOutput(["init", "--yes"], testDir);

      const parsed = JSON.parse(
        readFileSync(join(testDir, "ralphai.json"), "utf-8"),
      );
      expect(parsed.issueSource).toBe("none");
    });

    it("init --yes includes issueSource as none in JSON config", () => {
      runCliOutput(["init", "--yes"], testDir);

      const parsed = JSON.parse(
        readFileSync(join(testDir, "ralphai.json"), "utf-8"),
      );
      // issueSource should be "none" by default (all 17 keys are explicit)
      expect(parsed.issueSource).toBe("none");
    });

    it("init --yes output does not contain GitHub label info", () => {
      const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

      expect(output).not.toContain("GitHub labels");
      expect(output).not.toContain("Label a GitHub issue");
    });
  });

  // -------------------------------------------------------------------------
  // Self-update and update notification tests
  // -------------------------------------------------------------------------

  describe("self-update", () => {
    it("detectInstallerPM returns pnpm for paths containing .pnpm", () => {
      expect(
        detectInstallerPM(
          "/home/user/.local/share/pnpm/global/5/.pnpm/ralphai@0.2.1/node_modules/ralphai/dist/cli.mjs",
        ),
      ).toBe("pnpm");
    });

    it("detectInstallerPM returns pnpm for Windows paths containing .pnpm", () => {
      expect(
        detectInstallerPM(
          "C:\\Users\\user\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\ralphai@0.2.1\\node_modules\\ralphai\\dist\\cli.mjs",
        ),
      ).toBe("pnpm");
    });

    it("detectInstallerPM returns bun for paths containing .bun", () => {
      expect(
        detectInstallerPM(
          "/home/user/.bun/install/global/node_modules/ralphai/dist/cli.mjs",
        ),
      ).toBe("bun");
    });

    it("detectInstallerPM returns yarn for paths containing yarn/global", () => {
      expect(
        detectInstallerPM(
          "/home/user/.config/yarn/global/node_modules/ralphai/dist/cli.mjs",
        ),
      ).toBe("yarn");
    });

    it("detectInstallerPM returns npm as fallback", () => {
      expect(
        detectInstallerPM("/usr/local/lib/node_modules/ralphai/dist/cli.mjs"),
      ).toBe("npm");
    });

    it("buildUpdateCommand builds correct command for each PM", () => {
      expect(buildUpdateCommand("pnpm", "ralphai", "latest")).toBe(
        "pnpm add -g ralphai@latest",
      );
      expect(buildUpdateCommand("npm", "ralphai", "latest")).toBe(
        "npm install -g ralphai@latest",
      );
      expect(buildUpdateCommand("yarn", "ralphai", "latest")).toBe(
        "yarn global add ralphai@latest",
      );
      expect(buildUpdateCommand("bun", "ralphai", "latest")).toBe(
        "bun add -g ralphai@latest",
      );
    });

    it("buildUpdateCommand includes tag in spec", () => {
      expect(buildUpdateCommand("npm", "ralphai", "beta")).toBe(
        "npm install -g ralphai@beta",
      );
      expect(buildUpdateCommand("pnpm", "ralphai", "next")).toBe(
        "pnpm add -g ralphai@next",
      );
    });
  });

  describe("compareVersions", () => {
    it("returns 0 for equal versions", () => {
      expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    });

    it("returns positive when first is greater (major)", () => {
      expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
    });

    it("returns negative when first is less (minor)", () => {
      expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
    });

    it("returns positive when first is greater (patch)", () => {
      expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
    });

    it("handles versions with missing parts", () => {
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
    });
  });

  describe("update check cache", () => {
    let cacheDir: string;

    beforeEach(() => {
      cacheDir = join(
        tmpdir(),
        `ralphai-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(cacheDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(cacheDir)) {
        rmSync(cacheDir, { recursive: true, force: true });
      }
    });

    it("checkForUpdate returns null when no cache file exists", () => {
      expect(checkForUpdate("ralphai", "1.0.0", cacheDir)).toBeNull();
    });

    it("checkForUpdate returns null when current version is latest", () => {
      writeFileSync(
        join(cacheDir, "update-check.json"),
        JSON.stringify({ lastCheck: Date.now(), latestVersion: "1.0.0" }),
      );
      expect(checkForUpdate("ralphai", "1.0.0", cacheDir)).toBeNull();
    });

    it("checkForUpdate returns null when current version is newer", () => {
      writeFileSync(
        join(cacheDir, "update-check.json"),
        JSON.stringify({ lastCheck: Date.now(), latestVersion: "1.0.0" }),
      );
      expect(checkForUpdate("ralphai", "2.0.0", cacheDir)).toBeNull();
    });

    it("checkForUpdate returns update info when newer version is available", () => {
      writeFileSync(
        join(cacheDir, "update-check.json"),
        JSON.stringify({ lastCheck: Date.now(), latestVersion: "2.0.0" }),
      );
      const result = checkForUpdate("ralphai", "1.0.0", cacheDir);
      expect(result).toEqual({ latest: "2.0.0", current: "1.0.0" });
    });

    it("checkForUpdate returns null for corrupt cache file", () => {
      writeFileSync(join(cacheDir, "update-check.json"), "not json");
      expect(checkForUpdate("ralphai", "1.0.0", cacheDir)).toBeNull();
    });

    it("checkForUpdate returns null when cache has no latestVersion", () => {
      writeFileSync(
        join(cacheDir, "update-check.json"),
        JSON.stringify({ lastCheck: Date.now() }),
      );
      expect(checkForUpdate("ralphai", "1.0.0", cacheDir)).toBeNull();
    });
  });

  describe("update notification banner", () => {
    let cacheDir: string;

    beforeEach(() => {
      cacheDir = join(
        tmpdir(),
        `ralphai-notify-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(cacheDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(cacheDir)) {
        rmSync(cacheDir, { recursive: true, force: true });
      }
    });

    it("shows update banner when newer version is cached", () => {
      // Write a cache file indicating a newer version
      const xdgBase = join(
        tmpdir(),
        `ralphai-xdg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const xdgRalphai = join(xdgBase, "ralphai");
      mkdirSync(xdgRalphai, { recursive: true });
      writeFileSync(
        join(xdgRalphai, "update-check.json"),
        JSON.stringify({ lastCheck: Date.now(), latestVersion: "99.0.0" }),
      );

      try {
        // Use "init --yes" which goes through runRalphai() and then hits
        // the notification code path in main().
        const result = runCli(["init", "--yes"], testDir, {
          XDG_CACHE_HOME: xdgBase,
        });
        expect(result.stdout).toContain("Update available");
        expect(result.stdout).toContain("99.0.0");
        expect(result.stdout).toContain("ralphai update");
      } finally {
        if (existsSync(xdgBase)) {
          rmSync(xdgBase, { recursive: true, force: true });
        }
      }
    });

    it("does not show banner when RALPHAI_NO_UPDATE_CHECK is set", () => {
      const xdgBase = join(
        tmpdir(),
        `ralphai-xdg-nocheck-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const xdgRalphai = join(xdgBase, "ralphai");
      mkdirSync(xdgRalphai, { recursive: true });
      writeFileSync(
        join(xdgRalphai, "update-check.json"),
        JSON.stringify({ lastCheck: Date.now(), latestVersion: "99.0.0" }),
      );

      try {
        const result = runCli(["init", "--yes"], testDir, {
          XDG_CACHE_HOME: xdgBase,
          RALPHAI_NO_UPDATE_CHECK: "1",
        });
        expect(result.stdout).not.toContain("Update available");
        expect(result.stdout).not.toContain("99.0.0");
      } finally {
        if (existsSync(xdgBase)) {
          rmSync(xdgBase, { recursive: true, force: true });
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // --version and --help tests
  // -------------------------------------------------------------------------

  it("--version prints the package version", () => {
    const result = runCli(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--help shows usage information", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("ralphai");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("run");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("uninstall");
  });

  // -------------------------------------------------------------------------
  // Per-plan agent override: extract_plan_agent
  // -------------------------------------------------------------------------

  it("scaffolded plans.sh contains extract_plan_agent function", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const plans = readFileSync(join(templateLib, "plans.sh"), "utf-8");
    expect(plans).toContain("extract_plan_agent()");
  });

  describe.skipIf(process.platform === "win32")(
    "extract_plan_agent function",
    () => {
      /** Helper: run extract_plan_agent on a temp file with given content */
      function extractPlanAgent(content: string): {
        stdout: string;
        exitCode: number;
      } {
        const planFile = join(
          tmpdir(),
          `ralphai-test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
        );
        const script = `#!/bin/bash
extract_plan_agent() {
  local plan_file="$1"
  [[ -f "$plan_file" ]] || return 1
  head -1 "$plan_file" | grep -q '^---$' || return 1
  sed -n '/^---$/,/^---$/{ /^agent:[[:space:]]/{ s/^agent:[[:space:]]*//; p; } }' "$plan_file"
}
extract_plan_agent ${JSON.stringify(planFile)}
echo "EXIT=$?"
`;
        const scriptFile = join(
          tmpdir(),
          `ralphai-test-script-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
        );
        try {
          writeFileSync(planFile, content);
          writeFileSync(scriptFile, script);
          const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
            encoding: "utf-8",
          });
          const lines = result.trimEnd().split("\n");
          const exitLine = lines.pop()!;
          const exitCode = parseInt(exitLine.replace("EXIT=", ""), 10);
          return { stdout: lines.join("\n"), exitCode };
        } finally {
          try {
            rmSync(planFile);
          } catch {
            /* ignore */
          }
          try {
            rmSync(scriptFile);
          } catch {
            /* ignore */
          }
        }
      }

      it("extracts agent command from frontmatter", () => {
        const result = extractPlanAgent("---\nagent: claude -p\n---\n# Plan\n");
        expect(result.stdout).toBe("claude -p");
      });

      it("returns empty string when no agent key present", () => {
        const result = extractPlanAgent(
          "---\ntitle: my-feature\n---\n# Plan\n",
        );
        expect(result.stdout).toBe("");
      });

      it("returns exit code 1 when no frontmatter block", () => {
        const result = extractPlanAgent("# Just a plan\nNo frontmatter\n");
        expect(result.exitCode).toBe(1);
      });

      it("extracts agent with other frontmatter keys present", () => {
        const result = extractPlanAgent(
          "---\ntitle: my-feature\nagent: opencode run --agent build\ndepends-on: [prd-a.md]\n---\n# Plan\n",
        );
        expect(result.stdout).toBe("opencode run --agent build");
      });

      it("handles agent as the first frontmatter key", () => {
        const result = extractPlanAgent(
          "---\nagent: codex exec\ntitle: test\n---\n# Plan\n",
        );
        expect(result.stdout).toBe("codex exec");
      });

      it("handles agent command with flags and arguments", () => {
        const result = extractPlanAgent(
          "---\nagent: claude --model opus -p\n---\n# Plan\n",
        );
        expect(result.stdout).toBe("claude --model opus -p");
      });
    },
  );

  // -------------------------------------------------------------------------
  // Continuous+PR: build_continuous_pr_body
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")(
    "build_continuous_pr_body function",
    () => {
      let prDir: string;
      let backlogDir: string;

      beforeEach(() => {
        prDir = join(
          tmpdir(),
          `ralphai-pr-body-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        backlogDir = join(prDir, "backlog");
        mkdirSync(backlogDir, { recursive: true });
        // Initialize a git repo so git log works
        execSync(
          "git init && git config user.email 'test@test.com' && git config user.name 'Test' && git commit --allow-empty -m 'init'",
          {
            cwd: prDir,
            stdio: "ignore",
          },
        );
      });

      afterEach(() => {
        if (existsSync(prDir)) {
          rmSync(prDir, { recursive: true, force: true });
        }
      });

      /** Helper: run build_continuous_pr_body with given completed plans and backlog files */
      function buildBody(
        completedPlans: string[],
        backlogFiles: string[],
      ): string {
        // Create backlog plan files
        for (const f of backlogFiles) {
          writeFileSync(join(backlogDir, f), `# ${f}\n`);
        }

        const completedArr = completedPlans
          .map((p) => JSON.stringify(p))
          .join(" ");
        const script = `#!/bin/bash
BACKLOG_DIR=${JSON.stringify(backlogDir)}
BASE_BRANCH="main"
COMPLETED_PLANS=(${completedArr})

build_continuous_pr_body() {
  local body=""

  body+="## Completed Plans"$'\\n\\n'
  if [[ \${#COMPLETED_PLANS[@]} -gt 0 ]]; then
    for p in "\${COMPLETED_PLANS[@]}"; do
      body+="- [x] $p"$'\\n'
    done
  else
    body+="_None yet._"$'\\n'
  fi

  local remaining=()
  for f in "$BACKLOG_DIR"/*.md; do
    [[ -f "$f" ]] && remaining+=("$(basename "$f")")
  done

  body+=$'\\n'"## Remaining Plans"$'\\n\\n'
  if [[ \${#remaining[@]} -gt 0 ]]; then
    for r in "\${remaining[@]}"; do
      body+="- [ ] $r"$'\\n'
    done
  else
    body+="_Backlog empty — all plans processed._"$'\\n'
  fi

  local commit_log
  commit_log=$(git log "$BASE_BRANCH".."\$(git rev-parse --abbrev-ref HEAD)" --oneline --no-decorate 2>/dev/null || true)
  body+=$'\\n'"## Commits"$'\\n\\n'
  body+='\`\`\`'$'\\n'
  body+="\${commit_log:-_No commits._}"$'\\n'
  body+='\`\`\`'

  echo "$body"
}

build_continuous_pr_body
`;
        const scriptFile = join(prDir, "test-pr-body.sh");
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          cwd: prDir,
          encoding: "utf-8",
        });
        return result;
      }

      it("lists completed plans with checkmarks", () => {
        const body = buildBody(["prd-auth.md", "prd-api.md"], ["prd-ui.md"]);
        expect(body).toContain("- [x] prd-auth.md");
        expect(body).toContain("- [x] prd-api.md");
      });

      it("lists remaining backlog plans as unchecked", () => {
        const body = buildBody(["prd-auth.md"], ["prd-ui.md", "prd-db.md"]);
        expect(body).toContain("- [ ] prd-ui.md");
        expect(body).toContain("- [ ] prd-db.md");
      });

      it("shows none-yet when no plans completed", () => {
        const body = buildBody([], ["prd-ui.md"]);
        expect(body).toContain("_None yet._");
      });

      it("shows backlog-empty when all plans processed", () => {
        const body = buildBody(["prd-auth.md"], []);
        expect(body).toContain("_Backlog empty — all plans processed._");
      });

      it("includes Commits section", () => {
        const body = buildBody(["prd-auth.md"], []);
        expect(body).toContain("## Commits");
      });
    },
  );

  // -------------------------------------------------------------------------
  // Continuous+PR: runner template contains continuous PR functions
  // -------------------------------------------------------------------------

  it("pr.sh contains continuous PR management functions", () => {
    const prSh = readFileSync(
      join(__dirname, "..", "runner", "lib", "pr.sh"),
      "utf-8",
    );
    expect(prSh).toContain("build_continuous_pr_body()");
    expect(prSh).toContain("create_continuous_pr()");
    expect(prSh).toContain("update_continuous_pr()");
    expect(prSh).toContain("finalize_continuous_pr()");
  });

  it("ralphai.sh tracks COMPLETED_PLANS and CONTINUOUS_BRANCH for continuous+PR", () => {
    const ralphaiSh = readFileSync(
      join(__dirname, "..", "runner", "ralphai.sh"),
      "utf-8",
    );
    expect(ralphaiSh).toContain("COMPLETED_PLANS=()");
    expect(ralphaiSh).toContain('CONTINUOUS_BRANCH=""');
    expect(ralphaiSh).toContain('CONTINUOUS_PR_URL=""');
  });

  it("ralphai.sh routes to continuous PR functions when CONTINUOUS=true and MODE=pr", () => {
    const ralphaiSh = readFileSync(
      join(__dirname, "..", "runner", "ralphai.sh"),
      "utf-8",
    );
    // First plan creates draft PR
    expect(ralphaiSh).toContain("create_continuous_pr");
    // Subsequent plans update PR
    expect(ralphaiSh).toContain("update_continuous_pr");
    // Backlog drained finalizes PR
    expect(ralphaiSh).toContain("finalize_continuous_pr");
  });

  it("ralphai.sh reuses CONTINUOUS_BRANCH for subsequent plans in continuous+PR mode", () => {
    const ralphaiSh = readFileSync(
      join(__dirname, "..", "runner", "ralphai.sh"),
      "utf-8",
    );
    // When continuous branch is already set, reuse it
    expect(ralphaiSh).toContain(
      'CONTINUOUS" == "true" && -n "$CONTINUOUS_BRANCH"',
    );
    expect(ralphaiSh).toContain('branch="$CONTINUOUS_BRANCH"');
  });

  it("no group mode references remain in runner scripts", () => {
    const defaultsSh = readFileSync(
      join(__dirname, "..", "runner", "lib", "defaults.sh"),
      "utf-8",
    );
    const plansSh = readFileSync(
      join(__dirname, "..", "runner", "lib", "plans.sh"),
      "utf-8",
    );
    const prSh = readFileSync(
      join(__dirname, "..", "runner", "lib", "pr.sh"),
      "utf-8",
    );
    const ralphaiSh = readFileSync(
      join(__dirname, "..", "runner", "ralphai.sh"),
      "utf-8",
    );

    for (const [name, content] of [
      ["defaults.sh", defaultsSh],
      ["plans.sh", plansSh],
      ["pr.sh", prSh],
      ["ralphai.sh", ralphaiSh],
    ]) {
      expect(content).not.toContain("GROUP_NAME");
      expect(content).not.toContain("GROUP_STATE_FILE");
      expect(content).not.toContain("extract_group");
      expect(content).not.toContain("group-state");
      expect(content).not.toContain("collect_group_plans");
      expect(content).not.toContain("advance_group_plan");
      expect(content).not.toContain("create_group_pr");
      expect(content).not.toContain("update_group_pr");
      expect(content).not.toContain("finalize_group_pr");
    }
  });

  // -----------------------------------------------------------------------
  // Worktree subcommand
  // -----------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("worktree subcommand", () => {
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
      const result = runCli([], testDir);
      const output = stripLogo(result.stdout);
      expect(output).toContain("worktree");
    });

    it("worktree --help shows worktree-specific help", () => {
      const output = runCliOutput(["worktree", "--help"], testDir);
      expect(output).toContain("ralphai worktree");
      expect(output).toContain("list");
      expect(output).toContain("clean");
      expect(output).toContain("--plan=");
      expect(output).toContain("--dir=");
      expect(output).toContain("--turns=<n>");
    });

    it("worktree refuses inside a worktree", () => {
      // Set up a main repo with a worktree
      gitInitialCommit(testDir);
      const worktreeDir = join(testDir, "wt");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/test HEAD`, {
        cwd: testDir,
        stdio: "ignore",
      });

      // Initialize ralphai so the worktree guard runs (it checks before .ralphai)
      // Create a minimal .ralphai in main repo so worktree resolves
      mkdirSync(join(testDir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-test.md"),
        "# Test plan\n",
      );

      const result = runCli(["worktree"], worktreeDir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must be run from the main repository");

      // Clean up worktree
      execSync(`git worktree remove "${worktreeDir}"`, {
        cwd: testDir,
        stdio: "ignore",
      });
    });

    it("worktree errors when .ralphai is not set up", () => {
      gitInitialCommit(testDir);
      const result = runCli(["worktree"], testDir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not set up");
    });

    it("worktree errors with no backlog plans", () => {
      gitInitialCommit(testDir);
      // Create .ralphai with empty backlog
      mkdirSync(join(testDir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });

      const result = runCli(["worktree"], testDir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("No plans in backlog");
    });

    it("worktree --plan=nonexistent.md errors", () => {
      gitInitialCommit(testDir);
      mkdirSync(join(testDir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });

      const result = runCli(["worktree", "--plan=nonexistent.md"], testDir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found in backlog");
    });

    it("worktree list shows no worktrees initially", () => {
      gitInitialCommit(testDir);
      const output = runCliOutput(["worktree", "list"], testDir);
      expect(output).toContain("No active ralphai worktrees");
    });

    it("worktree list shows ralphai worktrees", () => {
      gitInitialCommit(testDir);

      // Create a worktree on a ralphai/* branch
      const wtPath = join(testDir, "wt-list-test");
      execSync(`git worktree add "${wtPath}" -b ralphai/my-feature HEAD`, {
        cwd: testDir,
        stdio: "ignore",
      });

      const output = runCliOutput(["worktree", "list"], testDir);
      expect(output).toContain("ralphai/my-feature");
      expect(output).toContain(wtPath);

      // Clean up
      execSync(`git worktree remove "${wtPath}"`, {
        cwd: testDir,
        stdio: "ignore",
      });
    });

    it("worktree clean removes completed worktrees", () => {
      gitInitialCommit(testDir);

      // Create a worktree on a ralphai/* branch
      const wtPath = join(testDir, "wt-clean-test");
      execSync(`git worktree add "${wtPath}" -b ralphai/done-feature HEAD`, {
        cwd: testDir,
        stdio: "ignore",
      });

      // No .ralphai/pipeline/in-progress/prd-done-feature.md exists,
      // so it should be cleaned
      const output = runCliOutput(["worktree", "clean"], testDir);
      expect(output).toContain("Removing:");
      expect(output).toContain("Cleaned 1 worktree(s)");
      expect(existsSync(wtPath)).toBe(false);
    });

    it("worktree clean preserves in-progress worktrees", () => {
      gitInitialCommit(testDir);

      // Create a worktree on a ralphai/* branch
      const wtPath = join(testDir, "wt-keep-test");
      execSync(`git worktree add "${wtPath}" -b ralphai/active-feature HEAD`, {
        cwd: testDir,
        stdio: "ignore",
      });

      // Create matching in-progress plan
      mkdirSync(join(testDir, ".ralphai", "pipeline", "in-progress"), {
        recursive: true,
      });
      writeFileSync(
        join(
          testDir,
          ".ralphai",
          "pipeline",
          "in-progress",
          "prd-active-feature.md",
        ),
        "# Active plan\n",
      );

      const output = runCliOutput(["worktree", "clean"], testDir);
      expect(output).toContain("Keeping:");
      expect(output).toContain("plan still in progress");
      expect(existsSync(wtPath)).toBe(true);

      // Clean up
      execSync(`git worktree remove "${wtPath}"`, {
        cwd: testDir,
        stdio: "ignore",
      });
    });

    it("worktree --plan selects a specific plan", () => {
      gitInitialCommit(testDir);

      // Create .ralphai with two plans
      mkdirSync(join(testDir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-first.md"),
        "# First\n",
      );
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-second.md"),
        "# Second\n",
      );

      // Use a stub runner that just exits 0
      const stubScript = join(testDir, "stub-runner.sh");
      writeFileSync(stubScript, "#!/bin/bash\nexit 0\n");
      chmodSync(stubScript, 0o755);

      const result = runCli(
        ["worktree", "--plan=prd-second.md"],
        testDir,
        { RALPHAI_RUNNER_SCRIPT: stubScript },
        30000,
      );

      // The output should mention the second plan's slug, not the first
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("ralphai/second");
    });

    it("worktree creates .ralphai symlink in worktree directory", () => {
      gitInitialCommit(testDir);

      // Create .ralphai with a plan
      mkdirSync(join(testDir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-symlink-test.md"),
        "# Symlink test\n",
      );

      // Use a stub runner that just exits 0
      const stubScript = join(testDir, "stub-runner.sh");
      writeFileSync(stubScript, "#!/bin/bash\nexit 0\n");
      chmodSync(stubScript, 0o755);

      // Use --dir to place worktree inside testDir (auto-cleaned by afterEach)
      const worktreeDir = join(testDir, "wt-symlink");

      const result = runCli(
        ["worktree", "--plan=prd-symlink-test.md", `--dir=${worktreeDir}`],
        testDir,
        { RALPHAI_RUNNER_SCRIPT: stubScript },
        30000,
      );

      // Debug: print stdout/stderr if the worktree dir doesn't exist
      const combined = result.stdout + result.stderr;

      // Verify the symlink was created
      const symlinkPath = join(worktreeDir, ".ralphai");
      expect(
        existsSync(symlinkPath),
        `Symlink not found at ${symlinkPath}. worktreeDir exists: ${existsSync(worktreeDir)}. CLI output: ${combined}`,
      ).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(symlinkPath)).toBe(join(testDir, ".ralphai"));
    });

    it("worktree replaces existing .ralphai dir with symlink", () => {
      gitInitialCommit(testDir);

      // Create .ralphai with a plan (not git-tracked since .ralphai/ is gitignored)
      mkdirSync(join(testDir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-tracked-test.md"),
        "# Tracked test\n",
      );

      // Use a stub runner that just exits 0
      const stubScript = join(testDir, "stub-runner.sh");
      writeFileSync(stubScript, "#!/bin/bash\nexit 0\n");
      chmodSync(stubScript, 0o755);

      const worktreeDir = join(testDir, "wt-tracked");

      const result = runCli(
        ["worktree", "--plan=prd-tracked-test.md", `--dir=${worktreeDir}`],
        testDir,
        { RALPHAI_RUNNER_SCRIPT: stubScript },
        30000,
      );

      const combined = result.stdout + result.stderr;

      // The .ralphai in the worktree should be a symlink, NOT a directory
      const symlinkPath = join(worktreeDir, ".ralphai");
      expect(
        existsSync(symlinkPath),
        `Symlink not found at ${symlinkPath}. CLI output: ${combined}`,
      ).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(symlinkPath)).toBe(join(testDir, ".ralphai"));
    });

    it("is_tree_dirty ignores .ralphai changes (gitignored) but catches real dirty state", () => {
      gitInitialCommit(testDir);

      // Add .ralphai/ to .gitignore (legacy pattern — only matches directories,
      // not symlinks; the pathspec exclusion in is_tree_dirty handles this)
      writeFileSync(join(testDir, ".gitignore"), ".ralphai/\n");
      execSync("git add .gitignore && git commit -m 'add gitignore'", {
        cwd: testDir,
        stdio: "ignore",
      });

      const gitShPath = join(__dirname, "..", "runner", "lib", "git.sh");

      // Helper: run is_tree_dirty in a given directory
      const isDirty = (cwd: string) => {
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd,
          encoding: "utf-8",
        }).trim();
        const result = execSync(
          `bash -c 'MODE=direct; DRY_RUN=true; BASE_BRANCH=${branch}; source "${gitShPath}"; is_tree_dirty; echo $?'`,
          { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim();
        return result === "0";
      };

      // Clean tree should not be dirty
      expect(isDirty(testDir)).toBe(false);

      // Adding files inside .ralphai/ should NOT make the tree dirty (gitignored)
      mkdirSync(join(testDir, ".ralphai"), { recursive: true });
      writeFileSync(join(testDir, ".ralphai", "LEARNINGS.md"), "# Learnings");
      expect(isDirty(testDir)).toBe(false);

      // A .ralphai symlink (as created in worktrees) should also not trigger dirty
      rmSync(join(testDir, ".ralphai"), { recursive: true, force: true });
      const symlinkTarget = join(testDir, ".ralphai-real");
      mkdirSync(symlinkTarget, { recursive: true });
      symlinkSync(symlinkTarget, join(testDir, ".ralphai"));
      expect(isDirty(testDir)).toBe(false);

      // But a real change (outside .ralphai) should still be caught
      writeFileSync(join(testDir, "real-change.txt"), "dirty");
      expect(isDirty(testDir)).toBe(true);
    });

    it("worktree reuses an existing in-progress worktree and auto-resumes", () => {
      gitInitialCommit(testDir);

      mkdirSync(join(testDir, ".ralphai", "pipeline", "in-progress"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "in-progress", "prd-resume.md"),
        "# Resume test\n",
      );

      const worktreeDir = join(testDir, "wt-resume");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/resume HEAD`, {
        cwd: testDir,
        stdio: "ignore",
      });

      const stubScript = join(testDir, "stub-runner.sh");
      writeFileSync(
        stubScript,
        '#!/bin/bash\necho "PWD=$PWD"\necho "ARGS=$*"\nexit 0\n',
      );
      chmodSync(stubScript, 0o755);

      const result = runCli(["worktree", "--turns=3"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(combined).toContain(`Reusing existing worktree: ${worktreeDir}`);
      expect(combined).toContain(`PWD=${worktreeDir}`);
      expect(combined).toContain("ARGS=--pr --resume --turns=3");

      const symlinkPath = join(worktreeDir, ".ralphai");
      expect(existsSync(symlinkPath)).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    });

    it("worktree clean with no ralphai worktrees", () => {
      gitInitialCommit(testDir);
      const output = runCliOutput(["worktree", "clean"], testDir);
      expect(output).toContain("No ralphai worktrees to clean");
    });

    it("run is blocked when receipt says source=worktree", () => {
      gitInitialCommit(testDir);

      // Set up initialized ralphai with an in-progress plan and receipt
      mkdirSync(join(testDir, ".ralphai", "pipeline", "in-progress"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, "ralphai.json"),
        JSON.stringify({ agentCommand: "claude -p" }) + "\n",
      );
      writeFileSync(
        join(
          testDir,
          ".ralphai",
          "pipeline",
          "in-progress",
          "prd-dark-mode.md",
        ),
        "# Dark mode\n",
      );
      writeFileSync(
        join(
          testDir,
          ".ralphai",
          "pipeline",
          "in-progress",
          "receipt-dark-mode.txt",
        ),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=worktree",
          "worktree_path=/tmp/wt-dark-mode",
          "branch=ralphai/dark-mode",
          "slug=dark-mode",
          "agent=claude -p",
          "turns_completed=3",
        ].join("\n"),
      );

      const result = runCli(["run"], testDir);
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(1);
      expect(combined).toContain('Plan "dark-mode" is running in a worktree');
      expect(combined).toContain("To resume:  ralphai worktree");
    });

    it("worktree is blocked when receipt says source=main", () => {
      gitInitialCommit(testDir);

      mkdirSync(join(testDir, ".ralphai", "pipeline", "in-progress"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, "ralphai.json"),
        JSON.stringify({ agentCommand: "claude -p" }) + "\n",
      );
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "in-progress", "prd-search.md"),
        "# Search\n",
      );
      writeFileSync(
        join(
          testDir,
          ".ralphai",
          "pipeline",
          "in-progress",
          "receipt-search.txt",
        ),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=main",
          "branch=ralphai/search",
          "slug=search",
          "agent=claude -p",
          "turns_completed=1",
        ].join("\n"),
      );

      const result = runCli(["worktree"], testDir);
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(1);
      expect(combined).toContain(
        'Plan "search" is already running in the main repository',
      );
    });

    it("worktree clean archives receipt file", () => {
      gitInitialCommit(testDir);

      mkdirSync(join(testDir, ".ralphai", "pipeline", "in-progress"), {
        recursive: true,
      });

      // Create a worktree with no active plan (so clean will remove it)
      const worktreeDir = join(testDir, "wt-done");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/done HEAD`, {
        cwd: testDir,
        stdio: "ignore",
      });

      // Write a receipt for the slug "done"
      writeFileSync(
        join(
          testDir,
          ".ralphai",
          "pipeline",
          "in-progress",
          "receipt-done.txt",
        ),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=worktree",
          "worktree_path=" + worktreeDir,
          "branch=ralphai/done",
          "slug=done",
          "agent=claude -p",
          "turns_completed=5",
        ].join("\n"),
      );

      const result = runCli(["worktree", "clean"], testDir);
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(combined).toContain("Archived receipt: receipt-done.txt");

      // Receipt should no longer exist in in-progress
      expect(
        existsSync(
          join(
            testDir,
            ".ralphai",
            "pipeline",
            "in-progress",
            "receipt-done.txt",
          ),
        ),
      ).toBe(false);

      // Receipt should exist in out/
      const outDir = join(testDir, ".ralphai", "pipeline", "out");
      expect(existsSync(outDir)).toBe(true);
      const outFiles = readdirSync(outDir);
      const archivedReceipt = outFiles.find((f: string) =>
        f.startsWith("receipt-done-"),
      );
      expect(archivedReceipt).toBeDefined();
    });
  });

  describe("status subcommand", () => {
    it("shows help text with status command listed", () => {
      const result = runCli([], testDir);
      const output = stripLogo(result.stdout);
      expect(output).toContain("status");
    });

    it("status fails when ralphai is not initialized", () => {
      const result = runCli(["status"], testDir);
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).toBe(1);
      expect(combined).toContain("not set up");
    });

    it("status shows empty pipeline", () => {
      // Initialize ralphai
      runCli(["init", "--yes"], testDir);

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("Pipeline");
      expect(output).toContain("Backlog");
      expect(output).toContain("0 plans");
      expect(output).toContain("In Progress");
      expect(output).toContain("Completed");
    });

    it("status shows backlog plans", () => {
      runCli(["init", "--yes"], testDir);

      mkdirSync(join(testDir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-auth.md"),
        "# Auth\n\n### Task 1: Login\n### Task 2: Signup\n",
      );
      writeFileSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "prd-search.md"),
        "---\ndepends-on: [prd-auth.md]\n---\n\n# Search\n\n### Task 1: Index\n",
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("2 plans");
      expect(output).toContain("prd-auth.md");
      expect(output).toContain("prd-search.md");
      expect(output).toContain("waiting on prd-auth.md");
    });

    it("status shows in-progress plan with task progress from receipt", () => {
      runCli(["init", "--yes"], testDir);

      const ipDir = join(testDir, ".ralphai", "pipeline", "in-progress");
      mkdirSync(ipDir, { recursive: true });

      // Plan with 3 tasks
      writeFileSync(
        join(ipDir, "prd-dark-mode.md"),
        "# Dark Mode\n\n### Task 1: Theme\n### Task 2: Toggle\n### Task 3: Persist\n",
      );

      // Progress file with 1 completed task
      writeFileSync(
        join(ipDir, "progress.md"),
        "## Progress Log\n\n### Task 1: Theme\n\n**Status:** Complete\n",
      );

      // Receipt for this plan — includes tasks_completed
      writeFileSync(
        join(ipDir, "receipt-dark-mode.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=worktree",
          "worktree_path=/tmp/wt-dark-mode",
          "branch=ralphai/dark-mode",
          "slug=dark-mode",
          "agent=claude -p",
          "turns_completed=2",
          "tasks_completed=1",
        ].join("\n"),
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("In Progress");
      expect(output).toContain("1 plan");
      expect(output).toContain("prd-dark-mode.md");
      expect(output).toContain("1 of 3 tasks");
      expect(output).toContain("worktree: dark-mode");
    });

    it("status shows 0 tasks_completed for receipt without tasks_completed field", () => {
      runCli(["init", "--yes"], testDir);

      const ipDir = join(testDir, ".ralphai", "pipeline", "in-progress");
      mkdirSync(ipDir, { recursive: true });

      // Plan with 2 tasks
      writeFileSync(
        join(ipDir, "prd-legacy.md"),
        "# Legacy\n\n### Task 1: Migrate\n### Task 2: Validate\n",
      );

      // Receipt WITHOUT tasks_completed (backwards compatibility)
      writeFileSync(
        join(ipDir, "receipt-legacy.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=main",
          "branch=ralphai/legacy",
          "slug=legacy",
          "agent=claude -p",
          "turns_completed=1",
        ].join("\n"),
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("0 of 2 tasks");
    });

    it("status shows tasks_completed from receipt, not progress.md", () => {
      runCli(["init", "--yes"], testDir);

      const ipDir = join(testDir, ".ralphai", "pipeline", "in-progress");
      mkdirSync(ipDir, { recursive: true });

      // Plan with 4 tasks
      writeFileSync(
        join(ipDir, "prd-feature.md"),
        "# Feature\n\n### Task 1: A\n### Task 2: B\n### Task 3: C\n### Task 4: D\n",
      );

      // Progress file with 2 completed tasks
      writeFileSync(
        join(ipDir, "progress.md"),
        "## Progress Log\n\n### Task 1: A\n**Status:** Complete\n\n### Task 2: B\n**Status:** Complete\n",
      );

      // Receipt says 3 tasks completed (receipt is authoritative)
      writeFileSync(
        join(ipDir, "receipt-feature.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=main",
          "branch=ralphai/feature",
          "slug=feature",
          "agent=claude -p",
          "turns_completed=3",
          "tasks_completed=3",
        ].join("\n"),
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      // Should show 3 (from receipt), not 2 (from progress.md parsing)
      expect(output).toContain("3 of 4 tasks");
    });

    it("status shows turns remaining when receipt has turns_budget", () => {
      runCli(["init", "--yes"], testDir);

      const ipDir = join(testDir, ".ralphai", "pipeline", "in-progress");
      mkdirSync(ipDir, { recursive: true });

      // Plan with 2 tasks
      writeFileSync(
        join(ipDir, "prd-search.md"),
        "# Search\n\n### Task 1: Index\n### Task 2: Query\n",
      );

      // Receipt with turns_budget=5, turns_completed=2 → 3 remaining
      writeFileSync(
        join(ipDir, "receipt-search.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=main",
          "branch=ralphai/search",
          "slug=search",
          "agent=claude -p",
          "turns_budget=5",
          "turns_completed=2",
          "tasks_completed=1",
        ].join("\n"),
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("3 turns remaining");
    });

    it("status shows unlimited turns when turns_budget is 0", () => {
      runCli(["init", "--yes"], testDir);

      const ipDir = join(testDir, ".ralphai", "pipeline", "in-progress");
      mkdirSync(ipDir, { recursive: true });

      // Plan with 1 task
      writeFileSync(
        join(ipDir, "prd-refactor.md"),
        "# Refactor\n\n### Task 1: Cleanup\n",
      );

      // Receipt with turns_budget=0 (unlimited)
      writeFileSync(
        join(ipDir, "receipt-refactor.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=main",
          "branch=ralphai/refactor",
          "slug=refactor",
          "agent=claude -p",
          "turns_budget=0",
          "turns_completed=4",
          "tasks_completed=0",
        ].join("\n"),
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("unlimited turns");
    });

    it("status shows no turns info for old receipt without turns_budget", () => {
      runCli(["init", "--yes"], testDir);

      const ipDir = join(testDir, ".ralphai", "pipeline", "in-progress");
      mkdirSync(ipDir, { recursive: true });

      writeFileSync(
        join(ipDir, "prd-old-plan.md"),
        "# Old Plan\n\n### Task 1: Stuff\n",
      );

      // Old receipt without turns_budget field — defaults to 0 in parseReceipt
      writeFileSync(
        join(ipDir, "receipt-old-plan.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=main",
          "branch=ralphai/old-plan",
          "slug=old-plan",
          "agent=claude -p",
          "turns_completed=1",
          "tasks_completed=0",
        ].join("\n"),
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      // Old receipts without turns_budget default to 0, which shows "unlimited turns"
      expect(output).toContain("unlimited turns");
    });

    it("status shows orphaned receipt as a problem", () => {
      runCli(["init", "--yes"], testDir);

      const ipDir = join(testDir, ".ralphai", "pipeline", "in-progress");
      mkdirSync(ipDir, { recursive: true });

      // Receipt with no matching plan file
      writeFileSync(
        join(ipDir, "receipt-orphan.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=main",
          "branch=ralphai/orphan",
          "slug=orphan",
          "agent=claude -p",
          "turns_completed=0",
        ].join("\n"),
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("Problems");
      expect(output).toContain("Orphaned receipt: receipt-orphan.txt");
    });

    it("status counts completed plans from archive", () => {
      runCli(["init", "--yes"], testDir);

      const outDir = join(testDir, ".ralphai", "pipeline", "out");
      mkdirSync(outDir, { recursive: true });

      // Two archived plans (same slug, different timestamps)
      writeFileSync(join(outDir, "prd-auth-20260306-120000.md"), "# Auth\n");
      writeFileSync(
        join(outDir, "prd-search-20260306-130000.md"),
        "# Search\n",
      );

      const result = runCli(["status"], testDir);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain("Completed");
      expect(output).toContain("2 plans");
    });
  });
});
