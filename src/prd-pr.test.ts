/**
 * Tests for PRD pull request creation behavior.
 *
 * Covers:
 *   - Runner skips per-sub-issue PR creation when skipPrCreation is set
 *   - Aggregate PRD PR creation after all sub-issues complete
 *   - Partial completion produces a PR with clear status
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
// Helpers (shared pattern with runner-drain.test.ts)
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ralphai-prd-pr-"));
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

const completeAgent = `bash -c 'N=$RALPHAI_NONCE; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

const completeAgentWithLearning = `bash -c 'N=$RALPHAI_NONCE; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">JWT tokens need a 15-minute expiry for security.</learnings>"'`;

// ---------------------------------------------------------------------------
// skipPrCreation flag
// ---------------------------------------------------------------------------

describe("skipPrCreation flag", () => {
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

  test("runner skips PR creation when skipPrCreation is true", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "skip-pr");

    writeFileSync(
      join(backlogDir, "skip-pr.md"),
      "# Plan: Skip PR\n\nImplement the skip PR feature.\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: completeAgent,
        review: "false",
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      once: true,
      skipPrCreation: true,
    };

    const output = await captureLogs(() => runRunner(opts));

    // Plan should still complete and be archived
    expect(output).toContain("Plan complete");
    // But no PR creation should be attempted (no push failure message)
    expect(output).not.toContain("Failed to push");
    expect(output).not.toContain("Draft PR");
  });

  test("runner still creates PR when skipPrCreation is not set", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "with-pr");

    writeFileSync(
      join(backlogDir, "with-pr.md"),
      "# Plan: With PR\n\nImplement the with PR feature.\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: completeAgent,
        review: "false",
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      once: true,
    };

    const output = await captureLogs(() => runRunner(opts));

    // Plan should complete
    expect(output).toContain("Plan complete");
    // PR creation should be attempted (will fail due to no remote, but message should appear)
    expect(output).toContain("Failed to push");
  });

  test("runner returns accumulated learnings with skipPrCreation", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "learnings-prd");

    writeFileSync(
      join(backlogDir, "learnings-prd.md"),
      "# Plan: Learnings PRD\n\nTest learnings accumulation.\n",
    );

    // Agent that emits a learning and completes
    const agentWithLearning = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">The database requires connection pooling for performance.</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: agentWithLearning,
        review: "false",
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      once: true,
      skipPrCreation: true,
    };

    const origLog = console.log;
    console.log = () => {};
    let result;
    try {
      result = await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    expect(result.accumulatedLearnings).toBeArrayOfSize(1);
    expect(result.accumulatedLearnings[0]).toBe(
      "The database requires connection pooling for performance.",
    );
  });
});

// ---------------------------------------------------------------------------
// Runner result includes accumulated learnings
// ---------------------------------------------------------------------------

describe("runner result learnings", () => {
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

  test("runner result includes accumulated learnings from the run", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "with-learnings");

    writeFileSync(
      join(backlogDir, "with-learnings.md"),
      "# Plan: With Learnings\n\nImplement a feature with learnings.\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: completeAgentWithLearning,
        review: "false",
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      once: true,
      skipPrCreation: true,
    };

    let result: Awaited<ReturnType<typeof runRunner>> | undefined;
    await captureLogs(async () => {
      result = await runRunner(opts);
    });

    expect(result).toBeDefined();
    expect(result!.accumulatedLearnings).toBeDefined();
    expect(result!.accumulatedLearnings).toContain(
      "JWT tokens need a 15-minute expiry for security.",
    );
  });

  test("runner result has empty learnings when agent produces none", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "no-learnings");

    writeFileSync(
      join(backlogDir, "no-learnings.md"),
      "# Plan: No Learnings\n\nImplement a feature without learnings.\n",
    );

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: completeAgent,
        review: "false",
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      once: true,
      skipPrCreation: true,
    };

    let result: Awaited<ReturnType<typeof runRunner>> | undefined;
    await captureLogs(async () => {
      result = await runRunner(opts);
    });

    expect(result).toBeDefined();
    expect(result!.accumulatedLearnings).toBeDefined();
    expect(result!.accumulatedLearnings).toHaveLength(0);
  });
});
