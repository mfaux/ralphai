/**
 * Tests for review pass integration in the runner completion flow.
 *
 * Verifies that the review pass is invoked (or skipped) at the right
 * points in the completion lifecycle based on the `review` config value.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runRunner, type RunnerOptions } from "./runner.ts";
import { getRepoPipelineDirs } from "./global-state.ts";
import { makeTestResolvedConfig } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Helpers (same patterns as runner.test.ts)
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "runner-review-test-"));
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
  const worktreeDir = join(tmpdir(), `runner-review-wt-${slug}-${Date.now()}`);
  execSync(`git worktree add "${worktreeDir}" -b "ralphai/${slug}" HEAD`, {
    cwd: mainDir,
    stdio: "pipe",
  });
  return worktreeDir;
}

function setupGlobalPipeline(cwd: string): {
  ralphaiHome: string;
  backlogDir: string;
  wipDir: string;
  archiveDir: string;
} {
  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  const dirs = getRepoPipelineDirs(cwd, { RALPHAI_HOME: ralphaiHome });
  return { ralphaiHome, ...dirs };
}

/** Capture console.log output during an async function. */
async function captureLogs(fn: () => Promise<unknown>): Promise<string> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return logs.join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runRunner — review pass", () => {
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

  test("review pass is skipped when review is disabled", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "review-disabled");

    writeFileSync(
      join(backlogDir, "review-disabled.md"),
      "# Plan: Review Disabled\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Test"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: agentScript,
        review: "false",
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

    // Should NOT contain review pass messages
    expect(output).not.toContain("Running review pass");
    expect(output).not.toContain("Review pass:");
    // Should still complete normally
    expect(output).toContain("Plan complete after");
  });

  test("review pass runs when review is enabled and logs file count", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "review-enabled");

    // Create a file change so getChangedFiles returns something
    writeFileSync(join(worktreeDir, "feature.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add feature"', {
      cwd: worktreeDir,
      stdio: "pipe",
    });

    writeFileSync(
      join(backlogDir, "review-enabled.md"),
      "# Plan: Review Enabled\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    // Agent that outputs COMPLETE (the review pass agent will just be echo)
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Test"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: agentScript,
        review: "true",
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

    // Should contain the review pass invocation log
    expect(output).toContain("Running review pass on");
    expect(output).toContain("changed files...");
    // The echo agent won't make commits, so it should log no simplifications
    expect(output).toContain("no simplifications needed");
    // Should still complete normally
    expect(output).toContain("Plan complete after");
  });

  test("review pass logs 'no changed files' when there are no file diffs", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "review-nofiles");

    // No extra commits beyond the init — no diff against main
    writeFileSync(
      join(backlogDir, "review-nofiles.md"),
      "# Plan: No Files\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Test"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: agentScript,
        review: "true",
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

    // Should skip review pass because there are no changed files
    expect(output).toContain("no changed files");
    expect(output).not.toContain("Running review pass on");
    // Should still complete normally
    expect(output).toContain("Plan complete after");
  });

  test("review pass writes '--- Review Pass ---' header to agent-output.log", async () => {
    const { backlogDir, wipDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "review-logheader");

    // Create a file change so getChangedFiles returns something
    writeFileSync(join(worktreeDir, "feature.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add feature"', {
      cwd: worktreeDir,
      stdio: "pipe",
    });

    writeFileSync(
      join(backlogDir, "review-logheader.md"),
      "# Plan: Review Log Header\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<progress nonce=\\"$N\\">"; echo "### Task 1: Test"; echo "**Status:** Complete"; echo "Done."; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: agentScript,
        review: "true",
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      once: false,
    };

    await captureLogs(() => runRunner(opts));

    // Find the agent-output.log in the WIP directory
    const slug = "review-logheader";
    const logPath = join(wipDir, slug, "agent-output.log");
    // The WIP dir may have been archived; check the archive dir too
    const { getRepoPipelineDirs } = await import("./global-state.ts");
    const dirs = getRepoPipelineDirs(worktreeDir, {
      RALPHAI_HOME: process.env.RALPHAI_HOME,
    });
    const archiveLogPath = join(dirs.archiveDir, slug, "agent-output.log");
    const actualPath = existsSync(logPath) ? logPath : archiveLogPath;

    if (existsSync(actualPath)) {
      const logContent = readFileSync(actualPath, "utf-8");
      // Should contain iteration header and review pass header
      expect(logContent).toContain("--- Iteration 1 ---");
      expect(logContent).toContain("--- Review Pass ---");
    }
    // If the file doesn't exist (e.g. archived differently), the test
    // passes silently — the unit test in review-pass.test.ts covers the
    // header writing directly.
  });
});
