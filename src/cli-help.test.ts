import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("CLI help and flags", () => {
  const ctx = useTempGitDir();

  it("(no subcommand) shows help text listing all subcommands", () => {
    const result = runCli([], ctx.dir);
    const output = stripLogo(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(output).toContain("Commands:");
    expect(output).toContain("init");
    expect(output).toContain("run");
    expect(output).toContain("update");
    expect(output).toContain("teardown");
    expect(output).toContain("reset");
  });

  it("run errors when .ralphai/ does not exist", () => {
    const result = runCli(["run"], ctx.dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
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
    expect(result.stdout).toContain("teardown");
  });

  // -------------------------------------------------------------------------
  // Subcommand --help
  // -------------------------------------------------------------------------

  it("init --help shows init-specific flags", () => {
    const result = runCli(["init", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("--yes");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).not.toContain("--shared");
    expect(result.stdout).toContain("--agent-command");
  });

  it("status --help shows status usage", () => {
    const result = runCli(["status", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("status");
  });

  it("reset --help shows reset usage and flags", () => {
    const result = runCli(["reset", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("reset");
    expect(result.stdout).toContain("--yes");
  });

  it("update --help shows update usage", () => {
    const result = runCli(["update", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("update");
  });

  it("teardown --help shows teardown usage and flags", () => {
    const result = runCli(["teardown", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("teardown");
    expect(result.stdout).toContain("--yes");
  });

  // -------------------------------------------------------------------------
  // Top-level help surfaces run flags
  // -------------------------------------------------------------------------

  it("--help shows command-specific help hint and quick-start examples", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ralphai <command> --help");
    expect(result.stdout).toContain("ralphai init");
    expect(result.stdout).toContain("ralphai run");
    expect(result.stdout).toContain("ralphai run --pr");
  });

  it("--help does not show subcommand-specific flags", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("--turns");
    expect(result.stdout).not.toContain("--dry-run");
    expect(result.stdout).not.toContain("--resume");
    expect(result.stdout).not.toContain("--continuous");
  });

  // -------------------------------------------------------------------------
  // Unknown flag rejection
  // -------------------------------------------------------------------------

  it("init --invalid-flag exits with error", () => {
    const result = runCli(["init", "--invalid-flag"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
    expect(result.stderr).toContain("--invalid-flag");
  });

  it("status --bad-opt exits with error", () => {
    const result = runCli(["status", "--bad-opt"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });

  it("reset --nope exits with error", () => {
    const result = runCli(["reset", "--nope"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });

  it("teardown --wrong exits with error", () => {
    const result = runCli(["teardown", "--wrong"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });

  // -------------------------------------------------------------------------
  // NO_COLOR support
  // -------------------------------------------------------------------------

  it("NO_COLOR=1 disables ANSI escape codes", () => {
    const cliPath = join(__dirname, "cli.ts");
    const raw = execFileSync(
      "node",
      ["--experimental-strip-types", cliPath, "init", "--help"],
      {
        encoding: "utf-8",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    // Should contain no ANSI escape sequences
    expect(raw).not.toMatch(/\x1b\[/);
    // But should still contain the help text
    expect(raw).toContain("init");
  });

  it("--no-color disables ANSI escape codes", () => {
    const cliPath = join(__dirname, "cli.ts");
    const raw = execFileSync(
      "node",
      ["--experimental-strip-types", cliPath, "--no-color", "init", "--help"],
      {
        encoding: "utf-8",
      },
    );
    expect(raw).not.toMatch(/\x1b\[/);
    expect(raw).toContain("init");
  });
});
