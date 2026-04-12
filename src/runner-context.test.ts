/**
 * Tests for in-memory context accumulation in the runner loop.
 *
 * Verifies that:
 * - Context is extracted from agent output and accumulated in memory
 * - Console messages indicate context status (logged, none, no block)
 * - Context is NOT returned in RunnerResult (per-plan scope only)
 * - prompt.context=false skips all context extraction and warnings
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runRunner, type RunnerOptions } from "./runner.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";
import { makeTestResolvedConfig } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Helpers (shared pattern with runner-learnings.test.ts)
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "runner-ctx-"));
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
  const worktreeDir = join(tmpdir(), `runner-wt-ctx-${slug}-${Date.now()}`);
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

/** Capture console.log output during a runner invocation. */
function captureConsoleLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
    origLog(...args);
  };
  return { logs, restore: () => (console.log = origLog) };
}

// ---------------------------------------------------------------------------
// In-memory context tests
// ---------------------------------------------------------------------------

describe("runRunner — in-memory context", () => {
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

  test("logs context from agent output", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "ctx1");

    writeFileSync(
      join(backlogDir, "ctx1.md"),
      "# Plan: Context Test\n\nImplement the context test feature.\n",
    );

    // Agent outputs a context block and COMPLETE marker
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<context nonce=\\"$N\\">The auth module uses JWT tokens stored in Redis.</context>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
        prompt: { context: true },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { logs, restore } = captureConsoleLog();
    try {
      await runRunner(opts);
    } finally {
      restore();
    }

    const output = logs.join("\n");
    expect(output).toContain(
      "Logged context: The auth module uses JWT tokens stored in Redis.",
    );
  });

  test("logs 'No context' when agent reports none", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "ctx2");

    writeFileSync(
      join(backlogDir, "ctx2.md"),
      "# Plan: No Context\n\nImplement the no-context test feature.\n",
    );

    // Agent outputs <context>none</context>
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<context nonce=\\"$N\\">none</context>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
        prompt: { context: true },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { logs, restore } = captureConsoleLog();
    try {
      await runRunner(opts);
    } finally {
      restore();
    }

    const output = logs.join("\n");
    expect(output).toContain("No context logged this iteration.");
  });

  test("warns when no context block found in agent output", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "ctx3");

    writeFileSync(
      join(backlogDir, "ctx3.md"),
      "# Plan: Missing Context Block\n\nImplement the missing-block test feature.\n",
    );

    // Agent outputs COMPLETE and learnings but no <context> block
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
        prompt: { context: true },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { logs, restore } = captureConsoleLog();
    try {
      await runRunner(opts);
    } finally {
      restore();
    }

    const output = logs.join("\n");
    expect(output).toContain(
      "WARNING: No <context> block found in agent output.",
    );
  });

  test("prompt.context=false skips all context extraction and warnings", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "ctx4");

    writeFileSync(
      join(backlogDir, "ctx4.md"),
      "# Plan: Context Disabled\n\nImplement the context-disabled test feature.\n",
    );

    // Agent outputs COMPLETE but no context block — with prompt.context=false
    // there should be no warning about missing context
    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
        prompt: { context: false },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { logs, restore } = captureConsoleLog();
    try {
      await runRunner(opts);
    } finally {
      restore();
    }

    const output = logs.join("\n");
    // No context extraction-related messages at all
    expect(output).not.toContain("Logged context:");
    expect(output).not.toContain("No context logged");
    expect(output).not.toContain("No <context> block found");
    // But learnings messages should still appear
    expect(output).toContain("No learning logged this iteration.");
  });

  test("context is NOT included in RunnerResult", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "ctx5");

    writeFileSync(
      join(backlogDir, "ctx5.md"),
      "# Plan: Context Scope\n\nImplement the context-scope test feature.\n",
    );

    const agentScript = `bash -c 'N=$RALPHAI_NONCE; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<context nonce=\\"$N\\">Session context note.</context>"; echo "<learnings nonce=\\"$N\\">none</learnings>"'`;

    const opts: RunnerOptions = {
      config: makeTestResolvedConfig({
        agent: { command: agentScript },
        gate: { review: false },
        prompt: { context: true },
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      drain: false,
    };

    const { logs, restore } = captureConsoleLog();
    let result;
    try {
      result = await runRunner(opts);
    } finally {
      restore();
    }

    // RunnerResult should not have an accumulatedContext field
    expect(result).not.toHaveProperty("accumulatedContext");
    // Learnings are still returned
    expect(result).toHaveProperty("accumulatedLearnings");
  });
});
