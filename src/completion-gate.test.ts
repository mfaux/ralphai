/**
 * Tests for src/completion-gate.ts — the independent verification that
 * runs when the agent claims COMPLETE.
 *
 * Tests the pure gate logic (checkCompletionGate), the feedback command
 * runner (runFeedbackCommands), and the formatting helper.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  checkCompletionGate,
  runFeedbackCommands,
  runCompletionGate,
  readCompletedTasks,
  formatGateRejection,
  type CompletionGateInput,
  type FeedbackResult,
  type GateOutcome,
} from "./completion-gate.ts";

// ---------------------------------------------------------------------------
// checkCompletionGate — pure logic
// ---------------------------------------------------------------------------

describe("checkCompletionGate", () => {
  test("passes when all tasks complete and no feedback commands", () => {
    const result = checkCompletionGate({
      completedTasks: 5,
      totalTasks: 5,
      feedbackResults: [],
    });
    expect(result.passed).toBe(true);
  });

  test("passes when totalTasks is 0 (no task counting)", () => {
    const result = checkCompletionGate({
      completedTasks: 0,
      totalTasks: 0,
      feedbackResults: [],
    });
    expect(result.passed).toBe(true);
  });

  test("passes when more tasks completed than total (over-reporting)", () => {
    const result = checkCompletionGate({
      completedTasks: 7,
      totalTasks: 5,
      feedbackResults: [],
    });
    expect(result.passed).toBe(true);
  });

  test("passes when all feedback commands succeed", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        { command: "bun test", exitCode: 0, output: "" },
        { command: "bun run build", exitCode: 0, output: "" },
      ],
    });
    expect(result.passed).toBe(true);
  });

  test("rejects when tasks are incomplete", () => {
    const result = checkCompletionGate({
      completedTasks: 2,
      totalTasks: 5,
      feedbackResults: [],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain("incomplete tasks");
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toContain("2/5");
    }
  });

  test("rejects when a feedback command fails", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        { command: "bun test", exitCode: 1, output: "FAIL: 2 tests failed" },
        { command: "bun run build", exitCode: 0, output: "" },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain("failing feedback commands");
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toContain("bun test");
      expect(result.details[0]).toContain("FAIL: 2 tests failed");
    }
  });

  test("rejects with both reasons when tasks and feedback fail", () => {
    const result = checkCompletionGate({
      completedTasks: 1,
      totalTasks: 3,
      feedbackResults: [{ command: "bun test", exitCode: 1, output: "error" }],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain("incomplete tasks");
      expect(result.reason).toContain("failing feedback commands");
      expect(result.details).toHaveLength(2);
    }
  });

  test("reports all failing feedback commands, not just the first", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        { command: "bun test", exitCode: 1, output: "test fail" },
        { command: "bun run build", exitCode: 2, output: "build fail" },
        { command: "bun run lint", exitCode: 0, output: "" },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details).toHaveLength(2);
      expect(result.details[0]).toContain("bun test");
      expect(result.details[1]).toContain("bun run build");
    }
  });

  test("skips task count check when totalTasks is 0", () => {
    const result = checkCompletionGate({
      completedTasks: 0,
      totalTasks: 0,
      feedbackResults: [{ command: "bun test", exitCode: 1, output: "fail" }],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      // Should only mention feedback, not tasks
      expect(result.reason).not.toContain("incomplete tasks");
      expect(result.reason).toContain("failing feedback commands");
    }
  });

  test("truncates long feedback output in details", () => {
    const longOutput = "x".repeat(300);
    const result = checkCompletionGate({
      completedTasks: 1,
      totalTasks: 1,
      feedbackResults: [
        { command: "bun test", exitCode: 1, output: longOutput },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      // Output should be truncated to 200 chars
      expect(result.details[0]!.length).toBeLessThan(longOutput.length + 100);
    }
  });
});

// ---------------------------------------------------------------------------
// runFeedbackCommands — executes real commands
// ---------------------------------------------------------------------------

describe("runFeedbackCommands", () => {
  test("returns empty array for empty feedbackCommands", () => {
    const results = runFeedbackCommands("", process.cwd());
    expect(results).toEqual([]);
  });

  test("returns empty array for whitespace-only feedbackCommands", () => {
    const results = runFeedbackCommands("   ", process.cwd());
    expect(results).toEqual([]);
  });

  test("runs a passing command", () => {
    const results = runFeedbackCommands("true", process.cwd());
    expect(results).toHaveLength(1);
    expect(results[0]!.command).toBe("true");
    expect(results[0]!.exitCode).toBe(0);
  });

  test("runs a failing command", () => {
    const results = runFeedbackCommands("false", process.cwd());
    expect(results).toHaveLength(1);
    expect(results[0]!.command).toBe("false");
    expect(results[0]!.exitCode).not.toBe(0);
  });

  test("runs multiple comma-separated commands", () => {
    const results = runFeedbackCommands("true,false,true", process.cwd());
    expect(results).toHaveLength(3);
    expect(results[0]!.exitCode).toBe(0);
    expect(results[1]!.exitCode).not.toBe(0);
    expect(results[2]!.exitCode).toBe(0);
  });

  test("trims whitespace around commands", () => {
    const results = runFeedbackCommands(" true , true ", process.cwd());
    expect(results).toHaveLength(2);
    expect(results[0]!.command).toBe("true");
    expect(results[1]!.command).toBe("true");
    expect(results[0]!.exitCode).toBe(0);
  });

  test("captures stderr on failure", () => {
    const results = runFeedbackCommands(
      "bash -c 'echo failure-output >&2; exit 1'",
      process.cwd(),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.exitCode).toBe(1);
    expect(results[0]!.output).toContain("failure-output");
  });

  test("runs commands in the specified cwd", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-cwd-"));
    writeFileSync(join(tmpDir, "marker.txt"), "found");
    const results = runFeedbackCommands("cat marker.txt", tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// readCompletedTasks
// ---------------------------------------------------------------------------

describe("readCompletedTasks", () => {
  test("returns 0 for non-existent file", () => {
    expect(readCompletedTasks("/nonexistent/path.md", "tasks")).toBe(0);
  });

  test("counts task-format completions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-progress-"));
    const progressFile = join(tmpDir, "progress.md");
    writeFileSync(
      progressFile,
      [
        "## Progress Log",
        "",
        "### Task 1: Setup",
        "**Status:** Complete",
        "Did the setup.",
        "",
        "### Task 2: Tests",
        "**Status:** Complete",
        "Wrote tests.",
        "",
      ].join("\n"),
    );
    expect(readCompletedTasks(progressFile, "tasks")).toBe(2);
  });

  test("counts checkbox-format completions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-progress-"));
    const progressFile = join(tmpDir, "progress.md");
    writeFileSync(
      progressFile,
      [
        "## Progress Log",
        "",
        "- [x] First item",
        "- [x] Second item",
        "- [x] Third item",
        "",
      ].join("\n"),
    );
    expect(readCompletedTasks(progressFile, "checkboxes")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// runCompletionGate — integration (reads files, runs commands)
// ---------------------------------------------------------------------------

describe("runCompletionGate", () => {
  test("passes when tasks match and feedback succeeds", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-int-"));
    const progressFile = join(tmpDir, "progress.md");
    writeFileSync(
      progressFile,
      [
        "### Task 1: A",
        "**Status:** Complete",
        "Done.",
        "",
        "### Task 2: B",
        "**Status:** Complete",
        "Done.",
      ].join("\n"),
    );

    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      cwd: process.cwd(),
    });

    expect(result.passed).toBe(true);
  });

  test("rejects when tasks incomplete", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-int-"));
    const progressFile = join(tmpDir, "progress.md");
    writeFileSync(
      progressFile,
      ["### Task 1: A", "**Status:** Complete", "Done."].join("\n"),
    );

    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 3,
      feedbackCommands: "true",
      cwd: process.cwd(),
    });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain("incomplete tasks");
    }
  });

  test("rejects when feedback command fails", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-int-"));
    const progressFile = join(tmpDir, "progress.md");
    writeFileSync(progressFile, "## Progress\n");

    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 0,
      feedbackCommands: "false",
      cwd: process.cwd(),
    });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain("failing feedback commands");
    }
  });

  test("passes with no tasks and no feedback commands", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-int-"));
    const progressFile = join(tmpDir, "progress.md");
    writeFileSync(progressFile, "## Progress\n");

    const result = runCompletionGate({
      progressFile,
      planFormat: "none",
      totalTasks: 0,
      feedbackCommands: "",
      cwd: process.cwd(),
    });

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatGateRejection
// ---------------------------------------------------------------------------

describe("formatGateRejection", () => {
  test("returns empty string for passing gate", () => {
    expect(formatGateRejection({ passed: true })).toBe("");
  });

  test("includes reason and details for failing gate", () => {
    const outcome: GateOutcome = {
      passed: false,
      reason: "Completion gate rejected: incomplete tasks.",
      details: ["Task count: 2/5 tasks completed in progress file."],
    };
    const formatted = formatGateRejection(outcome);
    expect(formatted).toContain("COMPLETE signal was rejected");
    expect(formatted).toContain("incomplete tasks");
    expect(formatted).toContain("2/5");
    expect(formatted).toContain("Do NOT output");
  });

  test("includes multiple detail lines", () => {
    const outcome: GateOutcome = {
      passed: false,
      reason:
        "Completion gate rejected: incomplete tasks and failing feedback commands.",
      details: [
        "Task count: 1/3 tasks completed in progress file.",
        "Feedback command failed (exit 1): bun test: FAIL",
      ],
    };
    const formatted = formatGateRejection(outcome);
    expect(formatted).toContain("1/3");
    expect(formatted).toContain("bun test");
  });
});
