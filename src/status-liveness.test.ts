/**
 * Tests for runner liveness display in `ralphai status`.
 *
 * Verifies that the status subcommand shows [running PID N], [stalled],
 * or [in progress] depending on whether a runner.pid file exists and
 * whether the referenced process is alive.
 */

import { describe, it, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { runCliInProcess, useTempGitDir } from "./test-utils.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

describe("status runner liveness", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Create a minimal in-progress plan with optional runner.pid. */
  function createInProgressPlan(
    ipDir: string,
    slug: string,
    opts?: { pid?: string; outcome?: string },
  ): void {
    const planDir = join(ipDir, slug);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, `${slug}.md`), `# ${slug}\n\n### Task 1: Do\n`);

    const receiptLines = [
      "started_at=2026-03-07T12:00:00Z",
      `branch=ralphai/${slug}`,
      `slug=${slug}`,
      `plan_file=${slug}.md`,
      "tasks_completed=0",
    ];
    if (opts?.outcome) {
      receiptLines.push(`outcome=${opts.outcome}`);
    }
    writeFileSync(join(planDir, "receipt.txt"), receiptLines.join("\n"));

    if (opts?.pid !== undefined) {
      writeFileSync(join(planDir, "runner.pid"), opts.pid);
    }
  }

  it("shows [running PID N] when runner.pid exists and process is alive", async () => {
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Use the current test process PID — guaranteed to be alive
    createInProgressPlan(ipDir, "prd-live-runner", {
      pid: String(process.pid),
    });

    const result = await runCliInProcess(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain(`[running PID ${process.pid}]`);
    expect(output).not.toContain("[in progress]");
    expect(output).not.toContain("[stalled]");
  });

  it("shows [stalled] when runner.pid exists but process is dead", async () => {
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Use a PID that almost certainly doesn't exist
    createInProgressPlan(ipDir, "prd-dead-runner", { pid: "999999999" });

    const result = await runCliInProcess(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("[stalled]");
    expect(output).not.toContain("[running PID");
  });

  it("shows [in progress] when no runner.pid file exists", async () => {
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // No pid option → no runner.pid file created
    createInProgressPlan(ipDir, "prd-no-pid");

    const result = await runCliInProcess(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("[in progress]");
    expect(output).not.toContain("[running PID");
    expect(output).not.toContain("[stalled]");
  });

  it("shows outcome tag when receipt has outcome, ignoring runner.pid", async () => {
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Has both a runner.pid and an outcome — outcome should take precedence
    createInProgressPlan(ipDir, "prd-stuck-with-pid", {
      pid: String(process.pid),
      outcome: "stuck",
    });

    const result = await runCliInProcess(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("[stuck]");
    expect(output).not.toContain("[running PID");
  });
});
