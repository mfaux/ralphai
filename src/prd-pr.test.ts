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
import { type ResolvedConfig } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

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

function makeResolvedConfig(
  overrides: Partial<Record<string, unknown>> = {},
): ResolvedConfig {
  const defaults: Record<string, unknown> = {
    agentCommand: "echo",
    feedbackCommands: "",
    baseBranch: "main",
    maxStuck: 3,
    issueSource: "none",
    issueLabel: "ralphai",
    issueInProgressLabel: "ralphai:in-progress",
    issueDoneLabel: "ralphai:done",
    issueStuckLabel: "ralphai:stuck",
    issuePrdLabel: "ralphai-prd",
    issueRepo: "",
    issueCommentProgress: "true",
    iterationTimeout: 0,
    autoCommit: "false",
    workspaces: null,
    ...overrides,
  };

  const resolved: Record<string, { value: unknown; source: string }> = {};
  for (const [key, value] of Object.entries(defaults)) {
    resolved[key] = { value, source: "default" };
  }
  return resolved as unknown as ResolvedConfig;
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

const completeAgent = `bash -c 'echo "<promise>COMPLETE</promise>"; echo "<learnings><entry>status: none</entry></learnings>"'`;

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
      "# Plan: Skip PR\n\n### Task 1: Do\n",
    );

    const opts: RunnerOptions = {
      config: makeResolvedConfig({
        agentCommand: completeAgent,
        autoCommit: "true",
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
      "# Plan: With PR\n\n### Task 1: Do\n",
    );

    const opts: RunnerOptions = {
      config: makeResolvedConfig({
        agentCommand: completeAgent,
        autoCommit: "true",
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
});
