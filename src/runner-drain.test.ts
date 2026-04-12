/**
 * Tests for default single-run, --drain, and exit summary behavior.
 *
 * These cover ACs from issue #212:
 *   - Default: single plan processed then exit
 *   - --drain: multiple plans processed sequentially until queue empty
 *   - Exit summary: "Completed N, skipped M (stuck)" with stuck slugs
 *   - Priority: in-progress plan resumes before backlog plans
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runRunner, type RunnerOptions } from "./runner.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";
import { makeTestResolvedConfig } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Helpers (shared pattern with runner.test.ts)
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ralphai-drain-"));
  execSync("git init --initial-branch=main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@ralphai.dev"', {
    cwd: dir,
    stdio: "pipe",
  });
  execSync('git config user.name "Ralphai Test"', {
    cwd: dir,
    stdio: "pipe",
  });
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });
  return dir;
}

function createManagedWorktree(mainDir: string, slug: string): string {
  const branch = `ralphai/${slug}`;
  // Use a worktree base *inside* the temp dir to avoid collisions across
  // parallel test files that all share /tmp/.ralphai-worktrees.
  const worktreeBase = join(mainDir, ".ralphai-worktrees");
  mkdirSync(worktreeBase, { recursive: true });
  const worktreeDir = join(worktreeBase, slug);
  execSync(`git worktree add "${worktreeDir}" -b "${branch}" main`, {
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

const completeAgent = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Done"; echo "**Status:** Complete"; echo "Finished."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;
const stuckAgent = `bash -c 'N=$RALPHAI_NONCE; echo "doing nothing"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

// ---------------------------------------------------------------------------
// Default single-run behavior
// ---------------------------------------------------------------------------

describe("default single-run", () => {
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

  test("processes only one backlog plan by default", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "plan-a");

    // Create two plans (alphabetical order: plan-a before plan-b)
    writeFileSync(
      join(backlogDir, "plan-a.md"),
      "# Plan: Plan A\n\n### Task 1: A\n",
    );
    writeFileSync(
      join(backlogDir, "plan-b.md"),
      "# Plan: Plan B\n\n### Task 1: B\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: completeAgent },
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

    const output = await captureLogs(() => runRunner(opts));

    // Only the first plan (alphabetically) should be archived
    expect(existsSync(join(archiveDir, "plan-a", "plan-a.md"))).toBe(true);
    expect(existsSync(join(archiveDir, "plan-b", "plan-b.md"))).toBe(false);
    expect(existsSync(join(backlogDir, "plan-b.md"))).toBe(true);
    expect(output).toContain("Completed 1");
  });

  test("summary reports completed count for single plan", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "solo");

    writeFileSync(
      join(backlogDir, "solo.md"),
      "# Plan: Solo\n\n### Task 1: Only\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: completeAgent },
        gate: { review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: true,
    };

    const output = await captureLogs(() => runRunner(opts));
    expect(output).toContain("Completed 1");
  });
});

// ---------------------------------------------------------------------------
// --drain flag
// ---------------------------------------------------------------------------

describe("--drain flag", () => {
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

  test("processes multiple plans sequentially", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "first");

    writeFileSync(
      join(backlogDir, "first.md"),
      "# Plan: First\n\n### Task 1: Do\n",
    );
    writeFileSync(
      join(backlogDir, "second.md"),
      "# Plan: Second\n\n### Task 1: Do\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: completeAgent },
        gate: { review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: true,
    };

    const output = await captureLogs(() => runRunner(opts));

    // Both plans should be archived in drain mode
    expect(existsSync(join(archiveDir, "first", "first.md"))).toBe(true);
    expect(existsSync(join(archiveDir, "second", "second.md"))).toBe(true);
    expect(existsSync(join(backlogDir, "second.md"))).toBe(false);
    expect(output).toContain("Completed 2");
  });
});

// ---------------------------------------------------------------------------
// Exit summary
// ---------------------------------------------------------------------------

describe("exit summary", () => {
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

  test("reports stuck plan slugs in exit summary", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "badplan");

    writeFileSync(
      join(backlogDir, "badplan.md"),
      "# Plan: Bad Plan\n\n### Task 1: Fail\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: stuckAgent },
        gate: { maxStuck: 2, review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: true,
    };

    const output = await captureLogs(() => runRunner(opts));
    expect(output).toContain("skipped 1 (stuck)");
    expect(output).toContain("badplan");
  });

  test("reports both completed and stuck in mixed run", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "aaa-good");

    // "aaa-good" sorts before "bbb-stuck" alphabetically
    writeFileSync(
      join(backlogDir, "aaa-good.md"),
      "# Plan: Good Plan\n\n### Task 1: Do\n",
    );
    writeFileSync(
      join(backlogDir, "bbb-stuck.md"),
      "# Plan: Stuck Plan\n\n### Task 1: Fail\n",
    );

    // Agent that completes on first call (aaa-good), then does nothing
    // on subsequent calls (bbb-stuck). Plan order is alphabetical, so
    // aaa-good runs first. We track calls via a counter file.
    const counterFile = join(dir, ".agent-counter");
    writeFileSync(counterFile, "0");
    // Agent that completes on first call, then does nothing on subsequent calls
    const mixedAgent = `bash -c 'N=$RALPHAI_NONCE; count=$(cat "${counterFile}"); if [ "$count" = "0" ]; then echo 1 > "${counterFile}"; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Do"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"; else echo "doing nothing"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"; fi'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: mixedAgent },
        gate: { maxStuck: 2, review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: true,
    };

    const output = await captureLogs(() => runRunner(opts));

    // aaa-good should be archived
    expect(existsSync(join(archiveDir, "aaa-good", "aaa-good.md"))).toBe(true);
    // Summary should show both
    expect(output).toContain("Completed 1");
    expect(output).toContain("skipped 1 (stuck)");
    expect(output).toContain("bbb-stuck");
  });

  test("no summary when nothing happened", async () => {
    setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "empty-run");

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: "echo" },
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

    const output = await captureLogs(() => runRunner(opts));
    // Should print "Nothing to do" but not a "Completed/skipped" summary
    expect(output).toContain("Nothing to do");
    expect(output).not.toContain("Completed");
    expect(output).not.toContain("skipped");
  });
});

// ---------------------------------------------------------------------------
// Priority: in-progress resumes before backlog
// ---------------------------------------------------------------------------

describe("priority: in-progress before backlog", () => {
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

  test("resumes in-progress plan before picking backlog plan", async () => {
    const { backlogDir, wipDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "resumed");

    // Create an in-progress plan (simulates a previously started plan)
    const inProgressDir = join(wipDir, "resumed");
    mkdirSync(inProgressDir, { recursive: true });
    writeFileSync(
      join(inProgressDir, "resumed.md"),
      "# Plan: Resumed Plan\n\n### Task 1: Continue\n",
    );
    writeFileSync(
      join(inProgressDir, "progress.md"),
      "## Progress\n\nStarted but not finished.\n",
    );

    // Also add a backlog plan
    writeFileSync(
      join(backlogDir, "zzz-later.md"),
      "# Plan: Later Plan\n\n### Task 1: Wait\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: completeAgent },
        gate: { review: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false, // only process one to verify priority
    };

    const output = await captureLogs(() => runRunner(opts));

    // In-progress plan should be archived (it was processed first)
    expect(existsSync(join(archiveDir, "resumed", "resumed.md"))).toBe(true);
    // Backlog plan should still be in backlog (default single-run stopped after first)
    expect(existsSync(join(backlogDir, "zzz-later.md"))).toBe(true);
    expect(output).toContain("in-progress");
  });
});
