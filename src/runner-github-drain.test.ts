/**
 * Tests for runner drain behavior with GitHub issue pulls.
 *
 * Uses mock.module to control pullGithubIssues and pullPrdSubIssue so
 * we can test the single-issue-then-stop vs PRD-continues-draining
 * behavior without requiring a real GitHub repo.
 *
 * Separate file because mock.module() leaks across tests in the same
 * bun process.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import type { PullIssueOptions, PullIssueResult } from "./issues.ts";
import type { RunnerOptions } from "./runner.ts";
import type { ResolvedConfig } from "./config.ts";

// ---------------------------------------------------------------------------
// Mock pullGithubIssues and pullPrdSubIssue from ./issues.ts
// ---------------------------------------------------------------------------

const realIssues = await import("./issues.ts");

const mockPullGithubIssues =
  mock<(options: PullIssueOptions) => PullIssueResult>();
const mockPullPrdSubIssue =
  mock<(options: PullIssueOptions) => PullIssueResult>();

mock.module("./issues.ts", () => ({
  ...realIssues,
  pullGithubIssues: mockPullGithubIssues,
  pullPrdSubIssue: mockPullPrdSubIssue,
}));

// Import runner AFTER mocking so it picks up the mocked issues module
const { runRunner } = await import("./runner.ts");

const { getRepoPipelineDirs } = await import("./global-state.ts");

// ---------------------------------------------------------------------------
// Helpers (shared pattern with runner-drain.test.ts)
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ralphai-gh-drain-"));
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
    issueSource: "github",
    issueLabel: "ralphai",
    issueInProgressLabel: "ralphai:in-progress",
    issueDoneLabel: "ralphai:done",
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
async function captureLogs(fn: () => Promise<void>): Promise<string> {
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

/**
 * Helper: create a mock pullGithubIssues that writes a NEW plan file to the
 * backlog on every call (simulating multiple available GitHub issues),
 * up to a maximum count.
 */
function makePullGithubMultiple(backlogDir: string, slugs: string[]) {
  let called = 0;
  return (options: PullIssueOptions): PullIssueResult => {
    if (called < slugs.length) {
      const slug = slugs[called]!;
      called++;
      const planPath = join(backlogDir, `${slug}.md`);
      writeFileSync(
        planPath,
        `---\nsource: github\nissue: ${40 + called}\n---\n\n# Plan: ${slug}\n\n### Task 1: Do\n`,
      );
      return {
        pulled: true,
        planPath,
        message: `Pulled issue #${40 + called}`,
      };
    }
    return { pulled: false, message: "No more issues" };
  };
}

/**
 * Helper: create a mock pullPrdSubIssue that writes plan files on first N
 * calls (simulating multiple PRD sub-issues), then returns pulled: false.
 */
function makePullPrdMultiple(backlogDir: string, slugs: string[]) {
  let called = 0;
  return (options: PullIssueOptions): PullIssueResult => {
    if (called < slugs.length) {
      const slug = slugs[called]!;
      called++;
      const planPath = join(backlogDir, `${slug}.md`);
      writeFileSync(
        planPath,
        `---\nsource: github\nissue: ${100 + called}\n---\n\n# Plan: ${slug}\n\n### Task 1: Do\n`,
      );
      return { pulled: true, planPath, message: `Pulled PRD sub-issue` };
    }
    return { pulled: false, message: "No more PRD sub-issues" };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runner GitHub drain behavior", () => {
  let dir: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.RALPHAI_HOME;
    dir = createTmpGitRepo();
    mockPullGithubIssues.mockReset();
    mockPullPrdSubIssue.mockReset();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.RALPHAI_HOME;
    else process.env.RALPHAI_HOME = savedHome;
  });

  test("stops after completing a single regular GitHub issue pull", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "gh-issue-a");

    // Mock: PRD returns nothing, regular pull has 3 available issues
    // The runner should only process ONE, then stop.
    mockPullPrdSubIssue.mockImplementation(() => ({
      pulled: false,
      message: "No PRD sub-issues",
    }));
    mockPullGithubIssues.mockImplementation(
      makePullGithubMultiple(backlogDir, [
        "gh-issue-a",
        "gh-issue-b",
        "gh-issue-c",
      ]),
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
      once: false, // NOT using --once, drain should still stop after one GitHub issue
    };

    const output = await captureLogs(() => runRunner(opts));

    // The first pulled issue should be processed and archived
    expect(existsSync(join(archiveDir, "gh-issue-a", "gh-issue-a.md"))).toBe(
      true,
    );
    // The second and third issues should NOT have been pulled/processed
    expect(existsSync(join(archiveDir, "gh-issue-b", "gh-issue-b.md"))).toBe(
      false,
    );
    expect(existsSync(join(archiveDir, "gh-issue-c", "gh-issue-c.md"))).toBe(
      false,
    );
    // Runner should stop after exactly one plan
    expect(output).toContain("Completed 1");
  });

  test("continues draining when pulling PRD sub-issues", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "prd-sub-a");

    // Mock: PRD returns two sub-issues sequentially, then stops
    mockPullPrdSubIssue.mockImplementation(
      makePullPrdMultiple(backlogDir, ["prd-sub-a", "prd-sub-b"]),
    );
    mockPullGithubIssues.mockImplementation(() => ({
      pulled: false,
      message: "No regular issues",
    }));

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
      once: false,
    };

    const output = await captureLogs(() => runRunner(opts));

    // Both PRD sub-issues should be processed and archived
    expect(existsSync(join(archiveDir, "prd-sub-a", "prd-sub-a.md"))).toBe(
      true,
    );
    expect(existsSync(join(archiveDir, "prd-sub-b", "prd-sub-b.md"))).toBe(
      true,
    );
    // Runner should have completed both
    expect(output).toContain("Completed 2");
  });
});
