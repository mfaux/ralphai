import { describe, it, expect } from "bun:test";
import { join } from "path";
import { writeFileSync, readdirSync } from "fs";
import { runCliInProcess, useTempGitDir, useTempDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Init a repo and return the config file path so tests can overwrite values.
 */
async function initAndGetConfigFile(
  ctxDir: string,
  env: Record<string, string>,
): Promise<string> {
  await runCliInProcess(["init", "--yes"], ctxDir, env);
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

  it("prints the fully resolved configuration and exits 0", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    await runCliInProcess(["init", "--yes"], ctx.dir, env);

    const result = await runCliInProcess(["config"], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Resolved settings");
    expect(result.stdout).toContain("agentCommand");
    expect(result.stdout).toContain("baseBranch");
  });

  it("shows config file path", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-path") };
    await runCliInProcess(["init", "--yes"], ctx.dir, env);

    const result = await runCliInProcess(["config"], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Config file:");
  });
});

// =========================================================================
// ralphai config on non-initialized repo
// =========================================================================

describe("ralphai config on non-initialized repo", () => {
  const ctx = useTempGitDir();

  it("prints error suggesting ralphai init and exits 1", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-empty") };
    const result = await runCliInProcess(["config"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ralphai init");
  });
});

// =========================================================================
// ralphai config backlog-dir
// =========================================================================

describe("ralphai config backlog-dir", () => {
  const ctx = useTempGitDir();

  it("prints the backlog directory path and exits 0", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    await runCliInProcess(["init", "--yes"], ctx.dir, env);

    const result = await runCliInProcess(
      ["config", "backlog-dir"],
      ctx.dir,
      env,
    );
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim();
    expect(output).toContain("backlog");
    expect(output).toContain("pipeline");
  });

  it("exits 1 when not initialized", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-noinit") };
    const result = await runCliInProcess(
      ["config", "backlog-dir"],
      ctx.dir,
      env,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ralphai init");
  });
});

// =========================================================================
// ralphai config --check=issues
// =========================================================================

describe("ralphai config --check=issues", () => {
  const ctx = useTempGitDir();

  it("prints 'configured' and exits 0 when issueSource is github", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-check-ok") };
    const configFile = await initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "github" }));

    const result = await runCliInProcess(
      ["config", "--check=issues"],
      ctx.dir,
      env,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("configured (issues: github)");
  });

  it("prints 'not configured' and exits 1 when issueSource is none", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-check-none") };
    const configFile = await initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "none" }));

    const result = await runCliInProcess(
      ["config", "--check=issues"],
      ctx.dir,
      env,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toContain("missing capability: issues");
  });

  it("exits 1 with 'not configured' when repo is not initialized", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-check-empty") };
    const result = await runCliInProcess(
      ["config", "--check=issues"],
      ctx.dir,
      env,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe("not configured — run ralphai init");
  });
});

// =========================================================================
// ralphai config with unknown key
// =========================================================================

describe("ralphai config with unknown key", () => {
  const ctx = useTempGitDir();

  it("exits 1 with error for unknown config key", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-unknown") };
    await runCliInProcess(["init", "--yes"], ctx.dir, env);

    const result = await runCliInProcess(
      ["config", "nonexistent"],
      ctx.dir,
      env,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown config key: "nonexistent"');
  });
});

// =========================================================================
// ralphai config --help
// =========================================================================

describe("ralphai config --help", () => {
  it("prints usage and exits 0", async () => {
    const result = await runCliInProcess(["config", "--help"]);
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
  it("ralphai --help includes config in the command list", async () => {
    const result = await runCliInProcess(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("config");
  });
});

// =========================================================================
// ralphai config --unknown-flag
// =========================================================================

describe("ralphai config unknown flag", () => {
  const ctx = useTempGitDir();

  it("exits 1 with Unknown flag error", async () => {
    const result = await runCliInProcess(["config", "--unknown-flag"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });
});

// =========================================================================
// ralphai config outside git repo
// =========================================================================

describe("ralphai config outside git repo", () => {
  const ctx = useTempDir();

  it("exits 1 with not-initialized error", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    const result = await runCliInProcess(["config"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ralphai init");
  });
});
