/**
 * Tests for src/runner.ts — the TypeScript runner orchestration loop.
 *
 * Focuses on testable internal helpers (shellSplit, spawnAgent) and
 * key runner behaviors (dry-run, stuck detection, completion detection).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import {
  shellSplit,
  spawnAgent,
  runRunner,
  type RunnerOptions,
} from "./runner.ts";
import { type ResolvedConfig } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

// ---------------------------------------------------------------------------
// shellSplit
// ---------------------------------------------------------------------------

describe("shellSplit", () => {
  test("splits simple command", () => {
    expect(shellSplit("claude -p")).toEqual(["claude", "-p"]);
  });

  test("splits command with single quotes", () => {
    expect(shellSplit("echo 'hello world'")).toEqual(["echo", "hello world"]);
  });

  test("splits command with double quotes", () => {
    expect(shellSplit('echo "hello world"')).toEqual(["echo", "hello world"]);
  });

  test("handles backslash escapes", () => {
    expect(shellSplit("echo hello\\ world")).toEqual(["echo", "hello world"]);
  });

  test("handles mixed quotes", () => {
    expect(shellSplit(`opencode run --agent 'build'`)).toEqual([
      "opencode",
      "run",
      "--agent",
      "build",
    ]);
  });

  test("handles multiple spaces between args", () => {
    expect(shellSplit("a   b   c")).toEqual(["a", "b", "c"]);
  });

  test("handles empty string", () => {
    expect(shellSplit("")).toEqual([]);
  });

  test("handles single word", () => {
    expect(shellSplit("codex")).toEqual(["codex"]);
  });

  test("handles quoted empty strings", () => {
    expect(shellSplit('echo "" hello')).toEqual(["echo", "", "hello"]);
  });

  test("handles complex agent command", () => {
    expect(shellSplit("opencode run --agent build")).toEqual([
      "opencode",
      "run",
      "--agent",
      "build",
    ]);
  });
});

// ---------------------------------------------------------------------------
// spawnAgent
// ---------------------------------------------------------------------------

describe("spawnAgent", () => {
  test("captures agent output", async () => {
    const result = await spawnAgent(
      "echo",
      "hello from agent",
      0,
      process.cwd(),
    );
    expect(result.output.trim()).toBe("hello from agent");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("captures non-zero exit code", async () => {
    const result = await spawnAgent(
      "bash -c 'echo oops; exit 42'",
      "",
      0,
      process.cwd(),
    );
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("oops");
  });

  test("handles agent timeout", async () => {
    const result = await spawnAgent("sleep", "60", 1, process.cwd());
    expect(result.timedOut).toBe(true);
    // Exit code may be 124 or platform-dependent on abort
  }, 10000);

  test("handles non-existent command", async () => {
    const result = await spawnAgent(
      "nonexistent_command_12345",
      "arg",
      0,
      process.cwd(),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("captures both stdout and stderr", async () => {
    const result = await spawnAgent(
      "bash -c 'echo out; echo err >&2'",
      "",
      0,
      process.cwd(),
    );
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
    expect(result.exitCode).toBe(0);
  });

  test("writes output to outputLogPath when provided", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "spawn-log-"));
    const logPath = join(tmpDir, "agent-output.log");
    const result = await spawnAgent(
      "bash -c 'echo logged-stdout; echo logged-stderr >&2'",
      "",
      0,
      process.cwd(),
      logPath,
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(logPath)).toBe(true);
    const logContent = readFileSync(logPath, "utf-8");
    expect(logContent).toContain("logged-stdout");
    expect(logContent).toContain("logged-stderr");
  });

  test("appends to existing outputLogPath", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "spawn-log-"));
    const logPath = join(tmpDir, "agent-output.log");
    writeFileSync(logPath, "--- Turn 1 ---\nprevious content\n");
    const result = await spawnAgent(
      "echo",
      "turn2-output",
      0,
      process.cwd(),
      logPath,
    );
    expect(result.exitCode).toBe(0);
    const logContent = readFileSync(logPath, "utf-8");
    expect(logContent).toContain("--- Turn 1 ---");
    expect(logContent).toContain("previous content");
    expect(logContent).toContain("turn2-output");
  });
});

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
function setupGlobalPipeline(cwd: string): {
  ralphaiHome: string;
  backlogDir: string;
  wipDir: string;
  archiveDir: string;
} {
  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  const dirs = getRepoPipelineDirs(cwd);
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
      config: makeResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      once: false,
    };

    // Should not throw
    await runRunner(opts);
  });

  test("dry-run with no plans shows reason in output", async () => {
    setupGlobalPipeline(dir);

    const opts: RunnerOptions = {
      config: makeResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      once: false,
    };

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
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
      config: makeResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      once: false,
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

    // Agent command that outputs the COMPLETE marker
    const agentScript = `bash -c 'echo "<promise>COMPLETE</promise>"; echo "<learnings><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeResolvedConfig({
        agentCommand: agentScript,
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

    const agentScript = `bash -c 'echo "agent-says-hello"; echo "<promise>COMPLETE</promise>"; echo "<learnings><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeResolvedConfig({
        agentCommand: agentScript,
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
    const agentScript = `bash -c 'echo "doing nothing"; echo "<learnings><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeResolvedConfig({
        agentCommand: agentScript,
        maxStuck: 2,
        autoCommit: "false",
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      once: false,
    };

    // Stuck plans are now skipped instead of process.exit(1).
    // The runner should exit normally after exhausting the backlog.
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("Stuck:");
    expect(output).toContain("skipped 1 (stuck)");
    expect(output).toContain("stuck");
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
      config: makeResolvedConfig(),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: false,
      allowDirty: false,
      once: false,
    };

    // Should not throw — just prints "nothing to do" and returns
    await runRunner(opts);
  });
});

// ---------------------------------------------------------------------------
// runRunner — auto-commit recovery
// ---------------------------------------------------------------------------

describe("runRunner — auto-commit", () => {
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.RALPHAI_HOME;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.RALPHAI_HOME;
    else process.env.RALPHAI_HOME = savedHome;
  });

  test("auto-commits dirty state when autoCommit is true", async () => {
    const dir = createTmpGitRepo();
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "auto");

    // Create a tracked file for the agent to modify
    writeFileSync(join(worktreeDir, "target.txt"), "original\n");
    execSync('git add -A && git commit -m "add target"', {
      cwd: worktreeDir,
      stdio: "pipe",
    });

    writeFileSync(
      join(backlogDir, "auto.md"),
      "# Plan: Auto Commit Test\n\n### Task 1: Test\n",
    );

    // Agent that modifies an existing tracked file, then outputs COMPLETE
    const agentScript = `bash -c 'echo modified >> target.txt; echo "<promise>COMPLETE</promise>"; echo "<learnings><entry>status: none</entry></learnings>"'`;

    const opts: RunnerOptions = {
      config: makeResolvedConfig({
        agentCommand: agentScript,
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

    await runRunner(opts);

    // Check that an auto-commit was created
    const log = execSync("git log --oneline", {
      cwd: worktreeDir,
      encoding: "utf-8",
    });
    expect(log).toContain("auto-commit");
  });
});
