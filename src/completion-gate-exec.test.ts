/**
 * Boundary tests for completion-gate.ts using setExecImpl.
 *
 * Verifies that runFeedbackCommands routes through exec.ts (not
 * child_process directly) by swapping the exec implementation
 * with a mock and asserting on the calls.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { setExecImpl } from "./exec.ts";
import { runFeedbackCommands, runCompletionGate } from "./completion-gate.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

beforeEach(() => {
  restoreExec = setExecImpl(mockExecSync as any);
  mockExecSync.mockReset();
});

afterEach(() => {
  restoreExec();
});

// ---------------------------------------------------------------------------
// runFeedbackCommands — routes through exec.ts
// ---------------------------------------------------------------------------

describe("runFeedbackCommands — exec boundary", () => {
  test("calls exec for a single command", () => {
    mockExecSync.mockImplementation(() => "ok");

    const results = runFeedbackCommands("bun test", "/my/cwd");

    expect(results).toHaveLength(1);
    expect(results[0]!.exitCode).toBe(0);
    expect(results[0]!.command).toBe("bun test");

    // Verify the mock was called with correct cwd
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    const callArgs = mockExecSync.mock.calls[0]!;
    expect(callArgs[0]).toBe("bun test");
    expect(callArgs[1]).toMatchObject({ cwd: "/my/cwd" });
  });

  test("calls exec for each comma-separated command", () => {
    mockExecSync.mockImplementation(() => "ok");

    const results = runFeedbackCommands("bun test, bun run build", "/cwd");

    expect(results).toHaveLength(2);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync.mock.calls[0]![0]).toBe("bun test");
    expect(mockExecSync.mock.calls[1]![0]).toBe("bun run build");
  });

  test("captures exit code from exec failure", () => {
    const err = new Error("fail") as any;
    err.status = 42;
    err.stderr = Buffer.from("some error");
    err.stdout = Buffer.from("");
    mockExecSync.mockImplementation(() => {
      throw err;
    });

    const results = runFeedbackCommands("bad-cmd", "/cwd");

    expect(results).toHaveLength(1);
    expect(results[0]!.exitCode).toBe(42);
    expect(results[0]!.output).toContain("some error");
  });

  test("captures stdout when stderr is empty on failure", () => {
    const err = new Error("fail") as any;
    err.status = 1;
    err.stderr = Buffer.from("");
    err.stdout = Buffer.from("stdout output");
    mockExecSync.mockImplementation(() => {
      throw err;
    });

    const results = runFeedbackCommands("bad-cmd", "/cwd");

    expect(results[0]!.output).toBe("stdout output");
  });

  test("passes timeout option through to exec", () => {
    mockExecSync.mockImplementation(() => "ok");

    runFeedbackCommands("bun test", "/cwd");

    // The 300_000 timeout should be passed through
    const opts = mockExecSync.mock.calls[0]![1];
    expect(opts.timeout).toBe(300_000);
  });

  test("tags results with specified tier", () => {
    mockExecSync.mockImplementation(() => "ok");

    const results = runFeedbackCommands("bun test", "/cwd", "pr");

    expect(results[0]!.tier).toBe("pr");
  });

  test("defaults to loop tier", () => {
    mockExecSync.mockImplementation(() => "ok");

    const results = runFeedbackCommands("bun test", "/cwd");

    expect(results[0]!.tier).toBe("loop");
  });

  test("returns empty for blank input without calling exec", () => {
    const results = runFeedbackCommands("  ", "/cwd");

    expect(results).toEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runCompletionGate — integration with mocked exec
// ---------------------------------------------------------------------------

describe("runCompletionGate — exec boundary", () => {
  function makeProgressFile(completedTasks: number): string {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-exec-"));
    const progressFile = join(tmpDir, "progress.md");
    const tasks = Array.from(
      { length: completedTasks },
      (_, i) => `### Task ${i + 1}: T\n**Status:** Complete\nDone.`,
    ).join("\n\n");
    writeFileSync(progressFile, tasks);
    return progressFile;
  }

  test("passes when mocked exec succeeds", () => {
    mockExecSync.mockImplementation(() => "ok");
    const progressFile = makeProgressFile(2);

    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "bun test",
      cwd: "/cwd",
    });

    expect(result.passed).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  test("rejects when mocked exec fails", () => {
    const err = new Error("fail") as any;
    err.status = 1;
    err.stderr = Buffer.from("test failure");
    err.stdout = Buffer.from("");
    mockExecSync.mockImplementation(() => {
      throw err;
    });
    const progressFile = makeProgressFile(2);

    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "bun test",
      cwd: "/cwd",
    });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details[0]).toContain("bun test");
      expect(result.details[0]).toContain("test failure");
    }
  });

  test("runs both loop and PR tier commands through exec", () => {
    mockExecSync.mockImplementation(() => "ok");
    const progressFile = makeProgressFile(2);

    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "bun test",
      prFeedbackCommands: "bun run lint",
      cwd: "/cwd",
    });

    expect(result.passed).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync.mock.calls[0]![0]).toBe("bun test");
    expect(mockExecSync.mock.calls[1]![0]).toBe("bun run lint");
  });
});
