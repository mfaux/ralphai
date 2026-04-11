/**
 * Tests for src/review-pass.ts — the review pass module that detects
 * changed files and assembles a simplification prompt.
 *
 * Tests cover:
 * - getChangedFiles: integration tests with real temp git repos
 * - assembleReviewPrompt: pure unit tests for prompt assembly
 * - runReviewPass: integration tests for orchestration
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  getChangedFiles,
  assembleReviewPrompt,
  runReviewPass,
  MAX_FILES_IN_PROMPT,
} from "./review-pass.ts";
import { LocalExecutor } from "./executor/index.ts";
import type {
  AgentExecutor,
  ExecutorSpawnOptions,
  ExecutorSpawnResult,
} from "./executor/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "review-pass-test-"));
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

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// getChangedFiles — integration tests with real git repos
// ---------------------------------------------------------------------------

describe("getChangedFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTmpGitRepo();
  });

  afterEach(() => {
    cleanupDir(dir);
  });

  test("returns empty array when no files have changed", () => {
    const result = getChangedFiles("main", dir);
    expect(result).toEqual([]);
  });

  test("returns added files on a feature branch", () => {
    // Create a feature branch and add a file
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add new file"', {
      cwd: dir,
      stdio: "pipe",
    });

    const result = getChangedFiles("main", dir);
    expect(result).toEqual(["new-file.ts"]);
  });

  test("returns modified files on a feature branch", () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "README.md"), "# updated\n");
    execSync('git add -A && git commit -m "update readme"', {
      cwd: dir,
      stdio: "pipe",
    });

    const result = getChangedFiles("main", dir);
    expect(result).toEqual(["README.md"]);
  });

  test("excludes deleted files (only existing files are returned)", () => {
    // Create an extra file on main first
    writeFileSync(join(dir, "to-delete.ts"), "export const y = 2;\n");
    execSync('git add -A && git commit -m "add to-delete"', {
      cwd: dir,
      stdio: "pipe",
    });

    // Create feature branch, delete the file, and add a new one
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    unlinkSync(join(dir, "to-delete.ts"));
    writeFileSync(join(dir, "kept-file.ts"), "export const z = 3;\n");
    execSync('git add -A && git commit -m "delete and add"', {
      cwd: dir,
      stdio: "pipe",
    });

    const result = getChangedFiles("main", dir);
    // to-delete.ts should NOT be in the list (it was deleted)
    expect(result).not.toContain("to-delete.ts");
    // kept-file.ts should be in the list
    expect(result).toContain("kept-file.ts");
  });

  test("returns multiple changed files across commits", () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });

    writeFileSync(join(dir, "file-a.ts"), "a\n");
    execSync('git add -A && git commit -m "add a"', {
      cwd: dir,
      stdio: "pipe",
    });

    writeFileSync(join(dir, "file-b.ts"), "b\n");
    execSync('git add -A && git commit -m "add b"', {
      cwd: dir,
      stdio: "pipe",
    });

    writeFileSync(join(dir, "file-c.ts"), "c\n");
    execSync('git add -A && git commit -m "add c"', {
      cwd: dir,
      stdio: "pipe",
    });

    const result = getChangedFiles("main", dir);
    expect(result).toHaveLength(3);
    expect(result).toContain("file-a.ts");
    expect(result).toContain("file-b.ts");
    expect(result).toContain("file-c.ts");
  });

  test("returns files in subdirectories with relative paths", () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });

    const subDir = join(dir, "src", "utils");
    execSync(`mkdir -p "${subDir}"`, { cwd: dir, stdio: "pipe" });
    writeFileSync(join(subDir, "helper.ts"), "export function help() {}\n");
    execSync('git add -A && git commit -m "add nested file"', {
      cwd: dir,
      stdio: "pipe",
    });

    const result = getChangedFiles("main", dir);
    expect(result).toEqual(["src/utils/helper.ts"]);
  });
});

// ---------------------------------------------------------------------------
// assembleReviewPrompt — pure unit tests
// ---------------------------------------------------------------------------

describe("assembleReviewPrompt", () => {
  const feedbackStep =
    "/home/user/.ralphai/repos/abc/pipeline/in-progress/my-plan/_ralphai_feedback.sh";

  test("includes all file paths when count is 0 (empty prompt body)", () => {
    const result = assembleReviewPrompt({ files: [], feedbackStep });
    // With 0 files the file list section is empty but the prompt still has instructions
    expect(result).toContain("behavior-preserving simplification");
    expect(result).not.toContain("more files not listed");
  });

  test("includes all file paths when count is 1", () => {
    const result = assembleReviewPrompt({
      files: ["src/index.ts"],
      feedbackStep,
    });
    expect(result).toContain("- src/index.ts");
    expect(result).not.toContain("more files not listed");
  });

  test("includes all file paths when count is 10", () => {
    const files = Array.from({ length: 10 }, (_, i) => `src/file-${i}.ts`);
    const result = assembleReviewPrompt({ files, feedbackStep });
    for (const file of files) {
      expect(result).toContain(`- ${file}`);
    }
    expect(result).not.toContain("more files not listed");
  });

  test("includes all file paths when count is exactly 25", () => {
    const files = Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`);
    const result = assembleReviewPrompt({ files, feedbackStep });
    for (const file of files) {
      expect(result).toContain(`- ${file}`);
    }
    expect(result).not.toContain("more files not listed");
  });

  test("caps at 25 files with overflow note when count is 30", () => {
    const files = Array.from({ length: 30 }, (_, i) => `src/file-${i}.ts`);
    const result = assembleReviewPrompt({ files, feedbackStep });

    // First 25 should be included
    for (let i = 0; i < 25; i++) {
      expect(result).toContain(`- src/file-${i}.ts`);
    }

    // Files 25-29 should NOT be in the file list
    for (let i = 25; i < 30; i++) {
      expect(result).not.toContain(`- src/file-${i}.ts`);
    }

    // Overflow note should mention the 5 remaining files
    expect(result).toContain("5 more files not listed");
  });

  test("includes simplification instructions (dead code, redundant logic, etc.)", () => {
    const result = assembleReviewPrompt({
      files: ["src/index.ts"],
      feedbackStep,
    });
    expect(result).toContain("dead code");
    expect(result).toContain("redundant logic");
    expect(result).toContain("unnecessary abstractions");
    expect(result).toContain("duplicate code");
    expect(result).toContain("unused variables");
    expect(result).toContain("complex control flow");
  });

  test('includes explicit "make no changes if already clean" instruction', () => {
    const result = assembleReviewPrompt({
      files: ["src/index.ts"],
      feedbackStep,
    });
    expect(result).toContain(
      "already clean and no simplifications are warranted, make no changes",
    );
  });

  test('includes "do not scan the rest of the repo" instruction', () => {
    const result = assembleReviewPrompt({
      files: ["src/index.ts"],
      feedbackStep,
    });
    expect(result).toContain("Do not scan the rest of the repo");
  });

  test("includes the feedback step (wrapper path)", () => {
    const result = assembleReviewPrompt({
      files: ["src/index.ts"],
      feedbackStep:
        "/home/user/.ralphai/repos/abc/pipeline/in-progress/my-plan/_ralphai_feedback.sh",
    });
    expect(result).toContain(
      "/home/user/.ralphai/repos/abc/pipeline/in-progress/my-plan/_ralphai_feedback.sh",
    );
  });

  test("includes the feedback step (raw commands)", () => {
    const result = assembleReviewPrompt({
      files: ["src/index.ts"],
      feedbackStep: "bun test && bun run lint",
    });
    expect(result).toContain("bun test && bun run lint");
  });

  test("includes conventional commit instruction", () => {
    const result = assembleReviewPrompt({
      files: ["src/index.ts"],
      feedbackStep,
    });
    expect(result).toContain("conventional commit");
    expect(result).toContain("refactor:");
  });

  test("does NOT include sentinel tags (learnings, progress, promise)", () => {
    const result = assembleReviewPrompt({
      files: ["src/index.ts"],
      feedbackStep,
    });
    expect(result).not.toContain("<learnings");
    expect(result).not.toContain("<progress");
    expect(result).not.toContain("<promise");
    expect(result).not.toContain("</learnings>");
    expect(result).not.toContain("</progress>");
    expect(result).not.toContain("</promise>");
  });
});

// ---------------------------------------------------------------------------
// runReviewPass — integration tests
// ---------------------------------------------------------------------------

describe("runReviewPass", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTmpGitRepo();
  });

  afterEach(() => {
    cleanupDir(dir);
  });

  test("returns madeChanges: false when no changed files exist", async () => {
    const result = await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: new LocalExecutor(),
    });
    expect(result.madeChanges).toBe(false);
    expect(result.output).toBe("");
  });

  test("returns madeChanges: true when agent creates new commits", async () => {
    // Set up a feature branch with changes
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add file"', {
      cwd: dir,
      stdio: "pipe",
    });

    // Agent command that creates a commit
    const agentCmd = `bash -c 'echo "// simplified" >> new-file.ts && git add -A && git commit -m "refactor: simplify" --allow-empty'`;

    const result = await runReviewPass({
      baseBranch: "main",
      agentCommand: agentCmd,
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: new LocalExecutor(),
    });
    expect(result.madeChanges).toBe(true);
  });

  test("returns madeChanges: false when agent makes no commits", async () => {
    // Set up a feature branch with changes
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add file"', {
      cwd: dir,
      stdio: "pipe",
    });

    // Agent command that does NOT create a commit (just echoes)
    const result = await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: new LocalExecutor(),
    });
    expect(result.madeChanges).toBe(false);
    // Output should contain the prompt echoed back by echo
    expect(result.output.length).toBeGreaterThan(0);
  });

  test("passes output from agent", async () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add file"', {
      cwd: dir,
      stdio: "pipe",
    });

    const result = await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: new LocalExecutor(),
    });
    // echo receives the prompt as an argument, so output should contain prompt text
    expect(result.output).toContain("behavior-preserving");
  });

  test("writes '--- Review Pass ---' header to agent-output.log", async () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add file"', {
      cwd: dir,
      stdio: "pipe",
    });

    const logPath = join(dir, "agent-output.log");

    await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: new LocalExecutor(),
      outputLogPath: logPath,
    });

    expect(existsSync(logPath)).toBe(true);
    const logContent = readFileSync(logPath, "utf-8");
    expect(logContent).toContain("--- Review Pass ---");
  });

  test("does not write header when outputLogPath is not provided", async () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add file"', {
      cwd: dir,
      stdio: "pipe",
    });

    // No outputLogPath — should not throw
    const result = await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: new LocalExecutor(),
    });
    expect(result.madeChanges).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runReviewPass — executor boundary tests (mock executor)
// ---------------------------------------------------------------------------

describe("runReviewPass executor boundary", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTmpGitRepo();
  });

  afterEach(() => {
    cleanupDir(dir);
  });

  test("calls executor.spawn with correct options", async () => {
    // Set up a feature branch with a changed file
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "new-file.ts"), "export const x = 1;\n");
    execSync('git add -A && git commit -m "add file"', {
      cwd: dir,
      stdio: "pipe",
    });

    let capturedOpts: ExecutorSpawnOptions | undefined;
    const mockExecutor: AgentExecutor = {
      async spawn(opts: ExecutorSpawnOptions): Promise<ExecutorSpawnResult> {
        capturedOpts = opts;
        return { output: "mock output", exitCode: 0, timedOut: false };
      },
    };

    await runReviewPass({
      baseBranch: "main",
      agentCommand: "my-agent -p",
      feedbackStep: "bun test",
      iterationTimeout: 300,
      cwd: dir,
      executor: mockExecutor,
    });

    expect(capturedOpts).toBeDefined();
    expect(capturedOpts!.agentCommand).toBe("my-agent -p");
    expect(capturedOpts!.prompt).toContain("new-file.ts");
    expect(capturedOpts!.prompt).toContain("behavior-preserving");
    expect(capturedOpts!.iterationTimeout).toBe(300);
    expect(capturedOpts!.cwd).toBe(dir);
  });

  test("does not call executor.spawn when no files changed", async () => {
    let spawnCalled = false;
    const mockExecutor: AgentExecutor = {
      async spawn(): Promise<ExecutorSpawnResult> {
        spawnCalled = true;
        return { output: "", exitCode: 0, timedOut: false };
      },
    };

    const result = await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: mockExecutor,
    });

    expect(spawnCalled).toBe(false);
    expect(result.madeChanges).toBe(false);
    expect(result.output).toBe("");
  });

  test("passes outputLogPath and ipcBroadcast to executor", async () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "file.ts"), "x\n");
    execSync('git add -A && git commit -m "add"', {
      cwd: dir,
      stdio: "pipe",
    });

    let capturedOpts: ExecutorSpawnOptions | undefined;
    const mockExecutor: AgentExecutor = {
      async spawn(opts: ExecutorSpawnOptions): Promise<ExecutorSpawnResult> {
        capturedOpts = opts;
        return { output: "", exitCode: 0, timedOut: false };
      },
    };

    const logPath = join(dir, "agent-output.log");
    const broadcasts: unknown[] = [];
    const ipcBroadcast = (msg: unknown) => {
      broadcasts.push(msg);
    };

    await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: mockExecutor,
      outputLogPath: logPath,
      ipcBroadcast: ipcBroadcast as any,
    });

    expect(capturedOpts).toBeDefined();
    expect(capturedOpts!.outputLogPath).toBe(logPath);
    expect(capturedOpts!.ipcBroadcast).toBe(ipcBroadcast);
  });

  test("returns executor output in result", async () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "file.ts"), "x\n");
    execSync('git add -A && git commit -m "add"', {
      cwd: dir,
      stdio: "pipe",
    });

    const mockExecutor: AgentExecutor = {
      async spawn(): Promise<ExecutorSpawnResult> {
        return {
          output: "review suggestions applied",
          exitCode: 0,
          timedOut: false,
        };
      },
    };

    const result = await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "true",
      iterationTimeout: 0,
      cwd: dir,
      executor: mockExecutor,
    });

    expect(result.output).toBe("review suggestions applied");
  });

  test("forwards feedbackWrapperPath to executor.spawn for Docker bind-mount", async () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "file.ts"), "x\n");
    execSync('git add -A && git commit -m "add"', {
      cwd: dir,
      stdio: "pipe",
    });

    let capturedOpts: ExecutorSpawnOptions | undefined;
    const mockExecutor: AgentExecutor = {
      async spawn(opts: ExecutorSpawnOptions): Promise<ExecutorSpawnResult> {
        capturedOpts = opts;
        return { output: "", exitCode: 0, timedOut: false };
      },
    };

    const wrapperPath =
      "/home/user/.ralphai/repos/abc/pipeline/in-progress/my-plan/_ralphai_feedback.sh";

    await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: wrapperPath,
      iterationTimeout: 0,
      cwd: dir,
      executor: mockExecutor,
      feedbackWrapperPath: wrapperPath,
    });

    expect(capturedOpts).toBeDefined();
    expect(capturedOpts!.feedbackWrapperPath).toBe(wrapperPath);
  });

  test("feedbackWrapperPath defaults to undefined when not provided", async () => {
    execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "file.ts"), "x\n");
    execSync('git add -A && git commit -m "add"', {
      cwd: dir,
      stdio: "pipe",
    });

    let capturedOpts: ExecutorSpawnOptions | undefined;
    const mockExecutor: AgentExecutor = {
      async spawn(opts: ExecutorSpawnOptions): Promise<ExecutorSpawnResult> {
        capturedOpts = opts;
        return { output: "", exitCode: 0, timedOut: false };
      },
    };

    await runReviewPass({
      baseBranch: "main",
      agentCommand: "echo",
      feedbackStep: "bun test",
      iterationTimeout: 0,
      cwd: dir,
      executor: mockExecutor,
    });

    expect(capturedOpts).toBeDefined();
    expect(capturedOpts!.feedbackWrapperPath).toBeUndefined();
  });
});
