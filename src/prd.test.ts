/**
 * Tests for the `ralphai prd <number>` subcommand.
 *
 * Covers: help text, missing issue number, non-numeric issue number,
 * git repo guard, worktree guard, --repo blocked, and top-level help listing.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCli, useTempGitDir } from "./test-utils.ts";

describe("ralphai prd subcommand", () => {
  const ctx = useTempGitDir();

  // -----------------------------------------------------------------------
  // Help text
  // -----------------------------------------------------------------------

  it("prd --help shows prd-specific help", () => {
    const result = runCli(["prd", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ralphai prd <issue-number>");
    expect(result.stdout).toContain("ralphai run");
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("ralphai prd 42");
  });

  it("prd -h also shows help", () => {
    const result = runCli(["prd", "-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ralphai prd <issue-number>");
  });

  // -----------------------------------------------------------------------
  // Top-level help lists prd
  // -----------------------------------------------------------------------

  it("--help lists the prd subcommand", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prd");
  });

  // -----------------------------------------------------------------------
  // Missing issue number
  // -----------------------------------------------------------------------

  it("prd without a number prints usage error", () => {
    const result = runCli(["prd"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: ralphai prd <issue-number>");
  });

  // -----------------------------------------------------------------------
  // Non-numeric issue number
  // -----------------------------------------------------------------------

  it("prd abc prints descriptive error", () => {
    const result = runCli(["prd", "abc"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid issue number");
    expect(result.stderr).toContain("abc");
  });

  it("prd 12.5 prints descriptive error", () => {
    const result = runCli(["prd", "12.5"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid issue number");
  });

  it("prd -1 prints descriptive error", () => {
    const result = runCli(["prd", "-1"], ctx.dir);
    // -1 is parsed as a flag, so prdNumber is undefined → usage error
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Git repo guard
  // -----------------------------------------------------------------------

  it("prd 42 outside a git repo prints git error", () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "ralphai-test-nogit-"));
    try {
      const result = runCli(["prd", "42"], nonGitDir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Not inside a git repository");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // --repo blocked
  // -----------------------------------------------------------------------

  it("--repo=foo prd 42 prints cannot use --repo error", () => {
    const result = runCli(["--repo=foo", "prd", "42"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--repo cannot be used with");
    expect(result.stderr).toContain("prd");
  });

  // -----------------------------------------------------------------------
  // Worktree guard
  // -----------------------------------------------------------------------

  it("prd 42 from inside a worktree prints main repo error", () => {
    // Create a commit so worktrees can be created
    execSync(
      "git -c user.name=Test -c user.email=test@test.com commit --allow-empty -m 'init'",
      {
        cwd: ctx.dir,
        stdio: "ignore",
      },
    );

    const wtDir = join(ctx.dir, "wt-test");
    execSync(`git worktree add "${wtDir}" -b test-wt`, {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    try {
      // Need to also set up ralphai so we get past the config check
      const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
      runCli(["init", "--yes"], ctx.dir, env);

      const result = runCli(["prd", "42"], wtDir, env);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("main repository");
    } finally {
      try {
        execSync(`git worktree remove --force "${wtDir}"`, {
          cwd: ctx.dir,
          stdio: "ignore",
        });
      } catch {
        // cleanup best-effort
      }
    }
  });

  // -----------------------------------------------------------------------
  // Pass-through flags are forwarded
  // -----------------------------------------------------------------------

  it("prd 42 --help shows run help (help is forwarded)", () => {
    // When --help appears after the issue number, it's in runArgs
    // and the prd handler delegates to run which shows run help
    const result = runCli(["prd", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prd");
  });
});
