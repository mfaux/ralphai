import { describe, it, expect } from "bun:test";
import { join, dirname } from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import {
  runCli,
  runCliInProcess,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("CLI help and flags", () => {
  const ctx = useTempGitDir();

  it("(no subcommand) shows help text listing all subcommands", async () => {
    const result = await runCliInProcess([], ctx.dir);
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

  it("run errors when .ralphai/ does not exist", async () => {
    const result = await runCliInProcess(["run"], ctx.dir);
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

  it("--help shows usage information with grouped command headings", async () => {
    const result = await runCliInProcess(["--help"]);
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

  it("init --help shows init-specific flags", async () => {
    const result = await runCliInProcess(["init", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("--yes");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).not.toContain("--shared");
    expect(result.stdout).toContain("--agent-command");
  });

  it("status --help shows status usage", async () => {
    const result = await runCliInProcess(["status", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("--once");
    expect(result.stdout).toContain("Auto-refreshes every 3s");
    expect(result.stdout).toContain("--no-color");
  });

  it("status --once prints once and exits", async () => {
    const env = { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    await runCliInProcess(["init", "--yes"], ctx.dir, env);
    const result = await runCliInProcess(
      ["status", "--once"],
      ctx.dir,
      env,
      10000,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Pipeline");
  });

  it("stop --help shows stop usage", async () => {
    const result = await runCliInProcess(["stop", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stop");
    expect(result.stdout).toContain("--all");
    expect(result.stdout).toContain("--dry-run");
  });

  it("help text lists stop", async () => {
    const result = await runCliInProcess(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stop");
  });

  it("reset --help shows reset usage and flags", async () => {
    const result = await runCliInProcess(["reset", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("reset");
    expect(result.stdout).toContain("--yes");
  });

  it("update --help shows update usage", async () => {
    const result = await runCliInProcess(["update", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("update");
  });

  it("uninstall --help shows uninstall usage and flags", async () => {
    const result = await runCliInProcess(["uninstall", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("uninstall");
    expect(result.stdout).toContain("--yes");
    expect(result.stdout).toContain("--global");
  });

  it("run --help does not show removed --prd flag", async () => {
    const result = await runCliInProcess(["run", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("--prd");
  });

  it("run --help shows [<target>] usage with examples", async () => {
    const result = await runCliInProcess(["run", "--help"]);
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

  it("--help does not show subcommand-specific flags", async () => {
    const result = await runCliInProcess(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("--turns");
    expect(result.stdout).not.toContain("--dry-run");
    expect(result.stdout).not.toContain("--resume");
  });

  // -------------------------------------------------------------------------
  // Unknown flag rejection
  // -------------------------------------------------------------------------

  it("init --invalid-flag exits with error", async () => {
    const result = await runCliInProcess(["init", "--invalid-flag"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
    expect(result.stderr).toContain("--invalid-flag");
  });

  it("status --bad-opt exits with error", async () => {
    const result = await runCliInProcess(["status", "--bad-opt"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });

  it("reset --nope exits with error", async () => {
    const result = await runCliInProcess(["reset", "--nope"], ctx.dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });

  it("uninstall --wrong exits with error", async () => {
    const result = await runCliInProcess(["uninstall", "--wrong"], ctx.dir);
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

  it("help text does not list removed backlog-dir", async () => {
    const result = await runCliInProcess(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("backlog-dir");
  });

  // -------------------------------------------------------------------------
  // Non-TTY fallback (subprocess tests — exercises the real main() TTY gate)
  // -------------------------------------------------------------------------

  it("(no args, non-TTY) falls back to help text instead of launching TUI", () => {
    // runCli uses stdio: ["pipe", "pipe", "pipe"] → non-TTY context.
    // This exercises the real main() function in cli.ts, which gates the
    // TUI behind process.stdout.isTTY && process.stdin.isTTY.
    const result = runCli([], ctx.dir);
    expect(result.exitCode).toBe(0);
    // Should show help text
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("Core");
    expect(result.stdout).toContain("run");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("status");
  });

  it("(no args, non-TTY) shows version header before help text", () => {
    const result = runCli([], ctx.dir);
    expect(result.exitCode).toBe(0);
    // Version header: "ralphai vX.Y.Z"
    expect(result.stdout).toMatch(/ralphai\s+v\d+\.\d+\.\d+/);
  });

  it("(no args, non-TTY) does not emit TUI/Ink artifacts", () => {
    const result = runCli([], ctx.dir);
    expect(result.exitCode).toBe(0);
    // No Ink-specific cursor control sequences (alternate screen, hide cursor)
    expect(result.stdout).not.toContain("\x1b[?1049h"); // alternate screen
    expect(result.stdout).not.toContain("\x1b[?25l"); // hide cursor
    // Should not contain React/Ink component output markers
    expect(result.stdout).not.toContain("❯"); // TUI cursor indicator
  });
});
