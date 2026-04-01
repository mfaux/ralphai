/**
 * Tests for `ralphai stop` command.
 *
 * Covers: --help, stop by slug (live/stale/missing PID), auto-select,
 * --all, --dry-run safety, and zero-runner edge case.
 */

import { describe, it, expect } from "bun:test";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { runCli, useTempGitDir } from "./test-utils.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

describe("ralphai stop", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Create a minimal in-progress plan with optional runner.pid. */
  function createInProgressPlan(
    ipDir: string,
    slug: string,
    pid?: string,
  ): void {
    const planDir = join(ipDir, slug);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, `${slug}.md`), `# ${slug}\n`);
    if (pid !== undefined) {
      writeFileSync(join(planDir, "runner.pid"), pid);
    }
  }

  // -----------------------------------------------------------------------
  // --help
  // -----------------------------------------------------------------------

  it("ralphai stop --help prints usage", () => {
    const result = runCli(["stop", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ralphai stop");
    expect(result.stdout).toContain("slug");
    expect(result.stdout).toContain("--all");
    expect(result.stdout).toContain("--dry-run");
  });

  // -----------------------------------------------------------------------
  // stop <slug> with a valid live PID
  // -----------------------------------------------------------------------

  it("ralphai stop <slug> with a valid live PID stops it and prints confirmation", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Spawn a subprocess we can stop (sleep for a long time)
    const proc = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const pid = proc.pid;

    createInProgressPlan(wipDir, "live-plan", String(pid));

    const result = runCli(["stop", "live-plan"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Stopped");
    expect(output).toContain("live-plan");
    expect(output).toContain(String(pid));

    // runner.pid should be cleaned up
    expect(existsSync(join(wipDir, "live-plan", "runner.pid"))).toBe(false);

    // Clean up the process if it's somehow still alive
    try {
      proc.kill();
    } catch {
      /* already dead */
    }
  });

  // -----------------------------------------------------------------------
  // stop <slug> with no PID file
  // -----------------------------------------------------------------------

  it("ralphai stop <slug> with no PID file prints error", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    createInProgressPlan(wipDir, "no-pid-plan");

    const result = runCli(["stop", "no-pid-plan"], ctx.dir, testEnv());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No runner.pid");
  });

  // -----------------------------------------------------------------------
  // stop <slug> with stale PID
  // -----------------------------------------------------------------------

  it("ralphai stop <slug> with stale PID prints message and cleans up", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Use a PID that almost certainly doesn't exist
    createInProgressPlan(wipDir, "stale-plan", "999999999");

    const result = runCli(["stop", "stale-plan"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("not running");
    expect(output).toContain("stale");

    // PID file should be cleaned up
    expect(existsSync(join(wipDir, "stale-plan", "runner.pid"))).toBe(false);
  });

  // -----------------------------------------------------------------------
  // stop (auto-select) with one runner
  // -----------------------------------------------------------------------

  it("ralphai stop with one runner auto-selects", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    const proc = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    createInProgressPlan(wipDir, "only-plan", String(proc.pid));

    const result = runCli(["stop"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Stopped");
    expect(output).toContain("only-plan");

    try {
      proc.kill();
    } catch {
      /* already dead */
    }
  });

  // -----------------------------------------------------------------------
  // stop with zero runners
  // -----------------------------------------------------------------------

  it("ralphai stop with zero runners prints 'No running plans'", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Create a plan without a PID file
    createInProgressPlan(wipDir, "idle-plan");

    const result = runCli(["stop"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("No running plans to stop");
  });

  // -----------------------------------------------------------------------
  // stop with multiple runners
  // -----------------------------------------------------------------------

  it("ralphai stop with multiple runners lists them", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    const proc1 = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const proc2 = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    createInProgressPlan(wipDir, "plan-a", String(proc1.pid));
    createInProgressPlan(wipDir, "plan-b", String(proc2.pid));

    const result = runCli(["stop"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Multiple running plans");
    expect(output).toContain("plan-a");
    expect(output).toContain("plan-b");

    try {
      proc1.kill();
    } catch {
      /* already dead */
    }
    try {
      proc2.kill();
    } catch {
      /* already dead */
    }
  });

  // -----------------------------------------------------------------------
  // stop --all
  // -----------------------------------------------------------------------

  it("ralphai stop --all stops all live runners", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    const proc1 = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const proc2 = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    createInProgressPlan(wipDir, "all-a", String(proc1.pid));
    createInProgressPlan(wipDir, "all-b", String(proc2.pid));

    const result = runCli(["stop", "--all"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Stopped");
    expect(output).toContain("all-a");
    expect(output).toContain("all-b");
    expect(output).toContain("Stopped 2 runners");

    // PID files should be cleaned up
    expect(existsSync(join(wipDir, "all-a", "runner.pid"))).toBe(false);
    expect(existsSync(join(wipDir, "all-b", "runner.pid"))).toBe(false);

    try {
      proc1.kill();
    } catch {
      /* already dead */
    }
    try {
      proc2.kill();
    } catch {
      /* already dead */
    }
  });

  // -----------------------------------------------------------------------
  // --dry-run
  // -----------------------------------------------------------------------

  it("ralphai stop --dry-run prints but does not kill", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    const proc = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    createInProgressPlan(wipDir, "dry-plan", String(proc.pid));

    const result = runCli(
      ["stop", "dry-plan", "--dry-run"],
      ctx.dir,
      testEnv(),
    );
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("[dry-run]");
    expect(output).toContain("Would stop");
    expect(output).toContain("dry-plan");

    // PID file should NOT be cleaned up
    expect(existsSync(join(wipDir, "dry-plan", "runner.pid"))).toBe(true);

    // Process should still be alive
    try {
      process.kill(proc.pid, 0);
      // If we get here, process is alive — good
    } catch {
      throw new Error("Process should still be alive after dry-run");
    }

    proc.kill();
  });

  // -----------------------------------------------------------------------
  // --all --dry-run
  // -----------------------------------------------------------------------

  it("ralphai stop --all --dry-run prints but does not kill", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    const proc1 = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const proc2 = Bun.spawn(["sleep", "300"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    createInProgressPlan(wipDir, "dry-a", String(proc1.pid));
    createInProgressPlan(wipDir, "dry-b", String(proc2.pid));

    const result = runCli(["stop", "--all", "--dry-run"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("[dry-run]");
    expect(output).toContain("Would stop");

    // PID files should NOT be cleaned up
    expect(existsSync(join(wipDir, "dry-a", "runner.pid"))).toBe(true);
    expect(existsSync(join(wipDir, "dry-b", "runner.pid"))).toBe(true);

    // Processes should still be alive
    try {
      process.kill(proc1.pid, 0);
      process.kill(proc2.pid, 0);
    } catch {
      throw new Error("Processes should still be alive after dry-run");
    }

    proc1.kill();
    proc2.kill();
  });

  // -----------------------------------------------------------------------
  // stop <slug> for non-existent plan
  // -----------------------------------------------------------------------

  it("ralphai stop <slug> for non-existent plan prints error", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const result = runCli(["stop", "nonexistent-plan"], ctx.dir, testEnv());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not found");
  });
});
