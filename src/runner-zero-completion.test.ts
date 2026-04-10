/**
 * Tests for the zero-completion guard in the runner's completion gate.
 *
 * When the agent exhausts the gate rejection budget with zero tasks
 * completed (out of a non-zero total), the plan should be marked stuck
 * instead of force-accepted. Plans with partial progress (≥1 task)
 * should still be force-accepted as before.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runRunner, type RunnerOptions, type RunnerResult } from "./runner.ts";
import { getRepoPipelineDirs } from "./global-state.ts";
import { makeTestResolvedConfig } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Helpers (mirrors runner.test.ts patterns)
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "runner-zero-comp-"));
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

function setupGlobalPipeline(cwd: string) {
  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  const dirs = getRepoPipelineDirs(cwd, { RALPHAI_HOME: ralphaiHome });
  return { ralphaiHome, ...dirs };
}

// ---------------------------------------------------------------------------
// Zero-completion guard tests
// ---------------------------------------------------------------------------

describe("runRunner — zero-completion guard", () => {
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

  test("marks plan as stuck when gate budget exhausted with zero tasks completed", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "zero-comp");

    // Plan with checkbox-style tasks (totalTasks = 3)
    writeFileSync(
      join(backlogDir, "zero-comp.md"),
      [
        "# Plan: Zero Completion Test",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] First task",
        "- [ ] Second task",
        "- [ ] Third task",
      ].join("\n"),
    );

    // Agent that makes a commit each iteration (avoiding stuck detection)
    // but outputs COMPLETE without updating progress (zero tasks completed).
    // It needs to run 3 times: 1 initial + 2 rejections = exhausts budget.
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "iteration-marker-$(date +%s%N)" >> work.txt; git add -A; git commit -m "work iteration" --allow-empty-message; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: agentScript,
        maxStuck: 10,
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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    let result: RunnerResult;
    try {
      result = await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");

    // Plan should be marked as stuck, NOT accepted
    expect(result.stuckSlugs).toContain("zero-comp");

    // Plan should NOT be archived (it's stuck, not completed)
    expect(existsSync(join(archiveDir, "zero-comp", "zero-comp.md"))).toBe(
      false,
    );

    // Should see the zero-completion message in logs
    expect(output).toContain("zero");
  });

  test("force-accepts plan when gate budget exhausted with partial completion", async () => {
    const { backlogDir, archiveDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "partial-comp");

    // Plan with checkbox-style tasks (totalTasks = 3)
    writeFileSync(
      join(backlogDir, "partial-comp.md"),
      [
        "# Plan: Partial Completion Test",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] First task",
        "- [ ] Second task",
        "- [ ] Third task",
      ].join("\n"),
    );

    // Agent that makes a commit, reports 1/3 tasks done in progress,
    // and claims COMPLETE. The gate will reject because only 1/3 done,
    // but after exhausting the budget it should force-accept (partial progress).
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "work-$(date +%s%N)" >> work.txt; git add -A; git commit -m "work"; echo "<progress nonce=\\"$N\\">"; echo "- [x] First task"; echo "</progress>"; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\"><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agentCommand: agentScript,
        maxStuck: 10,
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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    let result: RunnerResult;
    try {
      result = await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    // Plan should NOT be stuck — it should be force-accepted
    expect(result.stuckSlugs).not.toContain("partial-comp");

    // Plan should be archived (force-accepted)
    expect(
      existsSync(join(archiveDir, "partial-comp", "partial-comp.md")),
    ).toBe(true);
  });
});
