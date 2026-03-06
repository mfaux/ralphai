import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
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

    // User-owned files (scripts are no longer scaffolded)
    expect(existsSync(join(testDir, ".ralphai", "ralphai.config"))).toBe(true);
    expect(existsSync(join(testDir, ".ralphai", "README.md"))).toBe(true);
    expect(existsSync(join(testDir, ".ralphai", "PLANNING.md"))).toBe(true);
    expect(existsSync(join(testDir, ".ralphai", "LEARNINGS.md"))).toBe(true);

    // Shell scripts should NOT be scaffolded (they run from the package)
    expect(existsSync(join(testDir, ".ralphai", "ralphai.sh"))).toBe(false);
    expect(existsSync(join(testDir, ".ralphai", "lib"))).toBe(false);

    // Subdirectories with .gitkeep
    expect(
      existsSync(join(testDir, ".ralphai", "pipeline", "backlog", ".gitkeep")),
    ).toBe(true);
    expect(
      existsSync(join(testDir, ".ralphai", "pipeline", "wip", ".gitkeep")),
    ).toBe(true);
    expect(
      existsSync(
        join(testDir, ".ralphai", "pipeline", "in-progress", ".gitkeep"),
      ),
    ).toBe(true);
    expect(
      existsSync(join(testDir, ".ralphai", "pipeline", "out", ".gitkeep")),
    ).toBe(true);
  });

  it("init --yes creates .gitignore for plan files", () => {
    runCliOutput(["init", "--yes"], testDir);

    const gitignore = readFileSync(
      join(testDir, ".ralphai", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).toContain("pipeline/backlog/*.md");
    expect(gitignore).toContain("pipeline/wip/*.md");
    expect(gitignore).toContain("pipeline/in-progress/*.md");
    expect(gitignore).toContain("pipeline/in-progress/progress.md");
    expect(gitignore).toContain("pipeline/out/");
    expect(gitignore).toContain("LEARNINGS.md");
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

    const config = readFileSync(
      join(testDir, ".ralphai", "ralphai.config"),
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
      join(testDir, ".ralphai", "ralphai.config"),
      "utf-8",
    );
    expect(config).toContain("agentCommand=claude -p");
  });

  it("sync --yes updates template files when .ralphai/ already exists", () => {
    // First scaffold
    runCliOutput(["init", "--yes"], testDir);

    // Tamper with a template file to verify it gets overwritten
    writeFileSync(join(testDir, ".ralphai", "README.md"), "old content");

    // Write custom config that should be preserved
    const customConfig = "agentCommand=my-custom-agent\nbaseBranch=develop\n";
    writeFileSync(join(testDir, ".ralphai", "ralphai.config"), customConfig);

    // Run sync — should update, not skip
    const output = stripLogo(runCliOutput(["sync", "--yes"], testDir));

    expect(output).toContain("Ralphai synced");
    expect(output).not.toContain("already set up");

    // Template files should be refreshed
    const readme = readFileSync(
      join(testDir, ".ralphai", "README.md"),
      "utf-8",
    );
    expect(readme).not.toBe("old content");

    // Config should be preserved
    const config = readFileSync(
      join(testDir, ".ralphai", "ralphai.config"),
      "utf-8",
    );
    expect(config).toBe(customConfig);
  });

  it("success output contains next steps", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], testDir));

    expect(output).toContain("Ralphai initialized");
    expect(output).toContain("dry-run");
    expect(output).toContain(".ralphai/ralphai.config");
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

      // .ralphai/ should exist in targetDir, NOT in testDir (cwd)
      expect(existsSync(join(targetDir, ".ralphai", "ralphai.config"))).toBe(
        true,
      );
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
    // Usage text should use square brackets (optional) not angle brackets (required)
    expect(config).toContain("[turns-per-plan]");
    expect(config).not.toContain("<turns-per-plan>");
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

  it("sync --yes <target-dir> updates templates if .ralphai/ already exists in target", () => {
    const targetDir = join(tmpdir(), `ralphai-target-exists-${Date.now()}`);
    mkdirSync(join(targetDir, ".ralphai"), { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });

    // Write a template file so sync has something to overwrite
    writeFileSync(join(targetDir, ".ralphai", "README.md"), "old");

    try {
      const output = stripLogo(
        runCliOutput(["sync", "--yes", targetDir], testDir),
      );

      expect(output).toContain("Ralphai synced");

      // README.md should be refreshed from template
      const readme = readFileSync(
        join(targetDir, ".ralphai", "README.md"),
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
  // Sync mode tests
  // -------------------------------------------------------------------------

  it("sync --yes preserves LEARNINGS.md", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Add custom content to LEARNINGS.md
    const customLearnings = "# My Custom Learnings\n\nDo not overwrite me.\n";
    writeFileSync(join(testDir, ".ralphai", "LEARNINGS.md"), customLearnings);

    // Run sync
    runCliOutput(["sync", "--yes"], testDir);

    const learnings = readFileSync(
      join(testDir, ".ralphai", "LEARNINGS.md"),
      "utf-8",
    );
    expect(learnings).toBe(customLearnings);
  });

  it("sync --yes preserves .gitignore", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Modify .gitignore
    const customGitignore = "# custom gitignore\n*.log\n";
    writeFileSync(join(testDir, ".ralphai", ".gitignore"), customGitignore);

    // Run sync
    runCliOutput(["sync", "--yes"], testDir);

    const gitignore = readFileSync(
      join(testDir, ".ralphai", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).toBe(customGitignore);
  });

  it("sync --yes preserves plan directories and files", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Add a plan file to backlog
    writeFileSync(
      join(testDir, ".ralphai", "pipeline", "backlog", "my-plan.md"),
      "# Plan\nDo something.\n",
    );

    // Run sync
    runCliOutput(["sync", "--yes"], testDir);

    // Plan file should still be there
    expect(
      existsSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "my-plan.md"),
      ),
    ).toBe(true);
    const plan = readFileSync(
      join(testDir, ".ralphai", "pipeline", "backlog", "my-plan.md"),
      "utf-8",
    );
    expect(plan).toContain("Do something.");
  });

  it("sync --yes removes old scaffolded scripts (migration)", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Simulate old-style scaffolded scripts that should be cleaned up
    writeFileSync(
      join(testDir, ".ralphai", "ralphai.sh"),
      "#!/bin/bash\necho old-script",
    );
    mkdirSync(join(testDir, ".ralphai", "lib"), { recursive: true });
    writeFileSync(join(testDir, ".ralphai", "lib", "config.sh"), "# old lib");

    // Run sync
    const output = stripLogo(runCliOutput(["sync", "--yes"], testDir));

    // Old scripts should be removed
    expect(existsSync(join(testDir, ".ralphai", "ralphai.sh"))).toBe(false);
    expect(existsSync(join(testDir, ".ralphai", "lib"))).toBe(false);

    // Output should mention removal
    expect(output).toContain("Removed");
    expect(output).toContain("bundled in package");
  });

  it("sync --yes output lists updated and preserved files", () => {
    runCliOutput(["init", "--yes"], testDir);

    const output = stripLogo(runCliOutput(["sync", "--yes"], testDir));

    expect(output).toContain("Updated:");
    expect(output).toContain("README.md");
    expect(output).toContain("PLANNING.md");
    expect(output).toContain("Preserved:");
    expect(output).toContain("ralphai.config");
  });

  // -------------------------------------------------------------------------
  // --force tests
  // -------------------------------------------------------------------------

  it("init --force --yes re-scaffolds from scratch, overwriting ralphai.config", () => {
    runCliOutput(["init", "--yes"], testDir);

    // Write custom config
    writeFileSync(
      join(testDir, ".ralphai", "ralphai.config"),
      "agentCommand=my-agent\n",
    );

    // Force re-scaffold
    const output = stripLogo(
      runCliOutput(["init", "--force", "--yes"], testDir),
    );

    expect(output).toContain("Ralphai initialized");

    // Config should have been overwritten with defaults
    const config = readFileSync(
      join(testDir, ".ralphai", "ralphai.config"),
      "utf-8",
    );
    expect(config).toContain("agentCommand=opencode run --agent build");
    expect(config).not.toContain("my-agent");
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

    // Plan file should be gone (directory was deleted and recreated with only .gitkeep)
    expect(
      existsSync(
        join(testDir, ".ralphai", "pipeline", "backlog", "old-plan.md"),
      ),
    ).toBe(false);
    expect(
      existsSync(join(testDir, ".ralphai", "pipeline", "backlog", ".gitkeep")),
    ).toBe(true);
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
        "utf-8",
      );
      expect(config).toContain("# feedbackCommands=");
    });

    it("leaves feedbackCommands commented out for non-JS projects", () => {
      // No package.json, no deno.json — nothing to detect
      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
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
        join(testDir, ".ralphai", "ralphai.config"),
        "utf-8",
      );
      // pnpm should win because lock file beats packageManager field
      expect(config).toContain("feedbackCommands=pnpm build,pnpm test");
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
    expect(output).toContain("sync");
    expect(output).toContain("uninstall");
  });

  it("init --yes errors when .ralphai/ already exists", () => {
    runCliOutput(["init", "--yes"], testDir);
    // Second init should fail
    const result = runCli(["init", "--yes"], testDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("already set up");
  });

  it("init error message suggests sync and init --force", () => {
    runCliOutput(["init", "--yes"], testDir);
    const result = runCli(["init", "--yes"], testDir);
    expect(result.stderr).toContain("ralphai sync");
    expect(result.stderr).toContain("ralphai init --force");
  });

  it("sync --yes errors when .ralphai/ does not exist", () => {
    const result = runCli(["sync", "--yes"], testDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  it("run errors when .ralphai/ does not exist", () => {
    const result = runCli(["run"], testDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
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
    // Config file loader case
    expect(config).toContain("promptMode)");
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

    it("run without args passes default turn count (5) to ralphai.sh", () => {
      const result = runCli(["run"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:5");
    });

    it("run -- 5 passes explicit turn count to ralphai.sh", () => {
      const result = runCli(["run", "--", "5"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:5");
    });

    it("run -- --dry-run passes flags to ralphai.sh", () => {
      const result = runCli(["run", "--", "--dry-run"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--dry-run");
    });

    it("run -- 5 --resume passes multiple args to ralphai.sh", () => {
      const result = runCli(["run", "--", "5", "--resume"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:5 --resume");
    });

    it("run 3 passes turn count without -- separator", () => {
      const result = runCli(["run", "3"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:3");
    });

    it("run --dry-run passes flags without -- separator", () => {
      const result = runCli(["run", "--dry-run"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--dry-run");
    });

    it("run 3 --resume passes multiple args without -- separator", () => {
      const result = runCli(["run", "3", "--resume"], testDir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:3 --resume");
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
    it("init --yes does not enable issueSource in config", () => {
      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(
        join(testDir, ".ralphai", "ralphai.config"),
        "utf-8",
      );
      expect(config).not.toContain("issueSource=github");
      expect(config).toContain("# issueSource=none");
    });

    it("init --yes config contains issueSource line (commented out)", () => {
      runCliOutput(["init", "--yes"], testDir);

      const config = readFileSync(
        join(testDir, ".ralphai", "ralphai.config"),
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
    expect(result.stdout).toContain("sync");
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
          "---\ngroup: my-feature\n---\n# Plan\n",
        );
        expect(result.stdout).toBe("");
      });

      it("returns exit code 1 when no frontmatter block", () => {
        const result = extractPlanAgent("# Just a plan\nNo frontmatter\n");
        expect(result.exitCode).toBe(1);
      });

      it("extracts agent with other frontmatter keys present", () => {
        const result = extractPlanAgent(
          "---\ngroup: my-feature\nagent: opencode run --agent build\ndepends-on: [prd-a.md]\n---\n# Plan\n",
        );
        expect(result.stdout).toBe("opencode run --agent build");
      });

      it("handles agent as the first frontmatter key", () => {
        const result = extractPlanAgent(
          "---\nagent: codex exec\ngroup: test\n---\n# Plan\n",
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
  // Group mode foundation: extract_group, group-state, collect_group_plans
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains group mode foundation functions", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const plans = readFileSync(join(templateLib, "plans.sh"), "utf-8");
    expect(plans).toContain("extract_group()");
    expect(plans).toContain("write_group_state()");
    expect(plans).toContain("read_group_state()");
    expect(plans).toContain("cleanup_group_state()");
    expect(plans).toContain("collect_group_plans()");
    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    expect(defaults).toContain("GROUP_STATE_FILE=");
  });

  describe.skipIf(process.platform === "win32")(
    "extract_group function",
    () => {
      /** Helper: run extract_group on a temp file with given content */
      function extractGroup(content: string): string {
        const planFile = join(
          tmpdir(),
          `ralphai-test-plan-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
        );
        const script = `#!/bin/bash
extract_group() {
  local file="$1"
  if [[ ! -f "$file" ]] || [[ "$(head -1 "$file" 2>/dev/null)" != "---" ]]; then
    return 0
  fi
  awk '
    BEGIN { in_fm=0 }
    NR==1 && $0=="---" { in_fm=1; next }
    in_fm && $0=="---" { exit }
    in_fm && match($0, /^[[:space:]]*group:[[:space:]]*(.+)/, arr) {
      val=arr[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
      gsub(/^"|"$/, "", val)
      gsub(/^\\047|\\047$/, "", val)
      if (val != "") print val
      exit
    }
  ' "$file"
}
extract_group ${JSON.stringify(planFile)}
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
          return result.trim();
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

      it("extracts group name from frontmatter", () => {
        expect(extractGroup("---\ngroup: my-feature\n---\n# Plan")).toBe(
          "my-feature",
        );
      });

      it("returns empty for no frontmatter", () => {
        expect(extractGroup("# Just a plan\nNo frontmatter")).toBe("");
      });

      it("returns empty for frontmatter without group", () => {
        expect(extractGroup("---\ntitle: something\n---\n# Plan")).toBe("");
      });

      it("handles quoted group value (double quotes)", () => {
        expect(extractGroup('---\ngroup: "my-feature"\n---\n')).toBe(
          "my-feature",
        );
      });

      it("handles quoted group value (single quotes)", () => {
        expect(extractGroup("---\ngroup: 'my-feature'\n---\n")).toBe(
          "my-feature",
        );
      });

      it("handles whitespace around group value", () => {
        expect(extractGroup("---\ngroup:   my-feature  \n---\n")).toBe(
          "my-feature",
        );
      });

      it("returns empty when group value is empty", () => {
        expect(extractGroup("---\ngroup:\n---\n")).toBe("");
      });

      it("extracts group even with other frontmatter keys", () => {
        expect(
          extractGroup(
            "---\ntitle: Plan A\ngroup: shared-feature\ndepends-on: [plan-b.md]\n---\n# Content",
          ),
        ).toBe("shared-feature");
      });
    },
  );

  describe.skipIf(process.platform === "win32")(
    "group-state management functions",
    () => {
      let stateDir: string;

      beforeEach(() => {
        stateDir = join(
          tmpdir(),
          `ralphai-group-state-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        mkdirSync(stateDir, { recursive: true });
      });

      afterEach(() => {
        if (existsSync(stateDir)) {
          rmSync(stateDir, { recursive: true, force: true });
        }
      });

      it("write_group_state creates state file with key=value pairs", () => {
        const stateFile = join(stateDir, ".group-state");
        const script = `#!/bin/bash
WIP_DIR=${JSON.stringify(stateDir)}
GROUP_STATE_FILE="$WIP_DIR/.group-state"
write_group_state() {
  mkdir -p "$WIP_DIR"
  printf '%s\\n' "$@" > "$GROUP_STATE_FILE"
}
write_group_state "group=test-feature" "branch=ralphai/test-feature" "plans_total=3" "plans_completed=1" "current_plan=prd-b.md"
cat "$GROUP_STATE_FILE"
`;
        const scriptFile = join(stateDir, "test.sh");
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
        });

        expect(result.trim()).toBe(
          "group=test-feature\nbranch=ralphai/test-feature\nplans_total=3\nplans_completed=1\ncurrent_plan=prd-b.md",
        );
        expect(existsSync(stateFile)).toBe(true);
      });

      it("read_group_state sets shell variables from state file", () => {
        const stateFile = join(stateDir, ".group-state");
        writeFileSync(
          stateFile,
          "group=my-group\nbranch=ralphai/my-group\nplans_total=5\nplans_completed=2\ncurrent_plan=prd-c.md\npr_url=https://github.com/example/pull/42\n",
        );
        const script = `#!/bin/bash
WIP_DIR=${JSON.stringify(stateDir)}
GROUP_STATE_FILE="$WIP_DIR/.group-state"
GROUP_NAME="" GROUP_BRANCH="" GROUP_PLANS_TOTAL="" GROUP_PLANS_COMPLETED="" GROUP_CURRENT_PLAN="" GROUP_PR_URL=""
read_group_state() {
  [[ -f "$GROUP_STATE_FILE" ]] || return 1
  local line key val
  while IFS='=' read -r key val; do
    [[ -z "$key" || "$key" == \\#* ]] && continue
    case "$key" in
      group)           GROUP_NAME="$val" ;;
      branch)          GROUP_BRANCH="$val" ;;
      plans_total)     GROUP_PLANS_TOTAL="$val" ;;
      plans_completed) GROUP_PLANS_COMPLETED="$val" ;;
      current_plan)    GROUP_CURRENT_PLAN="$val" ;;
      pr_url)          GROUP_PR_URL="$val" ;;
    esac
  done < "$GROUP_STATE_FILE"
}
read_group_state
echo "name=$GROUP_NAME"
echo "branch=$GROUP_BRANCH"
echo "total=$GROUP_PLANS_TOTAL"
echo "completed=$GROUP_PLANS_COMPLETED"
echo "current=$GROUP_CURRENT_PLAN"
echo "pr=$GROUP_PR_URL"
`;
        const scriptFile = join(stateDir, "test.sh");
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
        });

        expect(result.trim()).toBe(
          [
            "name=my-group",
            "branch=ralphai/my-group",
            "total=5",
            "completed=2",
            "current=prd-c.md",
            "pr=https://github.com/example/pull/42",
          ].join("\n"),
        );
      });

      it("read_group_state returns 1 when no state file exists", () => {
        const script = `#!/bin/bash
WIP_DIR=${JSON.stringify(stateDir)}
GROUP_STATE_FILE="$WIP_DIR/.group-state-nonexistent"
read_group_state() {
  [[ -f "$GROUP_STATE_FILE" ]] || return 1
}
read_group_state
echo "exit=$?"
`;
        const scriptFile = join(stateDir, "test.sh");
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
        });

        // read_group_state returns 1, so $? in the echo after is 0 (echo succeeds)
        // but bash -e isn't set, so we need to capture the return code differently
        const script2 = `#!/bin/bash
WIP_DIR=${JSON.stringify(stateDir)}
GROUP_STATE_FILE="$WIP_DIR/.group-state-nonexistent"
read_group_state() {
  [[ -f "$GROUP_STATE_FILE" ]] || return 1
}
read_group_state; echo "exit=$?"
`;
        writeFileSync(scriptFile, script2);
        const result2 = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
        });
        expect(result2.trim()).toBe("exit=1");
      });

      it("cleanup_group_state removes the state file", () => {
        const stateFile = join(stateDir, ".group-state");
        writeFileSync(stateFile, "group=test\n");
        expect(existsSync(stateFile)).toBe(true);

        const script = `#!/bin/bash
WIP_DIR=${JSON.stringify(stateDir)}
GROUP_STATE_FILE="$WIP_DIR/.group-state"
cleanup_group_state() {
  rm -f "$GROUP_STATE_FILE"
}
cleanup_group_state
`;
        const scriptFile = join(stateDir, "test.sh");
        writeFileSync(scriptFile, script);
        execSync(`bash ${JSON.stringify(scriptFile)}`);

        expect(existsSync(stateFile)).toBe(false);
      });

      it("read_group_state ignores comments and unknown keys", () => {
        const stateFile = join(stateDir, ".group-state");
        writeFileSync(
          stateFile,
          "# comment line\ngroup=valid-group\nunknown_key=should-be-ignored\nbranch=ralphai/valid\n",
        );
        const script = `#!/bin/bash
WIP_DIR=${JSON.stringify(stateDir)}
GROUP_STATE_FILE="$WIP_DIR/.group-state"
GROUP_NAME="" GROUP_BRANCH=""
read_group_state() {
  [[ -f "$GROUP_STATE_FILE" ]] || return 1
  local line key val
  while IFS='=' read -r key val; do
    [[ -z "$key" || "$key" == \\#* ]] && continue
    case "$key" in
      group)           GROUP_NAME="$val" ;;
      branch)          GROUP_BRANCH="$val" ;;
      plans_total)     GROUP_PLANS_TOTAL="$val" ;;
      plans_completed) GROUP_PLANS_COMPLETED="$val" ;;
      current_plan)    GROUP_CURRENT_PLAN="$val" ;;
      pr_url)          GROUP_PR_URL="$val" ;;
    esac
  done < "$GROUP_STATE_FILE"
}
read_group_state
echo "name=$GROUP_NAME"
echo "branch=$GROUP_BRANCH"
`;
        const scriptFile = join(stateDir, "test.sh");
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
        });

        expect(result.trim()).toBe("name=valid-group\nbranch=ralphai/valid");
      });
    },
  );

  describe.skipIf(process.platform === "win32")(
    "collect_group_plans function",
    () => {
      let groupDir: string;
      let backlogDir: string;

      beforeEach(() => {
        groupDir = join(
          tmpdir(),
          `ralphai-group-collect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        backlogDir = join(groupDir, "backlog");
        mkdirSync(backlogDir, { recursive: true });
      });

      afterEach(() => {
        if (existsSync(groupDir)) {
          rmSync(groupDir, { recursive: true, force: true });
        }
      });

      /** Helper: build a bash script that defines extract_group, extract_depends_on,
       *  and collect_group_plans, then calls collect_group_plans with the given group name */
      function runCollectGroupPlans(groupName: string, dir: string): string[] {
        const script = `#!/bin/bash
BACKLOG_DIR=${JSON.stringify(join(dir, "backlog"))}

extract_group() {
  local file="$1"
  if [[ ! -f "$file" ]] || [[ "$(head -1 "$file" 2>/dev/null)" != "---" ]]; then
    return 0
  fi
  awk '
    BEGIN { in_fm=0 }
    NR==1 && $0=="---" { in_fm=1; next }
    in_fm && $0=="---" { exit }
    in_fm && match($0, /^[[:space:]]*group:[[:space:]]*(.+)/, arr) {
      val=arr[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
      gsub(/^"|"$/, "", val)
      gsub(/^\\047|\\047$/, "", val)
      if (val != "") print val
      exit
    }
  ' "$file"
}

extract_depends_on() {
  local file="$1"
  if [[ ! -f "$file" ]] || [[ "$(head -1 "$file" 2>/dev/null)" != "---" ]]; then
    return 0
  fi
  awk '
    BEGIN { in_fm=0; dep_mode=0 }
    NR==1 && $0=="---" { in_fm=1; next }
    in_fm && $0=="---" { exit }
    in_fm {
      line=$0
      if (match(line, /^[[:space:]]*depends-on:[[:space:]]*\\[[^\\]]*\\][[:space:]]*$/)) {
        dep_mode=0
        sub(/^[[:space:]]*depends-on:[[:space:]]*\\[/, "", line)
        sub(/\\][[:space:]]*$/, "", line)
        n=split(line, parts, ",")
        for (i=1; i<=n; i++) {
          dep=parts[i]
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", dep)
          if (dep != "") print dep
        }
        next
      }
      if (match(line, /^[[:space:]]*depends-on:[[:space:]]*$/)) {
        dep_mode=1; next
      }
      if (dep_mode == 1 && match(line, /^[[:space:]]*-[[:space:]]+/)) {
        dep=line
        sub(/^[[:space:]]*-[[:space:]]+/, "", dep)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", dep)
        if (dep != "") print dep
        next
      }
      if (dep_mode == 1 && match(line, /^[[:alnum:]_-]+:[[:space:]]*/)) {
        dep_mode=0
      }
    }
  ' "$file"
}

collect_group_plans() {
  local group_name="$1"
  local -a group_files=()
  local -a ordered=()
  local -A seen=()
  local -A deps_map=()
  for f in "$BACKLOG_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    local fg
    fg=$(extract_group "$f")
    if [[ "$fg" == "$group_name" ]]; then
      group_files+=("$f")
      local fb
      fb=$(basename "$f")
      local dep_list
      dep_list=$(extract_depends_on "$f")
      deps_map["$fb"]="$dep_list"
    fi
  done
  local -A group_basenames=()
  for f in "\${group_files[@]}"; do
    group_basenames["$(basename "$f")"]=1
  done
  local -A in_degree=()
  for f in "\${group_files[@]}"; do
    local fb
    fb=$(basename "$f")
    in_degree["$fb"]=0
  done
  for fb in "\${!deps_map[@]}"; do
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      dep=$(basename "$dep")
      if [[ -n "\${group_basenames[$dep]+x}" ]]; then
        in_degree["$fb"]=$(( \${in_degree["$fb"]} + 1 ))
      fi
    done <<< "\${deps_map[$fb]}"
  done
  local -a queue=()
  for fb in "\${!in_degree[@]}"; do
    if [[ \${in_degree["$fb"]} -eq 0 ]]; then
      queue+=("$fb")
    fi
  done
  IFS=$'\\n' queue=($(sort <<< "\${queue[*]}")); unset IFS
  while [[ \${#queue[@]} -gt 0 ]]; do
    local current="\${queue[0]}"
    queue=("\${queue[@]:1}")
    ordered+=("$current")
    seen["$current"]=1
    for fb in "\${!deps_map[@]}"; do
      [[ -n "\${seen[$fb]+x}" ]] && continue
      while IFS= read -r dep; do
        [[ -z "$dep" ]] && continue
        dep=$(basename "$dep")
        if [[ "$dep" == "$current" ]]; then
          in_degree["$fb"]=$(( \${in_degree["$fb"]} - 1 ))
          if [[ \${in_degree["$fb"]} -eq 0 ]]; then
            queue+=("$fb")
          fi
        fi
      done <<< "\${deps_map[$fb]}"
    done
    if [[ \${#queue[@]} -gt 1 ]]; then
      IFS=$'\\n' queue=($(sort <<< "\${queue[*]}")); unset IFS
    fi
  done
  for fb in "\${ordered[@]}"; do
    echo "$BACKLOG_DIR/$fb"
  done
}

collect_group_plans ${JSON.stringify(groupName)}
`;
        const scriptFile = join(dir, "test-collect.sh");
        writeFileSync(scriptFile, script);
        const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
          encoding: "utf-8",
        });
        return result.trim() === "" ? [] : result.trim().split("\n");
      }

      it("collects plans matching the group name", () => {
        writeFileSync(
          join(backlogDir, "prd-a.md"),
          "---\ngroup: feature-x\n---\n# Plan A\n",
        );
        writeFileSync(
          join(backlogDir, "prd-b.md"),
          "---\ngroup: feature-x\n---\n# Plan B\n",
        );
        writeFileSync(
          join(backlogDir, "prd-c.md"),
          "---\ngroup: other-feature\n---\n# Plan C\n",
        );

        const plans = runCollectGroupPlans("feature-x", groupDir);
        expect(plans).toHaveLength(2);
        expect(plans.map((p: string) => p.split("/").pop())).toEqual([
          "prd-a.md",
          "prd-b.md",
        ]);
      });

      it("returns plans in dependency order", () => {
        writeFileSync(
          join(backlogDir, "prd-a.md"),
          "---\ngroup: feature-x\ndepends-on: [prd-b.md]\n---\n# Plan A depends on B\n",
        );
        writeFileSync(
          join(backlogDir, "prd-b.md"),
          "---\ngroup: feature-x\n---\n# Plan B (no deps)\n",
        );

        const plans = runCollectGroupPlans("feature-x", groupDir);
        const names = plans.map((p: string) => p.split("/").pop());
        expect(names).toEqual(["prd-b.md", "prd-a.md"]);
      });

      it("returns empty for non-existent group", () => {
        writeFileSync(
          join(backlogDir, "prd-a.md"),
          "---\ngroup: feature-x\n---\n# Plan A\n",
        );

        const plans = runCollectGroupPlans("nonexistent", groupDir);
        expect(plans).toEqual([]);
      });

      it("handles plans with no frontmatter", () => {
        writeFileSync(
          join(backlogDir, "prd-a.md"),
          "---\ngroup: feature-x\n---\n# Plan A\n",
        );
        writeFileSync(
          join(backlogDir, "prd-no-fm.md"),
          "# No frontmatter plan\n",
        );

        const plans = runCollectGroupPlans("feature-x", groupDir);
        expect(plans).toHaveLength(1);
        expect(plans[0]).toContain("prd-a.md");
      });

      it("handles chain of three dependencies in correct order", () => {
        writeFileSync(
          join(backlogDir, "prd-a.md"),
          "---\ngroup: chain\ndepends-on: [prd-b.md]\n---\n# A depends on B\n",
        );
        writeFileSync(
          join(backlogDir, "prd-b.md"),
          "---\ngroup: chain\ndepends-on: [prd-c.md]\n---\n# B depends on C\n",
        );
        writeFileSync(
          join(backlogDir, "prd-c.md"),
          "---\ngroup: chain\n---\n# C (root)\n",
        );

        const plans = runCollectGroupPlans("chain", groupDir);
        const names = plans.map((p: string) => p.split("/").pop());
        expect(names).toEqual(["prd-c.md", "prd-b.md", "prd-a.md"]);
      });

      it("ignores cross-group dependencies", () => {
        writeFileSync(
          join(backlogDir, "prd-a.md"),
          "---\ngroup: feature-x\ndepends-on: [prd-external.md]\n---\n# A depends on external plan\n",
        );
        writeFileSync(
          join(backlogDir, "prd-b.md"),
          "---\ngroup: feature-x\n---\n# B (no deps)\n",
        );

        const plans = runCollectGroupPlans("feature-x", groupDir);
        const names = plans.map((p: string) => p.split("/").pop());
        // Both should appear; the external dep should not block ordering
        expect(names).toEqual(["prd-a.md", "prd-b.md"]);
      });
    },
  );
});
