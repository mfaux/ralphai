/**
 * Tests for src/executor/ — AgentExecutor abstraction, LocalExecutor, and factory.
 */
import { describe, it, expect } from "bun:test";

import { LocalExecutor } from "./executor/local.ts";
import { createExecutor, type AgentExecutor } from "./executor/index.ts";

// ---------------------------------------------------------------------------
// LocalExecutor
// ---------------------------------------------------------------------------

describe("LocalExecutor", () => {
  it("implements the AgentExecutor interface", () => {
    const executor = new LocalExecutor();
    expect(typeof executor.spawn).toBe("function");
  });

  it("spawns a command and captures stdout", async () => {
    const executor = new LocalExecutor();
    const result = await executor.spawn({
      agentCommand: "echo hello",
      prompt: "",
      iterationTimeout: 0,
      cwd: process.cwd(),
    });

    expect(result.output).toContain("hello");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("captures stderr output", async () => {
    const executor = new LocalExecutor();
    const result = await executor.spawn({
      agentCommand: "bash -c",
      prompt: "echo err >&2",
      iterationTimeout: 0,
      cwd: process.cwd(),
    });

    expect(result.output).toContain("err");
    expect(result.exitCode).toBe(0);
  });

  it("returns non-zero exit code on failure", async () => {
    const executor = new LocalExecutor();
    const result = await executor.spawn({
      agentCommand: "bash -c",
      prompt: "exit 42",
      iterationTimeout: 0,
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it("returns exitCode 1 for nonexistent command", async () => {
    const executor = new LocalExecutor();
    const result = await executor.spawn({
      agentCommand: "nonexistent_command_12345",
      prompt: "",
      iterationTimeout: 0,
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("passes nonce as RALPHAI_NONCE env var", async () => {
    const executor = new LocalExecutor();
    const result = await executor.spawn({
      agentCommand: "bash -c",
      prompt: "echo $RALPHAI_NONCE",
      iterationTimeout: 0,
      cwd: process.cwd(),
      nonce: "test-nonce-123",
    });

    expect(result.output).toContain("test-nonce-123");
  });

  it("inherits process.env when no nonce is set", async () => {
    const executor = new LocalExecutor();
    const result = await executor.spawn({
      agentCommand: "bash -c",
      prompt: "echo $HOME",
      iterationTimeout: 0,
      cwd: process.cwd(),
    });

    // HOME should be inherited from the environment
    expect(result.output.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// createExecutor factory
// ---------------------------------------------------------------------------

describe("createExecutor", () => {
  it("returns a LocalExecutor for sandbox='none'", () => {
    const executor = createExecutor("none");
    expect(executor).toBeInstanceOf(LocalExecutor);
  });

  it("throws for sandbox='docker' (not yet implemented)", () => {
    expect(() => createExecutor("docker")).toThrow(
      "Docker executor is not yet implemented",
    );
  });

  it("throws for unknown sandbox mode", () => {
    expect(() => createExecutor("unknown")).toThrow(
      "Unknown sandbox mode: 'unknown'",
    );
  });

  it("returned executor satisfies AgentExecutor interface", async () => {
    const executor: AgentExecutor = createExecutor("none");
    expect(typeof executor.spawn).toBe("function");

    const result = await executor.spawn({
      agentCommand: "echo test",
      prompt: "",
      iterationTimeout: 0,
      cwd: process.cwd(),
    });

    expect(result.output).toContain("test");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});
