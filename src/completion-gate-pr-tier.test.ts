/**
 * Tests for PR-tier feedback commands in the completion gate.
 *
 * Covers the two-tier behavioral split: feedbackCommands (loop-tier) flow
 * to both the agent prompt and the gate; prFeedbackCommands (PR-tier)
 * flow ONLY to the gate.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  checkCompletionGate,
  runFeedbackCommands,
  runCompletionGate,
  formatGateRejection,
  type FeedbackResult,
  type GateOutcome,
} from "./completion-gate.ts";

// ---------------------------------------------------------------------------
// checkCompletionGate — PR-tier label in details
// ---------------------------------------------------------------------------

describe("checkCompletionGate — PR-tier labeling", () => {
  test("labels PR-tier failures with [PR-tier] in details", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        {
          command: "bun run lint",
          exitCode: 1,
          output: "lint error",
          tier: "pr",
        },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details[0]).toContain("[PR-tier]");
      expect(result.details[0]).toContain("bun run lint");
    }
  });

  test("does not label loop-tier failures with [PR-tier]", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        { command: "bun test", exitCode: 1, output: "test fail", tier: "loop" },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details[0]).not.toContain("[PR-tier]");
      expect(result.details[0]).toContain("bun test");
    }
  });

  test("does not label results without tier (backward compat)", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        { command: "bun test", exitCode: 1, output: "test fail" },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details[0]).not.toContain("[PR-tier]");
    }
  });

  test("reports both loop-tier and PR-tier failures independently", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        { command: "bun test", exitCode: 1, output: "test fail", tier: "loop" },
        {
          command: "bun run lint",
          exitCode: 1,
          output: "lint error",
          tier: "pr",
        },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details).toHaveLength(2);
      expect(result.details[0]).not.toContain("[PR-tier]");
      expect(result.details[0]).toContain("bun test");
      expect(result.details[1]).toContain("[PR-tier]");
      expect(result.details[1]).toContain("bun run lint");
    }
  });

  test("passes when both loop-tier and PR-tier commands succeed", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        { command: "bun test", exitCode: 0, output: "", tier: "loop" },
        { command: "bun run lint", exitCode: 0, output: "", tier: "pr" },
      ],
    });
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runFeedbackCommands — tier parameter
// ---------------------------------------------------------------------------

describe("runFeedbackCommands — tier parameter", () => {
  test("defaults to loop tier when no tier specified", () => {
    const results = runFeedbackCommands("true", process.cwd());
    expect(results).toHaveLength(1);
    expect(results[0]!.tier).toBe("loop");
  });

  test("tags results with loop tier", () => {
    const results = runFeedbackCommands("true", process.cwd(), "loop");
    expect(results).toHaveLength(1);
    expect(results[0]!.tier).toBe("loop");
  });

  test("tags results with pr tier", () => {
    const results = runFeedbackCommands("true", process.cwd(), "pr");
    expect(results).toHaveLength(1);
    expect(results[0]!.tier).toBe("pr");
  });

  test("tags failing results with pr tier", () => {
    const results = runFeedbackCommands("false", process.cwd(), "pr");
    expect(results).toHaveLength(1);
    expect(results[0]!.tier).toBe("pr");
    expect(results[0]!.exitCode).not.toBe(0);
  });

  test("tags all commands in a multi-command string with the same tier", () => {
    const results = runFeedbackCommands("true,false", process.cwd(), "pr");
    expect(results).toHaveLength(2);
    expect(results[0]!.tier).toBe("pr");
    expect(results[1]!.tier).toBe("pr");
  });
});

// ---------------------------------------------------------------------------
// runCompletionGate — prFeedbackCommands integration
// ---------------------------------------------------------------------------

describe("runCompletionGate — prFeedbackCommands", () => {
  function makeProgressFile(completedTasks: number): string {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-pr-"));
    const progressFile = join(tmpDir, "progress.md");
    const tasks = Array.from(
      { length: completedTasks },
      (_, i) => `### Task ${i + 1}: T\n**Status:** Complete\nDone.`,
    ).join("\n\n");
    writeFileSync(progressFile, tasks);
    return progressFile;
  }

  test("passes when both feedbackCommands and prFeedbackCommands succeed", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      prFeedbackCommands: "true",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
  });

  test("rejects when prFeedbackCommands fails (loop passes)", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      prFeedbackCommands: "false",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toContain("[PR-tier]");
    }
  });

  test("rejects when feedbackCommands fails (prFeedbackCommands passes)", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "false",
      prFeedbackCommands: "true",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).not.toContain("[PR-tier]");
    }
  });

  test("rejects with both-tier failures reported independently", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "false",
      prFeedbackCommands: "false",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details).toHaveLength(2);
      // First detail is loop-tier (no [PR-tier] label)
      expect(result.details[0]).not.toContain("[PR-tier]");
      // Second detail is PR-tier
      expect(result.details[1]).toContain("[PR-tier]");
    }
  });

  test("backward compat: no prFeedbackCommands — behaves identically to before", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
  });

  test("backward compat: empty prFeedbackCommands — behaves identically to before", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      prFeedbackCommands: "",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
  });

  test("only prFeedbackCommands configured (no feedbackCommands): gate runs PR-tier", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "",
      prFeedbackCommands: "true",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
  });

  test("only prFeedbackCommands configured and fails: gate rejects", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "",
      prFeedbackCommands: "false",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details[0]).toContain("[PR-tier]");
    }
  });

  test("PR-tier command timeout is treated as failure", () => {
    const progressFile = makeProgressFile(1);
    // Use a command that will be killed by timeout — sleep 10 with a very short timeout
    // We can't easily test the 300s timeout, but we verify the error handling path
    // by using a command that exits non-zero
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 1,
      feedbackCommands: "",
      prFeedbackCommands: "bash -c 'exit 124'",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details[0]).toContain("[PR-tier]");
      expect(result.details[0]).toContain("exit 124");
    }
  });
});

// ---------------------------------------------------------------------------
// formatGateRejection — PR-tier in rejection message
// ---------------------------------------------------------------------------

describe("formatGateRejection — PR-tier", () => {
  test("includes PR-tier label in rejection message", () => {
    const outcome: GateOutcome = {
      passed: false,
      reason: "Completion gate rejected: failing feedback commands.",
      details: [
        "Feedback command failed [PR-tier] (exit 1): bun run lint: lint error",
      ],
    };
    const formatted = formatGateRejection(outcome);
    expect(formatted).toContain("[PR-tier]");
    expect(formatted).toContain("bun run lint");
    expect(formatted).toContain("lint error");
  });

  test("includes both-tier failures in rejection message", () => {
    const outcome: GateOutcome = {
      passed: false,
      reason: "Completion gate rejected: failing feedback commands.",
      details: [
        "Feedback command failed (exit 1): bun test: test fail",
        "Feedback command failed [PR-tier] (exit 1): bun run lint: lint error",
      ],
    };
    const formatted = formatGateRejection(outcome);
    expect(formatted).toContain("bun test");
    expect(formatted).toContain("[PR-tier]");
    expect(formatted).toContain("bun run lint");
  });

  test("rejection message with nonce includes PR-tier details", () => {
    const outcome: GateOutcome = {
      passed: false,
      reason: "Completion gate rejected: failing feedback commands.",
      details: ["Feedback command failed [PR-tier] (exit 1): bun run lint"],
    };
    const formatted = formatGateRejection(outcome, "test-nonce-123");
    expect(formatted).toContain("[PR-tier]");
    expect(formatted).toContain('nonce="test-nonce-123"');
  });
});
