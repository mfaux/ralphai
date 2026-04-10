/**
 * Tests for src/shell-split.ts — minimal shell-like argument splitting.
 */
import { describe, test, expect } from "bun:test";
import { shellSplit } from "./shell-split.ts";

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
