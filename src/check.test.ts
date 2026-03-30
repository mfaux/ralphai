import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { runCli, useTempGitDir, useTempDir } from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ralphai check", () => {
  const ctx = useTempGitDir();

  // -----------------------------------------------------------------------
  // AC: exits 0 and prints "configured" when config exists and is valid
  // -----------------------------------------------------------------------

  it("prints 'configured' and exits 0 when config is valid", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    runCli(["init", "--yes"], ctx.dir, env);

    const result = runCli(["check"], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("configured");
  });

  // -----------------------------------------------------------------------
  // AC: exits 1 and prints "not configured" when no config file exists
  // -----------------------------------------------------------------------

  it("prints 'not configured' and exits 1 when no config", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-empty") };
    const result = runCli(["check"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe("not configured — run ralphai init");
  });

  // -----------------------------------------------------------------------
  // AC: exits 1 and prints "invalid config — <detail>" for malformed JSON
  // -----------------------------------------------------------------------

  it("prints 'invalid config' and exits 1 for malformed JSON", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-bad") };
    // First init to create the directory structure, then corrupt the file
    runCli(["init", "--yes"], ctx.dir, env);
    const configPath = join(env.RALPHAI_HOME, "repos");
    // Find the repo dir (there should be exactly one)
    const { readdirSync } = require("fs");
    const repoDirs = readdirSync(configPath);
    expect(repoDirs.length).toBeGreaterThan(0);
    const configFile = join(configPath, repoDirs[0], "config.json");
    writeFileSync(configFile, "{ this is not valid json }");

    const result = runCli(["check"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toMatch(/^invalid config — /);
    expect(result.stdout).toContain("invalid JSON");
  });

  // -----------------------------------------------------------------------
  // AC: exits 1 and prints "invalid config — <detail>" for invalid values
  // -----------------------------------------------------------------------

  it("prints 'invalid config' and exits 1 for invalid config values", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-invalid") };
    runCli(["init", "--yes"], ctx.dir, env);
    const configPath = join(env.RALPHAI_HOME, "repos");
    const { readdirSync } = require("fs");
    const repoDirs = readdirSync(configPath);
    const configFile = join(configPath, repoDirs[0], "config.json");
    // Write valid JSON but with an invalid value
    writeFileSync(
      configFile,
      JSON.stringify({ issueSource: "invalid-source" }),
    );

    const result = runCli(["check"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toMatch(/^invalid config — /);
    expect(result.stdout).toContain("issueSource");
  });

  // -----------------------------------------------------------------------
  // AC: --help prints usage information
  // -----------------------------------------------------------------------

  it("check --help prints usage", () => {
    const result = runCli(["check", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("ralphai check");
    expect(result.stdout).toContain("configured");
    expect(result.stdout).toContain("not configured");
    expect(result.stdout).toContain("invalid config");
    expect(result.stdout).toContain("--repo");
  });

  // -----------------------------------------------------------------------
  // AC: --unknown-flag exits 1 with "Unknown flag" (strict parsing)
  // -----------------------------------------------------------------------

  it("check --unknown-flag exits 1 with Unknown flag error", () => {
    const result = runCli(["check", "--unknown-flag"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
    expect(result.stderr).toContain("--unknown-flag");
  });

  // -----------------------------------------------------------------------
  // AC: ralphai --help lists the check command
  // -----------------------------------------------------------------------

  it("ralphai --help lists check command", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("check");
  });

  // -----------------------------------------------------------------------
  // AC: Output contains no ANSI escape codes
  // -----------------------------------------------------------------------

  it("check output contains no ANSI escape codes (configured)", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-ansi") };
    runCli(["init", "--yes"], ctx.dir, env);

    const cliPath = join(__dirname, "cli.ts");
    const raw = execFileSync(
      "node",
      ["--experimental-strip-types", cliPath, "check"],
      {
        encoding: "utf-8",
        cwd: ctx.dir,
        env: { ...process.env, ...env },
      },
    );
    expect(raw).not.toMatch(/\x1b\[/);
    expect(raw.trim()).toBe("configured");
  });

  it("check output contains no ANSI escape codes (not configured)", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-ansi-no") };
    const cliPath = join(__dirname, "cli.ts");
    try {
      execFileSync("node", ["--experimental-strip-types", cliPath, "check"], {
        encoding: "utf-8",
        cwd: ctx.dir,
        env: { ...process.env, ...env },
      });
      // Should not reach here (exit 1)
      expect.unreachable("expected process to exit with code 1");
    } catch (error: any) {
      expect(error.stdout).not.toMatch(/\x1b\[/);
      expect(error.stdout.trim()).toBe("not configured — run ralphai init");
    }
  });
});

// -----------------------------------------------------------------------
// AC: works without being inside a git repo (no git repo requirement)
// -----------------------------------------------------------------------

describe("ralphai check outside git repo", () => {
  const ctx = useTempDir();

  it("works outside a git repo (not configured)", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    const result = runCli(["check"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe("not configured — run ralphai init");
  });
});

// -----------------------------------------------------------------------
// AC: --repo=<name> checks config for the specified repo
// -----------------------------------------------------------------------

describe("ralphai check --repo", () => {
  const ctx = useTempGitDir();

  it("check --repo=<name> checks config for the specified repo", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home-repo") };
    // Init the repo first so it is registered
    runCli(["init", "--yes"], ctx.dir, env);

    // Now use --repo with the repo path
    const result = runCli(["check", `--repo=${ctx.dir}`], ctx.dir, env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("configured");
  });
});
