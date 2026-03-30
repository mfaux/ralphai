import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { writeFileSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { runCli, useTempGitDir, useTempDir } from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Helper: init a repo and return the config file path so tests can
 * overwrite issueSource or other values.
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
// --capability=issues
// =========================================================================

describe("ralphai check --capability=issues", () => {
  const ctx = useTempGitDir();

  // -----------------------------------------------------------------------
  // AC: exits 0 and prints "configured (issues: github)" when issueSource
  //     is "github" (Scenario 5)
  // -----------------------------------------------------------------------

  it("exits 0 when issueSource is github", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-ok") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "github" }));

    const result = runCli(["check", "--capability=issues"], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("configured (issues: github)");
  });

  // -----------------------------------------------------------------------
  // AC: exits 1 and prints missing capability message when issueSource
  //     is "none" (Scenario 6)
  // -----------------------------------------------------------------------

  it("exits 1 when issueSource is none", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-none") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    // Default init creates issueSource: "none", but be explicit
    writeFileSync(configFile, JSON.stringify({ issueSource: "none" }));

    const result = runCli(["check", "--capability=issues"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe(
      'configured, but missing capability: issues (issueSource is "none")',
    );
  });

  // -----------------------------------------------------------------------
  // AC: exits 1 when issueSource is not set (defaults to "none")
  // -----------------------------------------------------------------------

  it("exits 1 when issueSource defaults to none", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-default") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    // Write a config without issueSource — it defaults to "none"
    writeFileSync(configFile, JSON.stringify({}));

    const result = runCli(["check", "--capability=issues"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe(
      'configured, but missing capability: issues (issueSource is "none")',
    );
  });
});

// =========================================================================
// --capability with no config (Scenario 7)
// =========================================================================

describe("ralphai check --capability when not configured", () => {
  const ctx = useTempGitDir();

  it("exits 1 with not configured before capability check", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-noconfig") };
    const result = runCli(["check", "--capability=issues"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe("not configured — run ralphai init");
  });
});

// =========================================================================
// Unknown capability name (Scenario 8)
// =========================================================================

describe("ralphai check --capability=unknown", () => {
  const ctx = useTempGitDir();

  it("exits 1 with helpful error listing supported capabilities", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-unknown") };
    initAndGetConfigFile(ctx.dir, env);

    const result = runCli(["check", "--capability=unknown"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe(
      'unknown capability: "unknown" (supported: issues)',
    );
  });
});

// =========================================================================
// Multiple capabilities (Scenarios 9 & 10)
// =========================================================================

describe("ralphai check with multiple --capability flags", () => {
  const ctx = useTempGitDir();

  // -----------------------------------------------------------------------
  // AC: All capabilities pass → exit 0 (Scenario 9)
  // -----------------------------------------------------------------------

  it("exits 0 when all capabilities pass", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-multi-ok") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "github" }));

    // Currently only "issues" exists — using it twice demonstrates
    // the repeatable flag semantics
    const result = runCli(
      ["check", "--capability=issues", "--capability=issues"],
      ctx.dir,
      env,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain("issues: github");
  });

  // -----------------------------------------------------------------------
  // AC: One capability fails → exit 1 (Scenario 10)
  // With multiple capabilities including an unknown one, first failing
  // capability is reported
  // -----------------------------------------------------------------------

  it("exits 1 when one capability is unknown", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-multi-fail") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "github" }));

    const result = runCli(
      ["check", "--capability=issues", "--capability=nonexistent"],
      ctx.dir,
      env,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toContain("unknown capability");
  });
});

// =========================================================================
// --help updated with --capability
// =========================================================================

describe("ralphai check --help with capability", () => {
  it("documents --capability flag", () => {
    const result = runCli(["check", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--capability");
    expect(result.stdout).toContain("issues");
  });
});

// =========================================================================
// Output contains no ANSI escape codes (capability path)
// =========================================================================

describe("ralphai check --capability ANSI output", () => {
  const ctx = useTempGitDir();

  it("capability pass output has no ANSI escape codes", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-ansi-pass") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "github" }));

    const cliPath = join(__dirname, "cli.ts");
    const raw = execFileSync(
      "node",
      ["--experimental-strip-types", cliPath, "check", "--capability=issues"],
      {
        encoding: "utf-8",
        cwd: ctx.dir,
        env: { ...process.env, ...env },
      },
    );
    expect(raw).not.toMatch(/\x1b\[/);
    expect(raw.trim()).toBe("configured (issues: github)");
  });

  it("capability fail output has no ANSI escape codes", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-cap-ansi-fail") };
    const configFile = initAndGetConfigFile(ctx.dir, env);
    writeFileSync(configFile, JSON.stringify({ issueSource: "none" }));

    const cliPath = join(__dirname, "cli.ts");
    try {
      execFileSync(
        "node",
        ["--experimental-strip-types", cliPath, "check", "--capability=issues"],
        {
          encoding: "utf-8",
          cwd: ctx.dir,
          env: { ...process.env, ...env },
        },
      );
      expect.unreachable("expected process to exit with code 1");
    } catch (error: any) {
      expect(error.stdout).not.toMatch(/\x1b\[/);
      expect(error.stdout.trim()).toBe(
        'configured, but missing capability: issues (issueSource is "none")',
      );
    }
  });
});
