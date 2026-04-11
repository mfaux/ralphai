/**
 * Tests for gate validators in the completion gate.
 *
 * Covers: validators pass, single failure, multiple failures, interaction
 * with feedback (validators skipped when feedback fails), workspace override,
 * and backward compatibility (empty validators).
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  checkCompletionGate,
  runCompletionGate,
  formatGateRejection,
  type GateOutcome,
} from "./completion-gate.ts";

// ---------------------------------------------------------------------------
// checkCompletionGate — validator logic (pure)
// ---------------------------------------------------------------------------

describe("checkCompletionGate — validators", () => {
  test("passes when all validators succeed", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [{ command: "bun test", exitCode: 0, output: "" }],
      validatorResults: [
        { command: "check-changelog", exitCode: 0, output: "" },
      ],
    });
    expect(result.passed).toBe(true);
  });

  test("rejects when a single validator fails", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [{ command: "bun test", exitCode: 0, output: "" }],
      validatorResults: [
        {
          command: "check-changelog",
          exitCode: 1,
          output: "missing changelog entry",
        },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain("failing validators");
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toContain("[Validator]");
      expect(result.details[0]).toContain("check-changelog");
      expect(result.details[0]).toContain("missing changelog entry");
    }
  });

  test("reports all failing validators independently (not short-circuited)", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [{ command: "bun test", exitCode: 0, output: "" }],
      validatorResults: [
        { command: "check-changelog", exitCode: 1, output: "no changelog" },
        { command: "check-migration", exitCode: 1, output: "no migration" },
        { command: "check-bundle-size", exitCode: 0, output: "" },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details).toHaveLength(2);
      expect(result.details[0]).toContain("[Validator]");
      expect(result.details[0]).toContain("check-changelog");
      expect(result.details[1]).toContain("[Validator]");
      expect(result.details[1]).toContain("check-migration");
    }
  });

  test("validators skipped when feedback commands fail", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [
        { command: "bun test", exitCode: 1, output: "test fail" },
      ],
      validatorResults: [
        {
          command: "check-changelog",
          exitCode: 1,
          output: "missing changelog",
        },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      // Only feedback failure should be reported, not validator
      expect(result.reason).toContain("failing feedback commands");
      expect(result.reason).not.toContain("failing validators");
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).not.toContain("[Validator]");
      expect(result.details[0]).toContain("bun test");
    }
  });

  test("backward compat: no validatorResults — passes normally", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [{ command: "bun test", exitCode: 0, output: "" }],
    });
    expect(result.passed).toBe(true);
  });

  test("backward compat: empty validatorResults — passes normally", () => {
    const result = checkCompletionGate({
      completedTasks: 3,
      totalTasks: 3,
      feedbackResults: [{ command: "bun test", exitCode: 0, output: "" }],
      validatorResults: [],
    });
    expect(result.passed).toBe(true);
  });

  test("truncates long validator output in details", () => {
    const longOutput = "x".repeat(300);
    const result = checkCompletionGate({
      completedTasks: 1,
      totalTasks: 1,
      feedbackResults: [],
      validatorResults: [
        { command: "check-bundle", exitCode: 1, output: longOutput },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details[0]!.length).toBeLessThan(longOutput.length + 100);
    }
  });

  test("validators and incomplete tasks reported together", () => {
    const result = checkCompletionGate({
      completedTasks: 1,
      totalTasks: 3,
      feedbackResults: [],
      validatorResults: [
        { command: "check-changelog", exitCode: 1, output: "fail" },
      ],
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      // Both task count and validator failure should be reported
      expect(result.reason).toContain("incomplete tasks");
      expect(result.reason).toContain("failing validators");
      expect(result.details).toHaveLength(2);
      expect(result.details[0]).toContain("1/3");
      expect(result.details[1]).toContain("[Validator]");
    }
  });
});

// ---------------------------------------------------------------------------
// runCompletionGate — validators integration (real commands)
// ---------------------------------------------------------------------------

describe("runCompletionGate — validators", () => {
  function makeProgressFile(completedTasks: number): string {
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-val-"));
    const progressFile = join(tmpDir, "progress.md");
    const tasks = Array.from(
      { length: completedTasks },
      (_, i) => `### Task ${i + 1}: T\n**Status:** Complete\nDone.`,
    ).join("\n\n");
    writeFileSync(progressFile, tasks);
    return progressFile;
  }

  test("validators pass: gate passes", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      validators: "true",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
  });

  test("validator fails: gate rejects with [Validator] prefix", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      validators: "false",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toContain("[Validator]");
    }
  });

  test("multiple validators: all run independently", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      validators: "false,true,false",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      // Both failing validators reported
      expect(result.details).toHaveLength(2);
      expect(result.details[0]).toContain("[Validator]");
      expect(result.details[1]).toContain("[Validator]");
    }
  });

  test("validators skipped when feedback fails", () => {
    const progressFile = makeProgressFile(2);
    // Use a side-effect marker to prove validators didn't run
    const tmpDir = mkdtempSync(join(tmpdir(), "gate-val-skip-"));
    const markerFile = join(tmpDir, "validator-ran.txt");
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "false",
      validators: `bash -c 'touch ${markerFile}'`,
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      // Only feedback failure, no validator details
      expect(result.reason).toContain("failing feedback commands");
      expect(result.reason).not.toContain("failing validators");
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).not.toContain("[Validator]");
    }
    // Marker file should not exist since validators were skipped
    const { existsSync } = require("fs");
    expect(existsSync(markerFile)).toBe(false);
  });

  test("empty validators: backward compatible (gate passes)", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      validators: "",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
  });

  test("no validators option: backward compatible (gate passes)", () => {
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

  test("validators run after both loop-tier and PR-tier feedback pass", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      prFeedbackCommands: "true",
      validators: "false",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toContain("[Validator]");
    }
  });

  test("validators skipped when PR-tier feedback fails", () => {
    const progressFile = makeProgressFile(2);
    const result = runCompletionGate({
      progressFile,
      planFormat: "tasks",
      totalTasks: 2,
      feedbackCommands: "true",
      prFeedbackCommands: "false",
      validators: "false",
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      // Only PR-tier feedback failure, no validator details
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toContain("[PR-tier]");
      expect(result.details[0]).not.toContain("[Validator]");
    }
  });
});

// ---------------------------------------------------------------------------
// formatGateRejection — validator label in rejection message
// ---------------------------------------------------------------------------

describe("formatGateRejection — validators", () => {
  test("includes [Validator] label in rejection message", () => {
    const outcome: GateOutcome = {
      passed: false,
      reason: "Completion gate rejected: failing validators.",
      details: [
        "Feedback command failed [Validator] (exit 1): check-changelog: missing entry",
      ],
    };
    const formatted = formatGateRejection(outcome);
    expect(formatted).toContain("[Validator]");
    expect(formatted).toContain("check-changelog");
    expect(formatted).toContain("missing entry");
  });

  test("includes both feedback and validator failures in rejection message", () => {
    const outcome: GateOutcome = {
      passed: false,
      reason:
        "Completion gate rejected: failing feedback commands and failing validators.",
      details: [
        "Feedback command failed (exit 1): bun test: test fail",
        "Feedback command failed [Validator] (exit 1): check-changelog: no entry",
      ],
    };
    const formatted = formatGateRejection(outcome);
    expect(formatted).toContain("bun test");
    expect(formatted).toContain("[Validator]");
    expect(formatted).toContain("check-changelog");
  });
});

// ---------------------------------------------------------------------------
// Workspace override for validators via resolveScope
// ---------------------------------------------------------------------------

describe("workspace override for validators", () => {
  // These tests verify that resolveScope passes validators through
  // and respects workspace overrides. Since resolveScope is tested
  // in scope.test.ts, we test the end-to-end path here via
  // runCompletionGate to keep the test focused on the gate behavior.

  test("validators from workspace override are used", () => {
    // This is tested indirectly: the runner threads cfg.gate.validators
    // through resolveScope which supports workspace validators override.
    // The pure logic test above already verifies checkCompletionGate
    // handles validatorResults correctly.
    //
    // Here we verify the resolveScope integration for validators.
    const { resolveScope } = require("./scope.ts");
    const { mkdtempSync, writeFileSync } = require("fs");
    const { join } = require("path");
    const { tmpdir } = require("os");

    const dir = mkdtempSync(join(tmpdir(), "scope-val-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const wsConfig = JSON.stringify({
      "packages/special": {
        feedbackCommands: ["custom test"],
        validators: ["custom-validator"],
      },
    });

    const result = resolveScope({
      cwd: dir,
      planScope: "packages/special",
      rootFeedbackCommands: "pnpm test",
      rootPrFeedbackCommands: "",
      rootValidators: "root-validator",
      workspacesConfig: wsConfig,
    });

    expect(result.validators).toBe("custom-validator");
  });

  test("falls through to root validators when workspace has no validators override", () => {
    const { resolveScope } = require("./scope.ts");
    const { mkdtempSync, writeFileSync } = require("fs");
    const { join } = require("path");
    const { tmpdir } = require("os");

    const dir = mkdtempSync(join(tmpdir(), "scope-val-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const wsConfig = JSON.stringify({
      "packages/special": {
        feedbackCommands: ["custom test"],
      },
    });

    const result = resolveScope({
      cwd: dir,
      planScope: "packages/special",
      rootFeedbackCommands: "pnpm test",
      rootPrFeedbackCommands: "",
      rootValidators: "root-validator",
      workspacesConfig: wsConfig,
    });

    expect(result.validators).toBe("root-validator");
  });

  test("validators pass through unchanged when no scope", () => {
    const { resolveScope } = require("./scope.ts");
    const { mkdtempSync, writeFileSync } = require("fs");
    const { join } = require("path");
    const { tmpdir } = require("os");

    const dir = mkdtempSync(join(tmpdir(), "scope-val-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));

    const result = resolveScope({
      cwd: dir,
      planScope: "",
      rootFeedbackCommands: "test",
      rootPrFeedbackCommands: "",
      rootValidators: "my-validator",
    });

    expect(result.validators).toBe("my-validator");
  });
});
