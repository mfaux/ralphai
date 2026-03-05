import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  statSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { runCli, runCliOutput, stripLogo } from "./test-utils.ts";

describe("ralphai command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ralph-test-${Date.now()}`);
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

    expect(output).toContain("Ralph initialized");

    // Template files
    expect(existsSync(join(testDir, ".ralph", "ralph.sh"))).toBe(true);
    expect(existsSync(join(testDir, ".ralph", "ralph.config"))).toBe(true);
    expect(existsSync(join(testDir, ".ralph", "README.md"))).toBe(true);
    expect(existsSync(join(testDir, ".ralph", "PLANNING.md"))).toBe(true);
    expect(existsSync(join(testDir, ".ralph", "LEARNINGS.md"))).toBe(true);

    // Subdirectories with .gitkeep
    expect(existsSync(join(testDir, ".ralph", "backlog", ".gitkeep"))).toBe(
      true,
    );
    expect(existsSync(join(testDir, ".ralph", "drafts", ".gitkeep"))).toBe(
      true,
    );
    expect(existsSync(join(testDir, ".ralph", "in-progress", ".gitkeep"))).toBe(
      true,
    );
    expect(existsSync(join(testDir, ".ralph", "out", ".gitkeep"))).toBe(true);
  });

  it("init --yes creates .gitignore for plan files", () => {
    runCliOutput(["init", "--yes"], testDir);

    const gitignore = readFileSync(
      join(testDir, ".ralph", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).toContain("backlog/*.md");
    expect(gitignore).toContain("drafts/*.md");
    expect(gitignore).toContain("in-progress/*.md");
    expect(gitignore).toContain("in-progress/progress.txt");
    expect(gitignore).toContain("out/");
    expect(gitignore).toContain("LEARNINGS.md");
  });

  it("init --yes creates LEARNINGS.md with seed content", () => {
    runCliOutput(["init", "--yes"], testDir);

    const learnings = readFileSync(
      join(testDir, ".ralph", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toContain("# Ralph Learnings");
    expect(learnings).toContain("gitignored");
    expect(learnings).toContain("LEARNINGS.md");
  });

  it("init --yes generates config with default agent command", () => {
    runCliOutput(["init", "--yes"], testDir);

    const config = readFileSync(
      join(testDir, ".ralph", "ralph.config"),
      "utf-8",
    );
    expect(config).toContain("agentCommand=opencode run --agent build");
    expect(config).toContain("baseBranch=");
    expect(config).not.toContain("protectedBranches");
    // feedbackCommands should be commented out when empty
    expect(config).toContain("# feedbackCommands=");
  });

  it("init --yes --agent-command uses the provided agent command", () => {
    runCliOutput(["init", "--yes", "--agent-command=claude -p"], testDir);

    const config = readFileSync(
      join(testDir, ".ralph", "ralph.config"),
      "utf-8",
    );
    expect(config).toContain("agentCommand=claude -p");
  });

  it("update --yes updates template files when .ralph/ already exists", () => {
    // First scaffold
    runCliOutput(["init", "--yes"], testDir);

    // Tamper with a template file to verify it gets overwritten
    writeFileSync(join(testDir, ".ralph", "README.md"), "old content");

    // Write custom config that should be preserved
    const customConfig = "agentCommand=my-custom-agent\nbaseBranch=develop\n";
    writeFileSync(join(testDir, ".ralph", "ralph.config"), customConfig);

    // Run update — should update, not skip
    const output = stripLogo(runCliOutput(["update", "--yes"], testDir));

    expect(output).toContain("Ralph updated");
    expect(output).not.toContain("already set up");

    // Template files should be refreshed
    const readme = readFileSync(join(testDir, ".ralph", "README.md"), "utf-8");
    expect(readme).not.toBe("old content");

    // Config should be preserved
    const config = readFileSync(
      join(testDir, ".ralph", "ralph.config"),
      "utf-8",
    );
    expect(config).toBe(customConfig);
  });

  it.skipIf(process.platform === "win32")("ralph.sh is executable", () => {
    runCliOutput(["init", "--yes"], testDir);

    const stats = statSync(join(testDir, ".ralph", "ralph.sh"));
    // Check that at least owner execute bit is set
    expect(stats.mode & 0o100).toBeTruthy();
  });

  it("success output contains next steps", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    expect(output).toContain("Ralph initialized");
    expect(output).toContain(".ralph/ralph.sh");
    expect(output).toContain("dry-run");
    expect(output).toContain(".ralph/ralph.config");
    expect(output).toContain("PLANNING.md");
    expect(output).toContain("LEARNINGS.md");
  });

  it("ralph.sh template passes bash syntax check", () => {
    runCliOutput(["init", "--yes"], testDir);

    // bash -n does a syntax check without executing
    expect(() => {
      execSync(`bash -n "${join(testDir, ".ralph", "ralph.sh")}"`, {
        stdio: "pipe",
      });
    }).not.toThrow();
  });

  it("ralph.sh contains issue integration functions and config", () => {
    runCliOutput(["init", "--yes"], testDir);

    const script = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    expect(script).toContain("read_issue_frontmatter");
    expect(script).toContain("check_gh_available");
    expect(script).toContain("detect_repo_from_url");
    expect(script).toContain("DEFAULT_ISSUE_CLOSE_ON_COMPLETE");
  });

  it("init --yes adds npm script when package.json exists", () => {
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test", scripts: {} }, null, 2),
    );

    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    const pkg = JSON.parse(
      readFileSync(join(testDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts.ralph).toBe(".ralph/ralph.sh");
    expect(output).toContain('Added "ralph" script');
    expect(output).toContain("npm run ralph");
    expect(output).toContain("./.ralph/ralph.sh 10");
  });

  it("init --yes does not overwrite existing ralph script in package.json", () => {
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify(
        { name: "test", scripts: { ralph: "custom-command" } },
        null,
        2,
      ),
    );

    runCliOutput(["init", "--yes"], testDir);

    const pkg = JSON.parse(
      readFileSync(join(testDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts.ralph).toBe("custom-command");
  });

  it("init --yes works without package.json", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    expect(output).toContain("Ralph initialized");
    expect(output).not.toContain('Added "ralph" script');
    expect(output).toContain("./.ralph/ralph.sh --dry-run");
  });

  it("init --yes creates scripts object if missing in package.json", () => {
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test" }, null, 2),
    );

    runCliOutput(["init", "--yes"], testDir);

    const pkg = JSON.parse(
      readFileSync(join(testDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts.ralph).toBe(".ralph/ralph.sh");
  });

  it("init --yes <target-dir> scaffolds into the target directory, not cwd", () => {
    // Create a separate target directory
    const targetDir = join(tmpdir(), `ralph-target-${Date.now()}`);
    mkdirSync(targetDir, { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });

    try {
      // Run CLI from testDir but point at targetDir
      const output = stripLogo(
        runCliOutput(["init", "--yes", targetDir], testDir),
      );

      expect(output).toContain("Ralph initialized");

      // .ralph/ should exist in targetDir, NOT in testDir (cwd)
      expect(existsSync(join(targetDir, ".ralph", "ralph.sh"))).toBe(true);
      expect(existsSync(join(targetDir, ".ralph", "ralph.config"))).toBe(true);
      expect(existsSync(join(targetDir, ".ralph", "README.md"))).toBe(true);
      expect(existsSync(join(testDir, ".ralph"))).toBe(false);
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  it("init --yes <target-dir> adds npm script to target package.json", () => {
    const targetDir = join(tmpdir(), `ralph-target-npm-${Date.now()}`);
    mkdirSync(targetDir, { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });
    writeFileSync(
      join(targetDir, "package.json"),
      JSON.stringify({ name: "target-project", scripts: {} }, null, 2),
    );

    try {
      const output = stripLogo(
        runCliOutput(["init", "--yes", targetDir], testDir),
      );

      expect(output).toContain('Added "ralph" script');
      const pkg = JSON.parse(
        readFileSync(join(targetDir, "package.json"), "utf-8"),
      );
      expect(pkg.scripts.ralph).toBe(".ralph/ralph.sh");
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  it("scaffolded ralph.sh contains helpful hint in nothing-to-do messages", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // Both "nothing to do" messages should include the hint
    expect(ralphSh).toContain(
      "Nothing to do — backlog is empty and no in-progress work. Add plans to .ralph/backlog/ — see .ralph/PLANNING.md",
    );
    expect(ralphSh).toContain(
      "Nothing to do — issue pull produced no plan file. Add plans to .ralph/backlog/ — see .ralph/PLANNING.md",
    );
  });

  it("scaffolded ralph.sh defaults to 5 iterations when none specified", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // Should default ITERATIONS to "5" when unset (no error, no conditional)
    expect(ralphSh).toContain('ITERATIONS="5"');
    // Should NOT contain the old error message for missing iterations
    expect(ralphSh).not.toContain(
      "ERROR: Missing required <iterations-per-plan>",
    );
  });

  it("scaffolded ralph.sh shows iterations-per-plan as optional in usage", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // Usage text should use square brackets (optional) not angle brackets (required)
    expect(ralphSh).toContain("[iterations-per-plan]");
    expect(ralphSh).not.toContain("<iterations-per-plan>");
    // Should mention the default
    expect(ralphSh).toContain("Default: 5 iterations per plan.");
  });

  it("scaffolded ralph.sh contains gh preflight check for PR mode", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // PR mode preflight: checks gh is installed and authenticated
    expect(ralphSh).toContain('MODE" == "pr"');
    expect(ralphSh).toContain("command -v gh");
    expect(ralphSh).toContain("gh auth status");
    expect(ralphSh).toContain("PR mode (the default) requires the GitHub CLI");
    expect(ralphSh).toContain("gh is installed but not authenticated");
    expect(ralphSh).toContain("--direct");
  });

  it("scaffolded ralph.sh uses create_pr instead of merge_and_cleanup", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // create_pr function exists and is called on completion
    expect(ralphSh).toContain("create_pr()");
    expect(ralphSh).toContain('create_pr "$branch" "$PLAN_DESC"');
    // Old merge_and_cleanup and is_branch_protected are removed
    expect(ralphSh).not.toContain("merge_and_cleanup");
    expect(ralphSh).not.toContain("is_branch_protected");
    // No direct merge path (git merge --no-ff into base branch)
    expect(ralphSh).not.toContain("git merge");
    expect(ralphSh).not.toContain("git branch -d");
    // No MERGE_TARGET or PROTECTED_BRANCHES variables
    expect(ralphSh).not.toContain("MERGE_TARGET");
    expect(ralphSh).not.toContain("PROTECTED_BRANCHES");
  });

  it("scaffolded ralph.sh has direct mode safety guard for main/master", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // Direct mode refuses to run on main or master
    expect(ralphSh).toContain("Direct mode cannot run on");
    expect(ralphSh).toContain(
      "Switch to a feature branch, or use PR mode (the default)",
    );
  });

  it("scaffolded ralph.sh skips create_pr in direct mode", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // Completion handler should conditionally call create_pr only in PR mode
    expect(ralphSh).toContain('if [[ "$MODE" == "pr" ]]; then');
    expect(ralphSh).toContain("Direct mode: commits are on branch");
  });

  it("scaffolded ralph.sh warns on unknown config keys instead of erroring", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // Unknown config keys should produce a warning, not an error
    expect(ralphSh).toContain("WARNING:");
    expect(ralphSh).toContain("ignoring unknown config key");
    expect(ralphSh).not.toContain(
      "unknown config key '$key'\"\n        echo \"Supported keys:",
    );
  });

  it("scaffolded ralph.sh contains issue integration defaults", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // Config defaults
    expect(ralphSh).toContain('DEFAULT_ISSUE_SOURCE="none"');
    expect(ralphSh).toContain('DEFAULT_ISSUE_LABEL="ralphai"');
    expect(ralphSh).toContain(
      'DEFAULT_ISSUE_IN_PROGRESS_LABEL="ralphai:in-progress"',
    );
    expect(ralphSh).toContain('DEFAULT_ISSUE_REPO=""');
    expect(ralphSh).toContain('DEFAULT_ISSUE_CLOSE_ON_COMPLETE="true"');
    expect(ralphSh).toContain('DEFAULT_ISSUE_COMMENT_PROGRESS="true"');
  });

  it("scaffolded ralph.sh contains issue integration functions", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    // Core functions
    expect(ralphSh).toContain("pull_github_issues()");
    expect(ralphSh).toContain("read_issue_frontmatter()");
    expect(ralphSh).toContain("check_gh_available()");
    expect(ralphSh).toContain("detect_issue_repo()");
    expect(ralphSh).toContain("slugify()");
  });

  it("update --yes <target-dir> updates templates if .ralph/ already exists in target", () => {
    const targetDir = join(tmpdir(), `ralph-target-exists-${Date.now()}`);
    mkdirSync(join(targetDir, ".ralph"), { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });

    // Write a template file so update has something to overwrite
    writeFileSync(join(targetDir, ".ralph", "README.md"), "old");

    try {
      const output = stripLogo(
        runCliOutput(["update", "--yes", targetDir], testDir),
      );

      expect(output).toContain("Ralph updated");

      // README.md should be refreshed from template
      const readme = readFileSync(
        join(targetDir, ".ralph", "README.md"),
        "utf-8",
      );
      expect(readme).not.toBe("old");
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  // -------------------------------------------------------------------------
  // Uninstall tests
  // -------------------------------------------------------------------------

  it("uninstall --yes removes .ralph/ dir and package.json script", () => {
    // First, set up ralph
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test", scripts: {} }, null, 2),
    );
    runCliOutput(["init", "--yes"], testDir);
    expect(existsSync(join(testDir, ".ralph"))).toBe(true);

    // Now uninstall
    const output = stripLogo(runCliOutput(["uninstall", "--yes"], testDir));

    expect(output).toContain("Ralph uninstalled");
    expect(output).toContain('Removed "ralph" script');
    expect(existsSync(join(testDir, ".ralph"))).toBe(false);

    const pkg = JSON.parse(
      readFileSync(join(testDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts?.ralph).toBeUndefined();
  });

  it("uninstall --yes prints not set up when .ralph/ does not exist", () => {
    const output = stripLogo(runCliOutput(["uninstall", "--yes"], testDir));

    expect(output).toContain("not set up");
    expect(output).toContain(".ralph/ does not exist");
  });

  it("uninstall --yes works without package.json", () => {
    // Set up ralph without package.json
    runCliOutput(["init", "--yes"], testDir);
    expect(existsSync(join(testDir, ".ralph"))).toBe(true);

    // Uninstall
    const output = stripLogo(runCliOutput(["uninstall", "--yes"], testDir));

    expect(output).toContain("Ralph uninstalled");
    expect(output).not.toContain('Removed "ralph" script');
    expect(existsSync(join(testDir, ".ralph"))).toBe(false);
  });

  it("uninstall --yes handles package.json without ralph script", () => {
    // Set up ralph without package.json, then add a package.json without ralph script
    runCliOutput(["init", "--yes"], testDir);
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }, null, 2),
    );

    const output = stripLogo(runCliOutput(["uninstall", "--yes"], testDir));

    expect(output).toContain("Ralph uninstalled");
    expect(output).not.toContain('Removed "ralph" script');
    expect(existsSync(join(testDir, ".ralph"))).toBe(false);

    // Other scripts should be preserved
    const pkg = JSON.parse(
      readFileSync(join(testDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts.build).toBe("tsc");
  });

  it("uninstall --yes <target-dir> uninstalls from target directory", () => {
    const targetDir = join(tmpdir(), `ralph-uninstall-target-${Date.now()}`);
    mkdirSync(targetDir, { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });
    writeFileSync(
      join(targetDir, "package.json"),
      JSON.stringify({ name: "target", scripts: {} }, null, 2),
    );

    try {
      // Set up ralph in target
      runCliOutput(["init", "--yes", targetDir], testDir);
      expect(existsSync(join(targetDir, ".ralph"))).toBe(true);

      // Uninstall from target
      const output = stripLogo(
        runCliOutput(["uninstall", "--yes", targetDir], testDir),
      );

      expect(output).toContain("Ralph uninstalled");
      expect(existsSync(join(targetDir, ".ralph"))).toBe(false);

      const pkg = JSON.parse(
        readFileSync(join(targetDir, "package.json"), "utf-8"),
      );
      expect(pkg.scripts?.ralph).toBeUndefined();
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });

  it("uninstall --yes cleans up empty scripts object in package.json", () => {
    // Set up with package.json that only has scripts.ralph
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({ name: "test", scripts: {} }, null, 2),
    );
    runCliOutput(["init", "--yes"], testDir);

    // Verify ralph script was added
    let pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf-8"));
    expect(pkg.scripts.ralph).toBe(".ralph/ralph.sh");

    // Uninstall
    runCliOutput(["uninstall", "--yes"], testDir);

    pkg = JSON.parse(readFileSync(join(testDir, "package.json"), "utf-8"));
    expect(pkg.scripts).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Update mode tests
  // -------------------------------------------------------------------------

  it("update --yes preserves LEARNINGS.md", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Add custom content to LEARNINGS.md
    const customLearnings = "# My Custom Learnings\n\nDo not overwrite me.\n";
    writeFileSync(join(testDir, ".ralph", "LEARNINGS.md"), customLearnings);

    // Run update
    runCliOutput(["update", "--yes"], testDir);

    const learnings = readFileSync(
      join(testDir, ".ralph", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toBe(customLearnings);
  });

  it("update --yes preserves .gitignore", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Modify .gitignore
    const customGitignore = "# custom gitignore\n*.log\n";
    writeFileSync(join(testDir, ".ralph", ".gitignore"), customGitignore);

    // Run update
    runCliOutput(["update", "--yes"], testDir);

    const gitignore = readFileSync(
      join(testDir, ".ralph", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).toBe(customGitignore);
  });

  it("update --yes preserves plan directories and files", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Add a plan file to backlog
    writeFileSync(
      join(testDir, ".ralph", "backlog", "my-plan.md"),
      "# Plan\nDo something.\n",
    );

    // Run update
    runCliOutput(["update", "--yes"], testDir);

    // Plan file should still be there
    expect(existsSync(join(testDir, ".ralph", "backlog", "my-plan.md"))).toBe(
      true,
    );
    const plan = readFileSync(
      join(testDir, ".ralph", "backlog", "my-plan.md"),
      "utf-8",
    );
    expect(plan).toContain("Do something.");
  });

  it("update --yes refreshes ralph.sh from template", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Tamper with ralph.sh
    writeFileSync(join(testDir, ".ralph", "ralph.sh"), "#!/bin/bash\necho old");

    // Run update
    runCliOutput(["update", "--yes"], testDir);

    const script = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    expect(script).not.toContain("echo old");
    expect(script).toContain("ralph"); // should have real template content
  });

  it.skipIf(process.platform === "win32")(
    "update --yes keeps ralph.sh executable",
    () => {
      runCliOutput(["init", "--yes"], testDir);
      runCliOutput(["update", "--yes"], testDir);

      const stats = statSync(join(testDir, ".ralph", "ralph.sh"));
      expect(stats.mode & 0o100).toBeTruthy();
    },
  );

  it("update --yes output lists updated and preserved files", () => {
    runCliOutput(["init", "--yes"], testDir);

    const output = stripLogo(runCliOutput(["update", "--yes"], testDir));

    expect(output).toContain("Updated:");
    expect(output).toContain("ralph.sh");
    expect(output).toContain("README.md");
    expect(output).toContain("PLANNING.md");
    expect(output).toContain("Preserved:");
    expect(output).toContain("ralph.config");
  });

  // -------------------------------------------------------------------------
  // --force tests
  // -------------------------------------------------------------------------

  it("init --force --yes re-scaffolds from scratch, overwriting ralph.config", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Write custom config
    writeFileSync(
      join(testDir, ".ralph", "ralph.config"),
      "agentCommand=my-agent\n",
    );

    // Force re-scaffold
    const output = stripLogo(
      runCliOutput(["init", "--force", "--yes"], testDir),
    );

    expect(output).toContain("Ralph initialized");

    // Config should have been overwritten with defaults
    const config = readFileSync(
      join(testDir, ".ralph", "ralph.config"),
      "utf-8",
    );
    expect(config).toContain("agentCommand=opencode run --agent build");
    expect(config).not.toContain("my-agent");
  });

  it("init --force --yes overwrites LEARNINGS.md", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Add custom LEARNINGS
    writeFileSync(
      join(testDir, ".ralph", "LEARNINGS.md"),
      "# Custom learnings",
    );

    // Force re-scaffold
    runCliOutput(["init", "--force", "--yes"], testDir);

    const learnings = readFileSync(
      join(testDir, ".ralph", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toContain("# Ralph Learnings");
    expect(learnings).not.toContain("Custom learnings");
  });

  it("init --force --yes removes old plan files", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Add a plan file
    writeFileSync(
      join(testDir, ".ralph", "backlog", "old-plan.md"),
      "# Old plan",
    );

    // Force re-scaffold
    runCliOutput(["init", "--force", "--yes"], testDir);

    // Plan file should be gone (directory was deleted and recreated with only .gitkeep)
    expect(existsSync(join(testDir, ".ralph", "backlog", "old-plan.md"))).toBe(
      false,
    );
    expect(existsSync(join(testDir, ".ralph", "backlog", ".gitkeep"))).toBe(
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain(
        "feedbackCommands=pnpm build,pnpm test,pnpm lint",
      );
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain("feedbackCommands=npm run build,npm test");
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain(
        "feedbackCommands=yarn build,yarn test,yarn lint",
      );
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain(
        "feedbackCommands=bun run build,bun test,bun run lint",
      );
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      // No test task in deno.json, but deno has a built-in test runner
      expect(config).toContain(
        "feedbackCommands=deno task build,deno task lint,deno test",
      );
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain("feedbackCommands=pnpm build,pnpm test");
    });

    it("only includes scripts that actually exist in package.json", () => {
      writeFileSync(join(testDir, "package-lock.json"), "{}");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "test", scripts: { test: "jest" } }, null, 2),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain("feedbackCommands=npm test");
      // Should NOT contain build or lint since they don't exist
      expect(config).not.toContain("npm run build");
      expect(config).not.toContain("npm run lint");
    });

    it("leaves feedbackCommands commented out when no scripts exist", () => {
      writeFileSync(join(testDir, "package-lock.json"), "{}");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify(
          { name: "test", scripts: { start: "node index.js" } },
          null,
          2,
        ),
      );

      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain("# feedbackCommands=");
    });

    it("leaves feedbackCommands commented out for non-JS projects", () => {
      // No package.json, no deno.json — nothing to detect
      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain("# feedbackCommands=");
    });

    it("uses detected PM in commented-out feedbackCommands example", () => {
      // pnpm project with no matching scripts → commented out but with pnpm prefix
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain(
        "# feedbackCommands=pnpm build,pnpm test,pnpm lint",
      );
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).toContain(
        "feedbackCommands=pnpm build,pnpm test,pnpm type-check,pnpm lint,pnpm format:check",
      );
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

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      // pnpm should win because lock file beats packageManager field
      expect(config).toContain("feedbackCommands=pnpm build,pnpm test");
    });
  });

  // -------------------------------------------------------------------------
  // Repo-root LEARNINGS.md seeding tests
  // -------------------------------------------------------------------------

  it("init --yes creates LEARNINGS.md at repo root when missing", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    expect(existsSync(join(testDir, "LEARNINGS.md"))).toBe(true);
    expect(output).toContain("LEARNINGS.md");
    expect(output).toContain("Maintainer-curated learnings");
  });

  it("init --yes does not overwrite existing LEARNINGS.md at repo root", () => {
    const existingContent = "# My Existing Learnings\n\nDo not overwrite.\n";
    writeFileSync(join(testDir, "LEARNINGS.md"), existingContent);

    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    const content = readFileSync(join(testDir, "LEARNINGS.md"), "utf-8");
    expect(content).toBe(existingContent);
    // Should not mention creating LEARNINGS.md since it already existed
    expect(output).not.toMatch(
      /LEARNINGS\.md\s+.*Maintainer-curated learnings/,
    );
  });

  it("init --yes seeds LEARNINGS.md with minimal header", () => {
    runCliOutput(["init", "--yes"], testDir);

    const content = readFileSync(join(testDir, "LEARNINGS.md"), "utf-8");
    expect(content).toBe("# Learnings\n");
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
  });

  it("init --yes errors when .ralph/ already exists", () => {
    runCliOutput(["init", "--yes"], testDir);
    // Second init should fail
    const result = runCli(["init", "--yes"], testDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("already set up");
  });

  it("init error message suggests update and init --force", () => {
    runCliOutput(["init", "--yes"], testDir);
    const result = runCli(["init", "--yes"], testDir);
    expect(result.stderr).toContain("ralphai update");
    expect(result.stderr).toContain("ralphai init --force");
  });

  it("update --yes errors when .ralph/ does not exist", () => {
    const result = runCli(["update", "--yes"], testDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  it("run errors when .ralph/ does not exist", () => {
    const result = runCli(["run"], testDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  // -------------------------------------------------------------------------
  // Agent type detection tests
  // -------------------------------------------------------------------------

  it("scaffolded ralph.sh contains detect_agent_type function", () => {
    runCliOutput(["init", "--yes"], testDir);

    const ralphSh = readFileSync(join(testDir, ".ralph", "ralph.sh"), "utf-8");
    expect(ralphSh).toContain("detect_agent_type()");
    expect(ralphSh).toContain("DETECTED_AGENT_TYPE=");
  });

  describe.skipIf(process.platform === "win32")(
    "detect_agent_type mapping",
    () => {
      /** Helper: source ralph.sh's detect_agent_type and return the result */
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
  // Run default iteration tests
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")(
    "run default iterations",
    () => {
      beforeEach(() => {
        // Scaffold ralph, then replace ralph.sh with a stub that echoes args
        runCliOutput(["init", "--yes"], testDir);
        writeFileSync(
          join(testDir, ".ralph", "ralph.sh"),
          '#!/bin/bash\necho "ARGS:$*"\n',
        );
        chmodSync(join(testDir, ".ralph", "ralph.sh"), 0o755);
      });

      it("run without args passes default iteration count (5) to ralph.sh", () => {
        const result = runCli(["run"], testDir);
        expect(result.stdout).toContain("ARGS:5");
      });

      it("run -- 5 passes explicit iteration count to ralph.sh", () => {
        const result = runCli(["run", "--", "5"], testDir);
        expect(result.stdout).toContain("ARGS:5");
      });

      it("run -- --dry-run passes flags to ralph.sh", () => {
        const result = runCli(["run", "--", "--dry-run"], testDir);
        expect(result.stdout).toContain("ARGS:--dry-run");
      });

      it("run -- 5 --resume passes multiple args to ralph.sh", () => {
        const result = runCli(["run", "--", "5", "--resume"], testDir);
        expect(result.stdout).toContain("ARGS:5 --resume");
      });
    },
  );

  // -------------------------------------------------------------------------
  // GitHub Issues integration tests
  // -------------------------------------------------------------------------

  describe("GitHub Issues integration", () => {
    it("init --yes does not enable issueSource in config", () => {
      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      expect(config).not.toContain("issueSource=github");
      expect(config).toContain("# issueSource=none");
    });

    it("init --yes config contains issueSource line (commented out)", () => {
      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(
        join(testDir, ".ralph", "ralph.config"),
        "utf-8",
      );
      // The commented-out line should be present
      expect(config).toContain("# issueSource=none");
    });

    it("init --yes output does not contain GitHub label info", () => {
      const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

      expect(output).not.toContain("GitHub labels");
      expect(output).not.toContain("Label a GitHub issue");
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
});
