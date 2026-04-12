/**
 * Tests for gate tuning config: maxRejections, maxIterations, reviewMaxFiles.
 *
 * These E2E runner tests verify that the config values flow through to the
 * runner loop and review pass correctly.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runRunner, type RunnerOptions, type RunnerResult } from "./runner.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";
import { makeTestResolvedConfig } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "runner-gate-tuning-"));
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "pipe",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "# test\n");
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function createManagedWorktree(mainDir: string, slug: string): string {
  const worktreeDir = join(tmpdir(), `runner-gt-wt-${slug}-${Date.now()}`);
  execSync(`git worktree add "${worktreeDir}" -b "ralphai/${slug}" HEAD`, {
    cwd: mainDir,
    stdio: "pipe",
  });
  return worktreeDir;
}

function setupGlobalPipeline(cwd: string) {
  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  const dirs = getRepoPipelineDirs(cwd, { RALPHAI_HOME: ralphaiHome });
  return { ralphaiHome, ...dirs };
}

async function captureLogs(
  fn: () => Promise<unknown>,
): Promise<{ output: string; result: unknown }> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  let result: unknown;
  try {
    result = await fn();
  } finally {
    console.log = origLog;
  }
  return { output: logs.join("\n"), result };
}

// ---------------------------------------------------------------------------
// gate.maxRejections
// ---------------------------------------------------------------------------

describe("runRunner — gate.maxRejections", () => {
  let dir: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.RALPHAI_HOME;
    dir = createTmpGitRepo();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.RALPHAI_HOME;
    else process.env.RALPHAI_HOME = savedHome;
  });

  test("maxRejections=0 marks plan stuck immediately (never force-accepts)", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "maxrej-zero");

    writeFileSync(
      join(backlogDir, "maxrej-zero.md"),
      [
        "# Plan: maxRejections=0 Test",
        "",
        "- [ ] First task",
        "- [ ] Second task",
      ].join("\n"),
    );

    // Agent makes a commit and outputs COMPLETE without completing tasks.
    // With maxRejections=0, the first gate failure should mark stuck.
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "work-$(date +%s%N)" >> work.txt; git add -A; git commit -m "work"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { maxStuck: 10, review: false, maxRejections: 0 },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { output, result } = await captureLogs(() => runRunner(opts));
    const runnerResult = result as RunnerResult;

    // Plan should be stuck because maxRejections=0 means never force-accept
    expect(runnerResult.stuckSlugs).toContain("maxrej-zero");
    // Should see the zero-tasks stuck message
    expect(output).toContain("zero");
    // Should NOT see any rejection count messages (budget is 0)
    expect(output).not.toContain("1/0");
  });

  test("maxRejections=5 allows 5 rejections before accepting", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "maxrej-five");

    writeFileSync(
      join(backlogDir, "maxrej-five.md"),
      ["# Plan: maxRejections=5 Test", "", "- [ ] First task"].join("\n"),
    );

    // Agent makes a commit, writes progress (1/1 tasks), and outputs COMPLETE.
    // The feedback command always fails, so the gate always rejects.
    // With maxRejections=5, it should reject 5 times then force-accept
    // (partial progress since 1/1 tasks done).
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "work-$(date +%s%N)" >> work.txt; git add -A; git commit -m "work"; echo "<progress nonce=\\"$N\\">"; echo "- [x] First task"; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        hooks: { feedback: "exit 1" },
        gate: { maxStuck: 20, review: false, maxRejections: 5 },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { output, result } = await captureLogs(() => runRunner(opts));
    const runnerResult = result as RunnerResult;

    // Should NOT be stuck — partial progress means force-accept
    expect(runnerResult.stuckSlugs).not.toContain("maxrej-five");

    // Should see rejection counts going up to 5/5
    expect(output).toContain("5/5");

    // Should see the force-accept warning
    expect(output).toContain("accepting anyway");

    // Plan should be archived (force-accepted)
    expect(existsSync(join(archiveDir, "maxrej-five", "maxrej-five.md"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// gate.maxIterations
// ---------------------------------------------------------------------------

describe("runRunner — gate.maxIterations", () => {
  let dir: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.RALPHAI_HOME;
    dir = createTmpGitRepo();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.RALPHAI_HOME;
    else process.env.RALPHAI_HOME = savedHome;
  });

  test("maxIterations cap triggers stuck", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "maxiter-cap");

    writeFileSync(
      join(backlogDir, "maxiter-cap.md"),
      [
        "# Plan: maxIterations Cap Test",
        "",
        "- [ ] First task",
        "- [ ] Second task",
      ].join("\n"),
    );

    // Agent makes a commit each time but never claims COMPLETE.
    // With maxIterations=3, should be marked stuck after 3 iterations.
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "work-$(date +%s%N)" >> work.txt; git add -A; git commit -m "work iteration"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { maxStuck: 20, review: false, maxIterations: 3 },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { output, result } = await captureLogs(() => runRunner(opts));
    const runnerResult = result as RunnerResult;

    expect(runnerResult.stuckSlugs).toContain("maxiter-cap");
    expect(output).toContain("iteration limit reached");
    expect(output).toContain("3/3");
  });

  test("maxIterations=0 means unlimited (does not trigger stuck from iteration count)", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "maxiter-unlimited");

    writeFileSync(
      join(backlogDir, "maxiter-unlimited.md"),
      ["# Plan: maxIterations Unlimited Test", "", "- [ ] First task"].join(
        "\n",
      ),
    );

    // Agent completes the task on first iteration and claims COMPLETE.
    // maxIterations=0 should not interfere.
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "work-$(date +%s%N)" >> work.txt; git add -A; git commit -m "work"; echo "<progress nonce=\\"$N\\">"; echo "- [x] First task"; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { maxStuck: 20, review: false, maxIterations: 0 },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { output, result } = await captureLogs(() => runRunner(opts));
    const runnerResult = result as RunnerResult;

    // Should NOT be stuck
    expect(runnerResult.stuckSlugs).not.toContain("maxiter-unlimited");
    // Should complete normally
    expect(output).toContain("Plan complete after");
    expect(output).not.toContain("iteration limit reached");
  });
});
