/**
 * Tests for src/feedback-wrapper.ts — the feedback wrapper script generator.
 *
 * Tests cover:
 * - Pure generation logic (generateFeedbackWrapper)
 * - Parsing helper (parseFeedbackCommands)
 * - Shell script validity (shebang, commands present, structure)
 * - Edge cases (empty commands, special characters, single quotes)
 * - Integration tests (actual script execution on non-Windows)
 */
import { describe, test, expect } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  generateFeedbackWrapper,
  parseFeedbackCommands,
  FEEDBACK_WRAPPER_FILENAME,
  DEFAULT_TIMEOUT_SECONDS,
} from "./feedback-wrapper.ts";
import { writeFeedbackWrapper } from "./worktree/management.ts";

// ---------------------------------------------------------------------------
// parseFeedbackCommands — pure logic
// ---------------------------------------------------------------------------

describe("parseFeedbackCommands", () => {
  test("parses comma-separated commands", () => {
    expect(parseFeedbackCommands("bun test, bun run lint")).toEqual([
      "bun test",
      "bun run lint",
    ]);
  });

  test("trims whitespace around commands", () => {
    expect(parseFeedbackCommands("  bun test ,  bun run lint  ")).toEqual([
      "bun test",
      "bun run lint",
    ]);
  });

  test("returns empty array for empty string", () => {
    expect(parseFeedbackCommands("")).toEqual([]);
  });

  test("returns empty array for whitespace-only string", () => {
    expect(parseFeedbackCommands("   ")).toEqual([]);
  });

  test("handles single command", () => {
    expect(parseFeedbackCommands("bun test")).toEqual(["bun test"]);
  });

  test("filters out empty entries from consecutive commas", () => {
    expect(parseFeedbackCommands("bun test,,bun run lint")).toEqual([
      "bun test",
      "bun run lint",
    ]);
  });
});

// ---------------------------------------------------------------------------
// generateFeedbackWrapper — pure logic
// ---------------------------------------------------------------------------

describe("generateFeedbackWrapper", () => {
  test("returns valid shell script with shebang", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script.startsWith("#!/usr/bin/env bash\n")).toBe(true);
  });

  test("includes all commands for multiple commands", () => {
    const script = generateFeedbackWrapper(["bun test", "bun run lint"]);
    expect(script).toContain("'bun test'");
    expect(script).toContain("'bun run lint'");
  });

  test("includes run_command invocations with correct indices", () => {
    const script = generateFeedbackWrapper(["bun test", "bun run lint"]);
    expect(script).toContain("run_command 'bun test' 1 2");
    expect(script).toContain("run_command 'bun run lint' 2 2");
  });

  test("uses default timeout when not specified", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script).toContain(`TIMEOUT_SECONDS=${DEFAULT_TIMEOUT_SECONDS}`);
  });

  test("accepts custom timeout", () => {
    const script = generateFeedbackWrapper(["bun test"], 60);
    expect(script).toContain("TIMEOUT_SECONDS=60");
  });

  test("returns empty wrapper for no commands", () => {
    const script = generateFeedbackWrapper([]);
    expect(script).toContain("No feedback commands configured");
    expect(script).toContain("exit 0");
  });

  test("escapes single quotes in commands", () => {
    const script = generateFeedbackWrapper(["echo 'hello world'"]);
    // Single quote escaping uses the '\'' idiom
    expect(script).toContain("'echo '\\''hello world'\\'''");
  });

  test("includes set -o pipefail", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script).toContain("set -o pipefail");
  });

  test("includes FINAL_EXIT tracking", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script).toContain("FINAL_EXIT=0");
    expect(script).toContain("exit ${FINAL_EXIT}");
  });

  test("includes run_command function", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script).toContain("run_command()");
    expect(script).toContain("local cmd=");
    expect(script).toContain("mktemp");
  });

  test("includes timeout detection logic", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script).toContain("command -v timeout");
    expect(script).toContain("TIMEOUT");
    // Check for timeout exit codes 137 and 124
    expect(script).toContain("137");
    expect(script).toContain("124");
  });

  test("includes success summary format", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script).toContain("OK");
  });

  test("includes failure output format", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script).toContain("FAIL");
    expect(script).toContain("cat");
  });
});

// ---------------------------------------------------------------------------
// writeFeedbackWrapper — file I/O
// ---------------------------------------------------------------------------

describe("writeFeedbackWrapper", () => {
  test("writes wrapper file to specified directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
    writeFeedbackWrapper(dir, ["bun test"]);
    const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
    expect(existsSync(wrapperPath)).toBe(true);
    const content = readFileSync(wrapperPath, "utf-8");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain("'bun test'");
  });

  test("sets executable permissions", () => {
    if (process.platform === "win32") return;
    const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
    writeFeedbackWrapper(dir, ["bun test"]);
    const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
    const stat = Bun.file(wrapperPath);
    // Check file exists and is readable
    expect(existsSync(wrapperPath)).toBe(true);
  });

  test("does not write file when no commands provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
    writeFeedbackWrapper(dir, []);
    const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
    expect(existsSync(wrapperPath)).toBe(false);
  });

  test("does not write file when commands is undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
    writeFeedbackWrapper(dir, undefined);
    const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
    expect(existsSync(wrapperPath)).toBe(false);
  });

  test("overwrites existing wrapper (regeneration)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
    const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);

    // Write initial version
    writeFeedbackWrapper(dir, ["bun test"]);
    const first = readFileSync(wrapperPath, "utf-8");
    expect(first).toContain("'bun test'");

    // Write updated version
    writeFeedbackWrapper(dir, ["bun test", "bun run lint"]);
    const second = readFileSync(wrapperPath, "utf-8");
    expect(second).toContain("'bun run lint'");
    expect(second).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Integration: script execution (non-Windows only)
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "feedback wrapper execution",
  () => {
    test("exit 0 command prints summary only", () => {
      const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
      const script = generateFeedbackWrapper(["true"]);
      const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
      writeFileSync(wrapperPath, script, { mode: 0o755 });

      const output = execSync(`bash "${wrapperPath}"`, {
        encoding: "utf-8",
        cwd: dir,
      });
      expect(output).toContain("[1/1] OK");
      expect(output).toContain("true");
    });

    test("non-zero exit command prints full output", () => {
      const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
      const script = generateFeedbackWrapper([
        "echo 'error details' && exit 1",
      ]);
      const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
      writeFileSync(wrapperPath, script, { mode: 0o755 });

      let output = "";
      try {
        execSync(`bash "${wrapperPath}"`, {
          encoding: "utf-8",
          cwd: dir,
        });
      } catch (err: unknown) {
        output =
          (err as { stdout?: string; stderr?: string }).stdout ??
          (err as { stdout?: string; stderr?: string }).stderr ??
          "";
      }
      expect(output).toContain("FAIL");
      expect(output).toContain("error details");
    });

    test("multiple commands run sequentially", () => {
      const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
      const script = generateFeedbackWrapper(["echo first", "echo second"]);
      const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
      writeFileSync(wrapperPath, script, { mode: 0o755 });

      const output = execSync(`bash "${wrapperPath}"`, {
        encoding: "utf-8",
        cwd: dir,
      });
      expect(output).toContain("[1/2] OK");
      expect(output).toContain("[2/2] OK");
    });

    test("exit code matches failing command", () => {
      const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
      const script = generateFeedbackWrapper(["exit 42"]);
      const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
      writeFileSync(wrapperPath, script, { mode: 0o755 });

      try {
        execSync(`bash "${wrapperPath}"`, {
          encoding: "utf-8",
          cwd: dir,
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (err: unknown) {
        const exitCode = (err as { status?: number }).status;
        expect(exitCode).toBe(42);
      }
    });

    test("success after failure still reports non-zero exit", () => {
      const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
      const script = generateFeedbackWrapper(["exit 1", "true"]);
      const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
      writeFileSync(wrapperPath, script, { mode: 0o755 });

      try {
        execSync(`bash "${wrapperPath}"`, {
          encoding: "utf-8",
          cwd: dir,
        });
        expect(true).toBe(false);
      } catch (err: unknown) {
        const exitCode = (err as { status?: number }).status;
        expect(exitCode).not.toBe(0);
        const output = (err as { stdout?: string }).stdout ?? "";
        expect(output).toContain("[1/2] FAIL");
        expect(output).toContain("[2/2] OK");
      }
    });

    test("wrapper is executable as a standalone script", () => {
      const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
      writeFeedbackWrapper(dir, ["echo hello"]);
      const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);

      const output = execSync(wrapperPath, {
        encoding: "utf-8",
        cwd: dir,
      });
      expect(output).toContain("[1/1] OK");
    });

    test("deleted wrapper produces clear file not found error", () => {
      const dir = mkdtempSync(join(tmpdir(), "ralphai-fw-"));
      const wrapperPath = join(dir, FEEDBACK_WRAPPER_FILENAME);
      // Don't write the file — simulate agent deletion

      try {
        execSync(`bash "${wrapperPath}"`, {
          encoding: "utf-8",
          cwd: dir,
          stdio: ["pipe", "pipe", "pipe"],
        });
        expect(true).toBe(false);
      } catch (err: unknown) {
        const stderr = String((err as { stderr?: unknown }).stderr ?? "");
        // Bash produces "No such file or directory" for missing scripts
        expect(stderr).toContain("No such file or directory");
      }
    });
  },
);
