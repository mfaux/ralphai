import { describe, it, expect } from "bun:test";
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
    expect(output).toContain("Core");
    expect(output).toContain("Management");
    expect(output).toContain("Setup & Maintenance");
    expect(output).toContain("Plumbing");
    expect(output).toContain("init");
    expect(output).toContain("run");
    expect(output).toContain("update");
    expect(output).toContain("uninstall");
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

  it("--help shows usage information with grouped command headings", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("ralphai");
    // Grouped headings
    expect(result.stdout).toContain("Core");
    expect(result.stdout).toContain("Management");
    expect(result.stdout).toContain("Setup & Maintenance");
    expect(result.stdout).toContain("Plumbing");
    // Commands present
    expect(result.stdout).toContain("run");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("clean");
    expect(result.stdout).toContain("config");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("uninstall");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("stop");
    expect(result.stdout).toContain("reset");
    expect(result.stdout).toContain("repos");
    expect(result.stdout).toContain("seed");
    // No "Commands:" flat heading
    expect(result.stdout).not.toMatch(/^Commands:/m);
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
    expect(result.stdout).toContain("--once");
    expect(result.stdout).toContain("Auto-refreshes every 3s");
    expect(result.stdout).toContain("--no-color");
  });

  it("status --once prints once and exits", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    runCli(["init", "--yes"], ctx.dir, env);
    const result = runCli(["status", "--once"], ctx.dir, env, 10000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Pipeline");
  });

  it("stop --help shows stop usage", () => {
    const result = runCli(["stop", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stop");
    expect(result.stdout).toContain("--all");
    expect(result.stdout).toContain("--dry-run");
  });

  it("help text lists stop", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stop");
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

  it("uninstall --help shows uninstall usage and flags", () => {
    const result = runCli(["uninstall", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("uninstall");
    expect(result.stdout).toContain("--yes");
    expect(result.stdout).toContain("--global");
  });

  it("run --help does not show removed --prd flag", () => {
    const result = runCli(["run", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("--prd");
  });

  it("run --help shows [<target>] usage with examples", () => {
    const result = runCli(["run", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ralphai run [<target>]");
    // Issue number example
    expect(result.stdout).toContain("ralphai run 42");
    // Plan file example
    expect(result.stdout).toContain("ralphai run my-feature.md");
    // Auto-select (omitted target)
    expect(result.stdout).toContain("(omitted)");
    expect(result.stdout).toContain("Auto-detect");
  });

  // -------------------------------------------------------------------------
  // Top-level help surfaces run flags
  // -------------------------------------------------------------------------

  it("--help shows command-specific help hint and quick-start examples", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ralphai <command> --help");
    expect(result.stdout).toContain(
      "ralphai               # open interactive menu",
    );
    expect(result.stdout).toContain("ralphai init");
    expect(result.stdout).toContain("ralphai run");
    // Removed commands should not appear in examples
    expect(result.stdout).not.toContain("ralphai worktree list");
    expect(result.stdout).not.toContain("ralphai worktree clean");
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

  it("uninstall --wrong exits with error", () => {
    const result = runCli(["uninstall", "--wrong"], ctx.dir);
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

  // -------------------------------------------------------------------------
  // backlog-dir command (removed — now shows guidance)
  // -------------------------------------------------------------------------

  it("backlog-dir prints removal guidance", () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    runCli(["init", "--yes"], ctx.dir, env);
    const result = runCli(["backlog-dir"], ctx.dir, env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'backlog-dir'");
    expect(result.stderr).toContain("ralphai config backlog-dir");
  });

  it("backlog-dir --help also prints removal guidance (not help)", () => {
    const result = runCli(["backlog-dir", "--help"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'backlog-dir'");
    expect(result.stderr).toContain("ralphai config backlog-dir");
  });

  it("backlog-dir --unknown prints removal guidance", () => {
    const result = runCli(["backlog-dir", "--unknown"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'backlog-dir'");
    expect(result.stderr).toContain("ralphai config backlog-dir");
  });

  it("help text does not list removed backlog-dir", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("backlog-dir");
  });
});
