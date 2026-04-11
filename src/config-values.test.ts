/**
 * Tests for configValues() and makeTestConfig().
 *
 * configValues() strips resolution metadata from a ResolvedConfig.
 * makeTestConfig() builds a ConfigValues with DEFAULTS + overrides.
 */

import { describe, it, expect } from "bun:test";
import { configValues, DEFAULTS } from "./config.ts";
import { makeTestConfig, makeTestResolvedConfig } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// configValues()
// ---------------------------------------------------------------------------

describe("configValues()", () => {
  it("strips source metadata and returns plain values", () => {
    const rc = makeTestResolvedConfig({
      agent: { command: "claude -p" },
      gate: { maxStuck: 5 },
    });
    const cv = configValues(rc);

    expect(cv.agent.command).toBe("claude -p");
    expect(cv.gate.maxStuck).toBe(5);
    expect(cv.baseBranch).toBe("main");
  });

  it("returns all DEFAULTS keys when no overrides are applied", () => {
    const rc = makeTestResolvedConfig();
    const cv = configValues(rc);

    // Check nested groups
    expect(cv.agent).toEqual(DEFAULTS.agent);
    expect(cv.hooks).toEqual(DEFAULTS.hooks);
    expect(cv.gate).toEqual(DEFAULTS.gate);
    expect(cv.prompt).toEqual(DEFAULTS.prompt);
    expect(cv.pr).toEqual(DEFAULTS.pr);
    expect(cv.git).toEqual(DEFAULTS.git);
    expect(cv.issue).toEqual(DEFAULTS.issue);

    // Check flat top-level keys
    expect(cv.baseBranch).toEqual(DEFAULTS.baseBranch);
    expect(cv.sandbox).toEqual(DEFAULTS.sandbox);
    expect(cv.dockerImage).toEqual(DEFAULTS.dockerImage);
    expect(cv.dockerMounts).toEqual(DEFAULTS.dockerMounts);
    expect(cv.dockerEnvVars).toEqual(DEFAULTS.dockerEnvVars);
    expect(cv.workspaces).toEqual(DEFAULTS.workspaces);
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
    const rc = makeTestResolvedConfig({ agent: { command: "echo" } });
    const cv = configValues(rc);

    // cv.agent.command should be a plain string, not a ResolvedValue
    expect(typeof cv.agent.command).toBe("string");
    // Verify no 'source' key leaked into the nested group
    const rawAgent = cv.agent as unknown as Record<string, unknown>;
    expect(rawAgent["command"]).toBe("echo");
    // The value should not be an object with a source property
    expect(typeof rawAgent["command"]).not.toBe("object");
  });

  it("handles mixed sources correctly", () => {
    // Simulate a ResolvedConfig where values come from different sources
    const rc = makeTestResolvedConfig();
    rc.agent.command = { value: "from-cli", source: "cli" };
    rc.baseBranch = { value: "develop", source: "config" };
    rc.sandbox = { value: "docker", source: "auto-detected" };

    const cv = configValues(rc);
    expect(cv.agent.command).toBe("from-cli");
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

    expect(cfg.agent).toEqual(DEFAULTS.agent);
    expect(cfg.hooks).toEqual(DEFAULTS.hooks);
    expect(cfg.gate).toEqual(DEFAULTS.gate);
    expect(cfg.prompt).toEqual(DEFAULTS.prompt);
    expect(cfg.pr).toEqual(DEFAULTS.pr);
    expect(cfg.git).toEqual(DEFAULTS.git);
    expect(cfg.issue).toEqual(DEFAULTS.issue);
    expect(cfg.baseBranch).toEqual(DEFAULTS.baseBranch);
    expect(cfg.sandbox).toEqual(DEFAULTS.sandbox);
    expect(cfg.workspaces).toEqual(DEFAULTS.workspaces);
  });

  it("returns DEFAULTS when called with empty overrides", () => {
    const cfg = makeTestConfig({});

    expect(cfg.agent.command).toBe(DEFAULTS.agent.command);
    expect(cfg.baseBranch).toBe(DEFAULTS.baseBranch);
    expect(cfg.gate.maxStuck).toBe(DEFAULTS.gate.maxStuck);
  });

  it("overrides specific keys while preserving defaults", () => {
    const cfg = makeTestConfig({
      agent: { command: "echo hello" },
      gate: { maxStuck: 1 },
    });

    expect(cfg.agent.command).toBe("echo hello");
    expect(cfg.gate.maxStuck).toBe(1);
    // Other keys remain at defaults
    expect(cfg.baseBranch).toBe("main");
    expect(cfg.issue.source).toBe("none");
    expect(cfg.sandbox).toBe("none");
  });

  it("allows overriding with non-default enum values", () => {
    const cfg = makeTestConfig({
      issue: { source: "github" },
      sandbox: "docker",
    });

    expect(cfg.issue.source).toBe("github");
    expect(cfg.sandbox).toBe("docker");
  });

  it("allows overriding workspaces", () => {
    const ws = { "packages/api": { feedbackCommands: ["npm test"] } };
    const cfg = makeTestConfig({ workspaces: ws });

    expect(cfg.workspaces).toEqual(ws);
  });

  it("returns a ConfigValues type (not ResolvedConfig)", () => {
    const cfg = makeTestConfig({ agent: { command: "test" } });

    // Plain string, not wrapped in { value, source }
    expect(typeof cfg.agent.command).toBe("string");
    expect(cfg.agent.command).toBe("test");
  });
});
