/**
 * Tests for configValues() and makeTestConfig().
 *
 * configValues() strips resolution metadata from a ResolvedConfig.
 * makeTestConfig() builds a ConfigValues with DEFAULTS + overrides.
 */

import { describe, it, expect } from "bun:test";
import { configValues, DEFAULTS, type RalphaiConfig } from "./config.ts";
import { makeTestConfig, makeTestResolvedConfig } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// configValues()
// ---------------------------------------------------------------------------

describe("configValues()", () => {
  it("strips source metadata and returns plain values", () => {
    const rc = makeTestResolvedConfig({
      agentCommand: "claude -p",
      maxStuck: 5,
    });
    const cv = configValues(rc);

    expect(cv.agentCommand).toBe("claude -p");
    expect(cv.maxStuck).toBe(5);
    expect(cv.baseBranch).toBe("main");
  });

  it("returns all DEFAULTS keys when no overrides are applied", () => {
    const rc = makeTestResolvedConfig();
    const cv = configValues(rc);

    for (const key of Object.keys(DEFAULTS) as Array<keyof RalphaiConfig>) {
      expect(cv[key]).toEqual(DEFAULTS[key]);
    }
  });

  it("preserves null values (workspaces default)", () => {
    const rc = makeTestResolvedConfig();
    const cv = configValues(rc);
    expect(cv.workspaces).toBeNull();
  });

  it("preserves complex values (workspaces override)", () => {
    const ws = { "packages/a": { feedbackCommands: ["bun test"] } };
    const rc = makeTestResolvedConfig({ workspaces: ws });
    const cv = configValues(rc);
    expect(cv.workspaces).toEqual(ws);
  });

  it("does not include source property on returned values", () => {
    const rc = makeTestResolvedConfig({ agentCommand: "echo" });
    const cv = configValues(rc);

    // cv.agentCommand should be a plain string, not a ResolvedValue
    expect(typeof cv.agentCommand).toBe("string");
    // Verify no 'source' key leaked into the result object's values
    const raw = cv as unknown as Record<string, unknown>;
    expect(raw["agentCommand"]).toBe("echo");
    // The value should not be an object with a source property
    expect(typeof raw["agentCommand"]).not.toBe("object");
  });

  it("handles mixed sources correctly", () => {
    // Simulate a ResolvedConfig where values come from different sources
    const rc = makeTestResolvedConfig();
    rc.agentCommand = { value: "from-cli", source: "cli" };
    rc.baseBranch = { value: "develop", source: "config" };
    rc.sandbox = { value: "docker", source: "auto-detected" };

    const cv = configValues(rc);
    expect(cv.agentCommand).toBe("from-cli");
    expect(cv.baseBranch).toBe("develop");
    expect(cv.sandbox).toBe("docker");
  });
});

// ---------------------------------------------------------------------------
// makeTestConfig()
// ---------------------------------------------------------------------------

describe("makeTestConfig()", () => {
  it("returns DEFAULTS when called without arguments", () => {
    const cfg = makeTestConfig();

    for (const key of Object.keys(DEFAULTS) as Array<keyof RalphaiConfig>) {
      expect(cfg[key]).toEqual(DEFAULTS[key]);
    }
  });

  it("returns DEFAULTS when called with empty overrides", () => {
    const cfg = makeTestConfig({});

    expect(cfg.agentCommand).toBe(DEFAULTS.agentCommand);
    expect(cfg.baseBranch).toBe(DEFAULTS.baseBranch);
    expect(cfg.maxStuck).toBe(DEFAULTS.maxStuck);
  });

  it("overrides specific keys while preserving defaults", () => {
    const cfg = makeTestConfig({
      agentCommand: "echo hello",
      maxStuck: 1,
    });

    expect(cfg.agentCommand).toBe("echo hello");
    expect(cfg.maxStuck).toBe(1);
    // Other keys remain at defaults
    expect(cfg.baseBranch).toBe("main");
    expect(cfg.issueSource).toBe("none");
    expect(cfg.sandbox).toBe("none");
  });

  it("allows overriding with non-default enum values", () => {
    const cfg = makeTestConfig({
      issueSource: "github",
      sandbox: "docker",
    });

    expect(cfg.issueSource).toBe("github");
    expect(cfg.sandbox).toBe("docker");
  });

  it("allows overriding workspaces", () => {
    const ws = { "packages/api": { feedbackCommands: ["npm test"] } };
    const cfg = makeTestConfig({ workspaces: ws });

    expect(cfg.workspaces).toEqual(ws);
  });

  it("returns a ConfigValues type (not ResolvedConfig)", () => {
    const cfg = makeTestConfig({ agentCommand: "test" });

    // Plain string, not wrapped in { value, source }
    expect(typeof cfg.agentCommand).toBe("string");
    expect(cfg.agentCommand).toBe("test");
  });
});
