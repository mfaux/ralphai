import { describe, it, expect } from "bun:test";
import { resolveAgentVerboseFlags } from "./agent-flags.ts";

// ---------------------------------------------------------------------------
// resolveAgentVerboseFlags — built-in map
// ---------------------------------------------------------------------------

describe("resolveAgentVerboseFlags", () => {
  it("returns opencode flags for opencode command", () => {
    const flags = resolveAgentVerboseFlags("opencode run --agent build");
    expect(flags).toEqual(["--print-logs", "--log-level", "DEBUG"]);
  });

  it("returns --verbose for claude command", () => {
    const flags = resolveAgentVerboseFlags("claude -p");
    expect(flags).toEqual(["--verbose"]);
  });

  it("returns --verbose for aider command", () => {
    const flags = resolveAgentVerboseFlags("aider --yes");
    expect(flags).toEqual(["--verbose"]);
  });

  it("returns --verbose for codex command", () => {
    const flags = resolveAgentVerboseFlags("codex run");
    expect(flags).toEqual(["--verbose"]);
  });

  it("returns --verbose for gemini command", () => {
    const flags = resolveAgentVerboseFlags("gemini-cli");
    expect(flags).toEqual(["--verbose"]);
  });

  it("returns empty array for goose (no verbose flags)", () => {
    const flags = resolveAgentVerboseFlags("goose session");
    expect(flags).toEqual([]);
  });

  it("returns empty array for kiro (no verbose flags)", () => {
    const flags = resolveAgentVerboseFlags("kiro --auto");
    expect(flags).toEqual([]);
  });

  it("returns empty array for amp (no verbose flags)", () => {
    const flags = resolveAgentVerboseFlags("amp run");
    expect(flags).toEqual([]);
  });

  it("returns empty array for unknown agents", () => {
    const flags = resolveAgentVerboseFlags("my-custom-agent run");
    expect(flags).toEqual([]);
  });

  // --- Config override ---

  it("uses config override when provided", () => {
    const flags = resolveAgentVerboseFlags("claude -p", "--debug --trace");
    expect(flags).toEqual(["--debug", "--trace"]);
  });

  it("config override takes precedence over built-in map", () => {
    const flags = resolveAgentVerboseFlags("opencode run", "--custom-flag");
    expect(flags).toEqual(["--custom-flag"]);
  });

  it("ignores built-in map when override is provided for unknown agent", () => {
    const flags = resolveAgentVerboseFlags(
      "my-custom-agent",
      "--verbose --debug",
    );
    expect(flags).toEqual(["--verbose", "--debug"]);
  });

  it("returns fresh array (not a reference to internal state)", () => {
    const flags1 = resolveAgentVerboseFlags("claude -p");
    const flags2 = resolveAgentVerboseFlags("claude -p");
    expect(flags1).toEqual(flags2);
    expect(flags1).not.toBe(flags2);
  });
});
