/**
 * Tests for src/runner.ts — the TypeScript runner orchestration loop.
 *
 * Focuses on key runner behaviors (dry-run, stuck detection, completion detection).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runRunner, type RunnerOptions, type RunnerResult } from "./runner.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";
import { makeTestResolvedConfig } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Helpers for integration tests
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "runner-test-"));
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
  const worktreeDir = join(tmpdir(), `runner-wt-${slug}-${Date.now()}`);
  execSync(`git worktree add "${worktreeDir}" -b "ralphai/${slug}" HEAD`, {
    cwd: mainDir,
    stdio: "pipe",
  });
  return worktreeDir;
}

/**
 * Create a global-state pipeline directory structure for a temp repo.
 * Sets RALPHAI_HOME to a temp dir so global-state functions resolve there.
 * Returns the pipeline dirs.
 */
function setupGlobalPipeline(cwd: string) {
  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  const dirs = getRepoPipelineDirs(cwd, { RALPHAI_HOME: ralphaiHome });
  return { ralphaiHome, ...dirs };
}

/** Capture console.log output during an async function. */
async function captureLogs(fn: () => Promise<unknown>): Promise<string> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return logs.join("\n");
}

// ---------------------------------------------------------------------------
// runRunner — dry-run mode
// ---------------------------------------------------------------------------

describe("runRunner — dry-run", () => {
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

  test("dry-run with no plans exits cleanly", async () => {
    setupGlobalPipeline(dir);

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    // Should not throw
    await runRunner(opts);
  });

  test("dry-run with no plans shows reason in output", async () => {
    setupGlobalPipeline(dir);

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const output = await captureLogs(() => runRunner(opts));

    // issueSource defaults to "none", so peek.message should appear
    expect(output).toContain("No runnable work found.");
    expect(output).toContain("not 'github'");
  });

  test("dry-run with a backlog plan prints preview", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);

    writeFileSync(
      join(backlogDir, "test-plan.md"),
      "# Plan: Test Plan\n\n## Implementation Tasks\n\n### Task 1: Do something\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    // dry-run should not create branches or modify state
    await runRunner(opts);

    // The plan should still be in backlog (dry-run doesn't promote)
    expect(existsSync(join(backlogDir, "test-plan.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runRunner — plan completion
// ---------------------------------------------------------------------------

describe("runRunner — completion", () => {
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

  test("detects COMPLETE marker and archives plan", async () => {
    const { backlogDir, wipDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "simple");

    writeFileSync(
      join(backlogDir, "simple.md"),
      "# Plan: Simple Plan\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    // Agent command that outputs progress, COMPLETE marker, and learnings
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Test"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    await runRunner(opts);

    // Plan should have been archived
    expect(existsSync(join(archiveDir, "simple", "simple.md"))).toBe(true);
    expect(existsSync(join(wipDir, "simple", "simple.md"))).toBe(false);
  });

  test("persists agent-output.log and archives it with the plan", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "logtest");

    writeFileSync(
      join(backlogDir, "logtest.md"),
      "# Plan: Log Test\n\n## Implementation Tasks\n\n### Task 1: Verify logging\n",
    );

    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "agent-says-hello"; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Verify logging"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    await runRunner(opts);

    // agent-output.log should be archived alongside the plan
    const logFile = join(archiveDir, "logtest", "agent-output.log");
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("--- Iteration 1 ---");
    expect(content).toContain("agent-says-hello");
  });

  test("stuck detection triggers after maxStuck tasks with no progress", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "stuck");

    writeFileSync(
      join(backlogDir, "stuck.md"),
      "# Plan: Stuck Plan\n\n### Task 1: Test\n",
    );

    // Agent that does nothing (no commits, no COMPLETE)
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "doing nothing"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { maxStuck: 2, review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    // Stuck plans are now skipped instead of process.exit(1).
    // The runner should exit normally after exhausting the backlog.
    const output = await captureLogs(() => runRunner(opts));

    expect(output).toContain("Stuck:");
    expect(output).toContain("skipped 1 (stuck)");
    expect(output).toContain("stuck");
  });
});

// ---------------------------------------------------------------------------
// runRunner — RunnerResult return type
// ---------------------------------------------------------------------------

describe("runRunner — RunnerResult", () => {
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

  test("returns stuck slugs when a plan gets stuck", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "stuck-result");

    writeFileSync(
      join(backlogDir, "stuck-result.md"),
      "# Plan: Stuck Result\n\n### Task 1: Test\n",
    );

    // Agent that does nothing (no commits, no COMPLETE)
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "doing nothing"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { maxStuck: 2, review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const origLog = console.log;
    console.log = () => {};
    let result: RunnerResult;
    try {
      result = await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    expect(result.stuckSlugs).toBeArrayOfSize(1);
    expect(result.stuckSlugs[0]).toBe("stuck-result");
  });

  test("returns empty stuckSlugs on successful completion", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "success-result");

    writeFileSync(
      join(backlogDir, "success-result.md"),
      "# Plan: Success\n\n### Task 1: Test\n",
    );

    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Test"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const result = await runRunner(opts);

    expect(result.stuckSlugs).toEqual([]);
    expect(result.interrupted).toBe(false);
  });

  test("returns accumulated learnings from the run", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "learnings-result");

    writeFileSync(
      join(backlogDir, "learnings-result.md"),
      "# Plan: Learnings\n\n### Task 1: Test\n",
    );

    // Agent that emits a learning and completes
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Test"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">The auth module requires warm-up.</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const result = await runRunner(opts);

    expect(result.accumulatedLearnings).toBeArrayOfSize(1);
    expect(result.accumulatedLearnings[0]).toBe(
      "The auth module requires warm-up.",
    );
  });

  test("dry-run returns empty stuckSlugs", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);

    writeFileSync(
      join(backlogDir, "dry-run-result.md"),
      "# Plan: Dry Run\n\n### Task 1: Test\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const result = await runRunner(opts);

    expect(result.stuckSlugs).toEqual([]);
    expect(result.accumulatedLearnings).toEqual([]);
    expect(result.interrupted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runRunner — empty backlog
// ---------------------------------------------------------------------------

describe("runRunner — no work", () => {
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.RALPHAI_HOME;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.RALPHAI_HOME;
    else process.env.RALPHAI_HOME = savedHome;
  });

  test("exits cleanly when backlog is empty", async () => {
    const dir = createTmpGitRepo();
    setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "empty");

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig(),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    // Should not throw — just prints "nothing to do" and returns
    await runRunner(opts);
  });
});
