import { describe, it, expect } from "bun:test";
import { join } from "path";
import { writeFileSync, readdirSync } from "fs";
import { runCli, useTempGitDir, useTempDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Init a repo and return the config file path so tests can overwrite values.
 */
function initAndGetConfigFile(
  ctxDir: string,
  env: Record<string, string>,
): string {
  runCli(["init", "--yes"], ctxDir, env);
  const home = env.RALPHAI_HOME;
  if (!home) throw new Error("RALPHAI_HOME not set in env");
  const reposDir = join(home, "repos");
  const repoDirs = readdirSync(reposDir);
  const first = repoDirs[0];
  if (!first) throw new Error("no repo directory found after init");
  return join(reposDir, first, "config.json");
}

// =========================================================================
// ralphai config (bare — fully resolved configuration)
// =========================================================================

describe("ralphai config (bare)", () => {
  const ctx = useTempGitDir();

  it("prints the fully resolved configuration and exits 0", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    runCli(["init", "--yes"], ctx.dir, env);

    const result = runCli(["config"], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Resolved settings");
    expect(result.stdout).toContain("agentCommand");
    expect(result.stdout).toContain("baseBranch");
  });

  it("shows config file path", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-path") };
    runCli(["init", "--yes"], ctx.dir, env);

    const result = runCli(["config"], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Config file:");
  });
});

// =========================================================================
// ralphai config on non-initialized repo
// =========================================================================

describe("ralphai config on non-initialized repo", () => {
  const ctx = useTempGitDir();

  it("prints error suggesting ralphai init and exits 1", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-empty") };
    const result = runCli(["config"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ralphai init");
  });
});

// =========================================================================
// ralphai config backlog-dir
// =========================================================================

describe("ralphai config backlog-dir", () => {
  const ctx = useTempGitDir();

  it("prints the backlog directory path and exits 0", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    runCli(["init", "--yes"], ctx.dir, env);

    const result = runCli(["config", "backlog-dir"], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim();
    expect(output).toContain("backlog");
    expect(output).toContain("pipeline");
  });

  it("exits 1 when not initialized", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-noinit") };
    const result = runCli(["config", "backlog-dir"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ralphai init");
  });
});

// =========================================================================
// ralphai config --check=issues
// =========================================================================

describe("ralphai config --check=issues", () => {
  const ctx = useTempGitDir();

  it("prints 'configured' and exits 0 when issueSource is github", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-check-ok") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "github" }));

    const result = runCli(["config", "--check=issues"], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("configured (issues: github)");
  });

  it("prints 'not configured' and exits 1 when issueSource is none", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-check-none") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "none" }));

    const result = runCli(["config", "--check=issues"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toContain("missing capability: issues");
  });

  it("exits 1 with 'not configured' when repo is not initialized", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-check-empty") };
    const result = runCli(["config", "--check=issues"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe("not configured — run ralphai init");
  });
});

// =========================================================================
// ralphai config with unknown key
// =========================================================================

describe("ralphai config with unknown key", () => {
  const ctx = useTempGitDir();

  it("exits 1 with error for unknown config key", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-unknown") };
    runCli(["init", "--yes"], ctx.dir, env);

    const result = runCli(["config", "nonexistent"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown config key: "nonexistent"');
  });
});

// =========================================================================
// ralphai config --help
// =========================================================================

describe("ralphai config --help", () => {
  it("prints usage and exits 0", () => {
    const result = runCli(["config", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("ralphai config");
    expect(result.stdout).toContain("backlog-dir");
    expect(result.stdout).toContain("--check");
  });
});

// =========================================================================
// ralphai --help lists the config command
// =========================================================================

describe("ralphai --help lists config", () => {
  it("ralphai --help includes config in the command list", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("config");
  });
});

// =========================================================================
// ralphai config --unknown-flag
// =========================================================================

describe("ralphai config unknown flag", () => {
  const ctx = useTempGitDir();

  it("exits 1 with Unknown flag error", () => {
    const result = runCli(["config", "--unknown-flag"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });
});

// =========================================================================
// ralphai config outside git repo
// =========================================================================

describe("ralphai config outside git repo", () => {
  const ctx = useTempDir();

  it("exits 1 with not-initialized error", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    const result = runCli(["config"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ralphai init");
  });
});
