/**
 * Tests for in-memory learnings accumulation in the runner loop.
 *
 * Verifies that:
 * - Learnings are extracted from agent output and accumulated in memory
 * - Console messages indicate learning status (logged, none, no block)
 * - No learnings files are created on the filesystem
 * - Learnings persist across iterations
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runRunner, type RunnerOptions } from "./runner.ts";
import { type ResolvedConfig } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

// ---------------------------------------------------------------------------
// Helpers (shared pattern with runner.test.ts)
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "runner-learn-"));
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
  const worktreeDir = join(tmpdir(), `runner-wt-learn-${slug}-${Date.now()}`);
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
    issuePrdInProgressLabel: "ralphai-prd:in-progress",
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

/** Recursively find all files matching a name in a directory tree. */
function findFiles(dir: string, name: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, name));
    } else if (entry.name === name) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// In-memory learnings tests
// ---------------------------------------------------------------------------

describe("runRunner — in-memory learnings", () => {
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

  test("logs learning from agent output and does not create learnings files", async () => {
    const { backlogDir, ralphaiHome } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "learn1");

    writeFileSync(
      join(backlogDir, "learn1.md"),
      "# Plan: Learn Test\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    // Agent outputs a learning and COMPLETE marker
    const agentScript = `bash -c 'echo "<promise>COMPLETE</promise>"; echo "<learnings>Always check return values before using them.</learnings>"'`;

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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
      origLog(...args);
    };

    try {
      await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    // Learning was logged
    expect(output).toContain("Logged learning: Always check return values");

    // No LEARNINGS.md or LEARNING_CANDIDATES.md created anywhere in the
    // RALPHAI_HOME directory tree
    const learningsFiles = findFiles(ralphaiHome, "LEARNINGS.md");
    const candidatesFiles = findFiles(ralphaiHome, "LEARNING_CANDIDATES.md");
    expect(learningsFiles).toEqual([]);
    expect(candidatesFiles).toEqual([]);
  });

  test("logs 'No learning' when agent reports none", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "learn2");

    writeFileSync(
      join(backlogDir, "learn2.md"),
      "# Plan: No Learn\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    // Agent outputs <learnings>none</learnings>
    const agentScript = `bash -c 'echo "<promise>COMPLETE</promise>"; echo "<learnings>none</learnings>"'`;

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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
      origLog(...args);
    };

    try {
      await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("No learning logged this iteration.");
  });

  test("warns when no learnings block found in agent output", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "learn3");

    writeFileSync(
      join(backlogDir, "learn3.md"),
      "# Plan: Missing Block\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    // Agent outputs COMPLETE but no <learnings> block at all
    const agentScript = `bash -c 'echo "<promise>COMPLETE</promise>"'`;

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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
      origLog(...args);
    };

    try {
      await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain(
      "WARNING: No <learnings> block found in agent output.",
    );
  });

  test("empty learnings block logs no learning", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);
    const worktreeDir = createManagedWorktree(dir, "learn4");

    writeFileSync(
      join(backlogDir, "learn4.md"),
      "# Plan: Empty Block\n\n## Implementation Tasks\n\n### Task 1: Test\n",
    );

    // Agent outputs <learnings> with only whitespace (extractLearningsBlock
    // returns null for empty content)
    const agentScript = `bash -c 'echo "<promise>COMPLETE</promise>"; echo "<learnings>   </learnings>"'`;

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

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
      origLog(...args);
    };

    try {
      await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    // Empty block is treated the same as no block by extractLearningsBlock
    // (returns null when content is only whitespace)
    expect(output).toContain("WARNING: No <learnings> block found");
  });
});
