import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
} from "fs";
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

describe("worktree", () => {
  // -------------------------------------------------------------------------
  // Worktree detection (has its own mainRepo/worktreeDir setup)
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

      // Run --show-config from worktree — should find .ralphai/ and
      // ralphai.json in the main repo and resolve config successfully
      const result = runCli(["run", "--show-config"], worktreeDir);
      expect(result.exitCode).toBe(0);
      // Config output should include the agent command from the main repo's config
      expect(result.stdout).toContain("agentCommand");
      // Should detect that we're in a worktree
      expect(result.stdout).toContain("worktree");
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
        // Config falls back to main repo's absolute path (manual worktree without symlink)
        expect(result).toContain(`CONFIG_FILE=${mainRepo}/ralphai.json`);
        expect(result).toContain(
          `PROGRESS_FILE=${mainRepo}/.ralphai/pipeline/in-progress/<slug>/progress.md`,
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
          "PROGRESS_FILE=.ralphai/pipeline/in-progress/<slug>/progress.md",
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
          "PROGRESS_FILE=.ralphai/pipeline/in-progress/<slug>/progress.md",
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
  // Worktree subcommand (uses shared testDir via useTempGitDir)
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("worktree subcommand", () => {
    const ctx = useTempGitDir();

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
      const result = runCli([], ctx.dir);
      const output = stripLogo(result.stdout);
      expect(output).toContain("worktree");
    });

    it("worktree --help shows worktree-specific help", () => {
      const output = runCliOutput(["worktree", "--help"], ctx.dir);
      expect(output).toContain("ralphai worktree");
      expect(output).toContain("list");
      expect(output).toContain("clean");
      expect(output).toContain("--plan=");
      expect(output).toContain("--dir=");
      expect(output).toContain("--turns=<n>");
    });

    it("worktree refuses inside a worktree", () => {
      // Set up a main repo with a worktree
      gitInitialCommit(ctx.dir);
      const worktreeDir = join(ctx.dir, "wt");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/test HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // Initialize ralphai so the worktree guard runs (it checks before .ralphai)
      // Create a minimal .ralphai in main repo so worktree resolves
      const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
      mkdirSync(backlogDir, { recursive: true });
      writeFileSync(join(backlogDir, "prd-test.md"), "# Test plan\n");

      const result = runCli(["worktree"], worktreeDir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("must be run from the main repository");

      // Clean up worktree
      execSync(`git worktree remove "${worktreeDir}"`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
    });

    it("worktree errors when .ralphai is not set up", () => {
      gitInitialCommit(ctx.dir);
      const result = runCli(["worktree"], ctx.dir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not set up");
    });

    it("worktree errors with no backlog plans", () => {
      gitInitialCommit(ctx.dir);
      // Create .ralphai with empty backlog
      mkdirSync(join(ctx.dir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });

      const result = runCli(["worktree"], ctx.dir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("No plans in backlog");
    });

    it("worktree --plan=nonexistent.md errors", () => {
      gitInitialCommit(ctx.dir);
      mkdirSync(join(ctx.dir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });

      const result = runCli(["worktree", "--plan=nonexistent.md"], ctx.dir);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found in backlog");
    });

    it("worktree list shows no worktrees initially", () => {
      gitInitialCommit(ctx.dir);
      const output = runCliOutput(["worktree", "list"], ctx.dir);
      expect(output).toContain("No active ralphai worktrees");
    });

    it("worktree list shows ralphai worktrees", () => {
      gitInitialCommit(ctx.dir);

      // Create a worktree on a ralphai/* branch
      const wtPath = join(ctx.dir, "wt-list-test");
      execSync(`git worktree add "${wtPath}" -b ralphai/my-feature HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      const output = runCliOutput(["worktree", "list"], ctx.dir);
      expect(output).toContain("ralphai/my-feature");
      expect(output).toContain(wtPath);

      // Clean up
      execSync(`git worktree remove "${wtPath}"`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
    });

    it("worktree clean removes completed worktrees", () => {
      gitInitialCommit(ctx.dir);

      // Create a worktree on a ralphai/* branch
      const wtPath = join(ctx.dir, "wt-clean-test");
      execSync(`git worktree add "${wtPath}" -b ralphai/done-feature HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // No .ralphai/pipeline/in-progress/done-feature/done-feature.md exists,
      // so it should be cleaned
      const output = runCliOutput(["worktree", "clean"], ctx.dir);
      expect(output).toContain("Removing:");
      expect(output).toContain("Cleaned 1 worktree(s)");
      expect(existsSync(wtPath)).toBe(false);
    });

    it("worktree clean preserves in-progress worktrees", () => {
      gitInitialCommit(ctx.dir);

      // Create a worktree on a ralphai/* branch
      // Slug is now filename minus .md, so prd-active-feature.md -> slug prd-active-feature
      const wtPath = join(ctx.dir, "wt-keep-test");
      execSync(
        `git worktree add "${wtPath}" -b ralphai/prd-active-feature HEAD`,
        {
          cwd: ctx.dir,
          stdio: "ignore",
        },
      );

      // Create matching in-progress plan
      const inProgressDir = join(
        ctx.dir,
        ".ralphai",
        "pipeline",
        "in-progress",
      );
      const planDir = join(inProgressDir, "prd-active-feature");
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, "prd-active-feature.md"), "# Active plan\n");

      const output = runCliOutput(["worktree", "clean"], ctx.dir);
      expect(output).toContain("Keeping:");
      expect(output).toContain("plan still in progress");
      expect(existsSync(wtPath)).toBe(true);

      // Clean up
      execSync(`git worktree remove "${wtPath}"`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
    });

    it("worktree --plan selects a specific plan", () => {
      gitInitialCommit(ctx.dir);

      // Create .ralphai with two plans
      const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
      mkdirSync(backlogDir, { recursive: true });
      writeFileSync(join(backlogDir, "prd-first.md"), "# First\n");
      writeFileSync(join(backlogDir, "prd-second.md"), "# Second\n");

      // Use RALPHAI_AGENT_COMMAND=true so the runner exits quickly (1 turn)
      const result = runCli(
        ["worktree", "--plan=prd-second.md", "--turns=1"],
        ctx.dir,
        { RALPHAI_AGENT_COMMAND: "true" },
        30000,
      );

      // The output should mention the second plan's slug, not the first
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("ralphai/prd-second");
    });

    it("worktree creates .ralphai symlink in worktree directory", () => {
      gitInitialCommit(ctx.dir);

      // Create .ralphai with a plan
      const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
      mkdirSync(backlogDir, { recursive: true });
      writeFileSync(
        join(backlogDir, "prd-symlink-test.md"),
        "# Symlink test\n",
      );

      // Use --dir to place worktree inside ctx.dir (auto-cleaned by afterEach)
      const worktreeDir = join(ctx.dir, "wt-symlink");

      const result = runCli(
        [
          "worktree",
          "--plan=prd-symlink-test.md",
          `--dir=${worktreeDir}`,
          "--turns=1",
        ],
        ctx.dir,
        { RALPHAI_AGENT_COMMAND: "true" },
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
      expect(readlinkSync(symlinkPath)).toBe(join(ctx.dir, ".ralphai"));
    });

    it("worktree creates ralphai.json symlink when config is not committed", () => {
      gitInitialCommit(ctx.dir);

      // Create .ralphai with a plan
      const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
      mkdirSync(backlogDir, { recursive: true });
      writeFileSync(
        join(backlogDir, "prd-config-symlink.md"),
        "# Config symlink test\n",
      );

      // Create ralphai.json in main repo (not committed)
      writeFileSync(
        join(ctx.dir, "ralphai.json"),
        JSON.stringify({ runner: "opencode" }),
      );

      const worktreeDir = join(ctx.dir, "wt-config-symlink");

      const result = runCli(
        [
          "worktree",
          "--plan=prd-config-symlink.md",
          `--dir=${worktreeDir}`,
          "--turns=1",
        ],
        ctx.dir,
        { RALPHAI_AGENT_COMMAND: "true" },
        30000,
      );

      const combined = result.stdout + result.stderr;

      // Verify the ralphai.json symlink was created
      const configSymlink = join(worktreeDir, "ralphai.json");
      expect(
        existsSync(configSymlink),
        `ralphai.json symlink not found at ${configSymlink}. CLI output: ${combined}`,
      ).toBe(true);
      expect(lstatSync(configSymlink).isSymbolicLink()).toBe(true);
      expect(readlinkSync(configSymlink)).toBe(join(ctx.dir, "ralphai.json"));
    });

    it("worktree skips ralphai.json symlink when config is committed", () => {
      gitInitialCommit(ctx.dir);

      // Create .ralphai with a plan
      const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
      mkdirSync(backlogDir, { recursive: true });
      writeFileSync(
        join(backlogDir, "prd-committed-cfg.md"),
        "# Committed config test\n",
      );

      // Create and commit ralphai.json
      writeFileSync(
        join(ctx.dir, "ralphai.json"),
        JSON.stringify({ runner: "opencode" }),
      );
      execSync("git add ralphai.json && git commit -m 'add config'", {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      const worktreeDir = join(ctx.dir, "wt-committed-cfg");

      runCli(
        [
          "worktree",
          "--plan=prd-committed-cfg.md",
          `--dir=${worktreeDir}`,
          "--turns=1",
        ],
        ctx.dir,
        { RALPHAI_AGENT_COMMAND: "true" },
        30000,
      );

      // ralphai.json should exist (checked out by git) but NOT be a symlink
      const configPath = join(worktreeDir, "ralphai.json");
      expect(existsSync(configPath)).toBe(true);
      expect(lstatSync(configPath).isSymbolicLink()).toBe(false);
    });

    it("worktree replaces existing .ralphai dir with symlink", () => {
      gitInitialCommit(ctx.dir);

      // Create .ralphai with a plan (not git-tracked since .ralphai/ is gitignored)
      const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
      mkdirSync(backlogDir, { recursive: true });
      writeFileSync(
        join(backlogDir, "prd-tracked-test.md"),
        "# Tracked test\n",
      );

      const worktreeDir = join(ctx.dir, "wt-tracked");

      const result = runCli(
        [
          "worktree",
          "--plan=prd-tracked-test.md",
          `--dir=${worktreeDir}`,
          "--turns=1",
        ],
        ctx.dir,
        { RALPHAI_AGENT_COMMAND: "true" },
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
      expect(readlinkSync(symlinkPath)).toBe(join(ctx.dir, ".ralphai"));
    });

    it("is_tree_dirty ignores .ralphai changes (gitignored) but catches real dirty state", () => {
      gitInitialCommit(ctx.dir);

      // Add .ralphai/ to .gitignore (legacy pattern -- only matches directories,
      // not symlinks; the pathspec exclusion in is_tree_dirty handles this)
      writeFileSync(join(ctx.dir, ".gitignore"), ".ralphai/\n");
      execSync("git add .gitignore && git commit -m 'add gitignore'", {
        cwd: ctx.dir,
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
      expect(isDirty(ctx.dir)).toBe(false);

      // Adding files inside .ralphai/ should NOT make the tree dirty (gitignored)
      mkdirSync(join(ctx.dir, ".ralphai"), { recursive: true });
      writeFileSync(join(ctx.dir, ".ralphai", "LEARNINGS.md"), "# Learnings");
      expect(isDirty(ctx.dir)).toBe(false);

      // A .ralphai symlink (as created in worktrees) should also not trigger dirty
      rmSync(join(ctx.dir, ".ralphai"), { recursive: true, force: true });
      const symlinkTarget = join(ctx.dir, ".ralphai-real");
      mkdirSync(symlinkTarget, { recursive: true });
      symlinkSync(symlinkTarget, join(ctx.dir, ".ralphai"));
      expect(isDirty(ctx.dir)).toBe(false);

      // A ralphai.json symlink (as created in worktrees) should not trigger dirty.
      // The symlink target lives outside the repo (in the main repo), so use tmpdir.
      rmSync(join(ctx.dir, "real-change.txt"), { force: true });
      const configTarget = join(tmpdir(), "ralphai-config-real.json");
      writeFileSync(configTarget, '{"agent":"opencode"}');
      symlinkSync(configTarget, join(ctx.dir, "ralphai.json"));
      expect(isDirty(ctx.dir)).toBe(false);

      // But a real change (outside .ralphai and ralphai.json) should still be caught
      writeFileSync(join(ctx.dir, "real-change.txt"), "dirty");
      expect(isDirty(ctx.dir)).toBe(true);
    });

    it("worktree reuses an existing in-progress worktree and auto-resumes", () => {
      gitInitialCommit(ctx.dir);

      const inProgressDir = join(
        ctx.dir,
        ".ralphai",
        "pipeline",
        "in-progress",
      );
      const planDir = join(inProgressDir, "prd-resume");
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, "prd-resume.md"), "# Resume test\n");

      const worktreeDir = join(ctx.dir, "wt-resume");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/prd-resume HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // Use RALPHAI_AGENT_COMMAND=true so the runner exits quickly
      const result = runCli(
        ["worktree", "--turns=3"],
        ctx.dir,
        { RALPHAI_AGENT_COMMAND: "true" },
        30000,
      );
      const combined = result.stdout + result.stderr;

      expect(combined).toContain(`Reusing existing worktree: ${worktreeDir}`);

      // The .ralphai symlink should have been created in the worktree
      const symlinkPath = join(worktreeDir, ".ralphai");
      expect(existsSync(symlinkPath)).toBe(true);
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    });

    it("worktree clean with no ralphai worktrees", () => {
      gitInitialCommit(ctx.dir);
      const output = runCliOutput(["worktree", "clean"], ctx.dir);
      expect(output).toContain("No ralphai worktrees to clean");
    });

    it("run is blocked when receipt says source=worktree", () => {
      gitInitialCommit(ctx.dir);

      // Set up initialized ralphai with an in-progress plan and receipt
      mkdirSync(join(ctx.dir, ".ralphai", "pipeline", "in-progress"), {
        recursive: true,
      });
      writeFileSync(
        join(ctx.dir, "ralphai.json"),
        JSON.stringify({ agentCommand: "claude -p" }) + "\n",
      );
      const planDir = join(
        ctx.dir,
        ".ralphai",
        "pipeline",
        "in-progress",
        "dark-mode",
      );
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, "dark-mode.md"), "# Dark mode\n");
      writeFileSync(
        join(planDir, "receipt.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=worktree",
          "worktree_path=/tmp/wt-dark-mode",
          "branch=ralphai/dark-mode",
          "slug=dark-mode",
          "turns_completed=3",
        ].join("\n"),
      );

      const result = runCli(["run"], ctx.dir);
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(1);
      expect(combined).toContain('Plan "dark-mode" is running in a worktree');
      expect(combined).toContain("To resume:  ralphai worktree");
    });

    it("worktree is blocked when receipt says source=main", () => {
      gitInitialCommit(ctx.dir);

      mkdirSync(join(ctx.dir, ".ralphai", "pipeline", "in-progress"), {
        recursive: true,
      });
      writeFileSync(
        join(ctx.dir, "ralphai.json"),
        JSON.stringify({ agentCommand: "claude -p" }) + "\n",
      );
      const planDir = join(
        ctx.dir,
        ".ralphai",
        "pipeline",
        "in-progress",
        "prd-search",
      );
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, "prd-search.md"), "# Search\n");
      writeFileSync(
        join(planDir, "receipt.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=main",
          "branch=ralphai/prd-search",
          "slug=prd-search",
          "plan_file=prd-search.md",
          "turns_completed=1",
        ].join("\n"),
      );

      const result = runCli(["worktree"], ctx.dir);
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(1);
      expect(combined).toContain(
        'Plan "prd-search" is already running in the main repository',
      );
    });

    it("worktree clean archives receipt file", () => {
      gitInitialCommit(ctx.dir);

      mkdirSync(join(ctx.dir, ".ralphai", "pipeline", "in-progress"), {
        recursive: true,
      });

      // Create a worktree with no active plan (so clean will remove it)
      const worktreeDir = join(ctx.dir, "wt-done");
      execSync(`git worktree add "${worktreeDir}" -b ralphai/done HEAD`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      // Write a receipt for the slug "done"
      const planDir = join(
        ctx.dir,
        ".ralphai",
        "pipeline",
        "in-progress",
        "done",
      );
      mkdirSync(planDir, { recursive: true });
      writeFileSync(
        join(planDir, "receipt.txt"),
        [
          "started_at=2026-03-07T12:00:00Z",
          "source=worktree",
          "worktree_path=" + worktreeDir,
          "branch=ralphai/done",
          "slug=done",
          "turns_completed=5",
        ].join("\n"),
      );

      const result = runCli(["worktree", "clean"], ctx.dir);
      const combined = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(combined).toContain("Archived receipt: done/receipt.txt");

      // Receipt should no longer exist in in-progress
      expect(
        existsSync(
          join(
            ctx.dir,
            ".ralphai",
            "pipeline",
            "in-progress",
            "done",
            "receipt.txt",
          ),
        ),
      ).toBe(false);

      // Receipt should exist in out/
      const outDir = join(ctx.dir, ".ralphai", "pipeline", "out");
      expect(existsSync(outDir)).toBe(true);
      const archivedReceipt = join(outDir, "done", "receipt.txt");
      expect(existsSync(archivedReceipt)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Doctor: worktree .ralphai/ symlink check
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "doctor worktree symlink check",
  () => {
    let mainRepo: string;
    let worktreeDir: string;

    beforeEach(() => {
      mainRepo = join(
        tmpdir(),
        `ralphai-doc-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
      execSync("git checkout -b main", { cwd: mainRepo, stdio: "ignore" });
      writeFileSync(join(mainRepo, "seed.txt"), "seed");
      execSync("git add -A && git commit -m init", {
        cwd: mainRepo,
        stdio: "ignore",
      });

      // Initialize ralphai in the main repo
      runCli(["init", "--yes"], mainRepo);
      // Set agentCommand to something in PATH so doctor doesn't fail on that
      const configPath = join(mainRepo, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.agentCommand = "true";
      config.feedbackCommands = ["true"];
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      execSync("git add -A && git commit -m 'add ralphai'", {
        cwd: mainRepo,
        stdio: "ignore",
      });

      // Create a worktree
      worktreeDir = join(
        tmpdir(),
        `ralphai-doc-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      execSync(
        `git worktree add ${JSON.stringify(worktreeDir)} -b ralphai/test-wt`,
        { cwd: mainRepo, stdio: "ignore" },
      );
    });

    afterEach(() => {
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

    it("doctor warns when worktree has a real .ralphai/ directory (not a symlink)", () => {
      // Place a real .ralphai/ directory in the worktree (not a symlink)
      mkdirSync(join(worktreeDir, ".ralphai", "pipeline", "backlog"), {
        recursive: true,
      });
      writeFileSync(
        join(worktreeDir, ".ralphai", "pipeline", "backlog", "my-plan.md"),
        "# Plan\n",
      );

      const result = runCli(["doctor"], worktreeDir, { NO_COLOR: "1" });
      const output = result.stdout;

      expect(output).toContain("not a symlink");
      expect(output).toContain("local plans will be ignored");
      expect(output).toContain("\u26A0"); // warning sign
    });

    it("doctor does not warn when worktree has .ralphai/ as a symlink", () => {
      // Create a proper symlink in the worktree
      symlinkSync(join(mainRepo, ".ralphai"), join(worktreeDir, ".ralphai"));

      const result = runCli(["doctor"], worktreeDir, { NO_COLOR: "1" });
      const output = result.stdout;

      expect(output).not.toContain("not a symlink");
      expect(output).toContain(".ralphai/ is a symlink");
    });
  },
);
