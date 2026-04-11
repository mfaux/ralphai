/**
 * Config tests for issue.inProgressLabel, issue.doneLabel, issue.stuckLabel.
 *
 * Covers: config file parsing, env var overrides, defaults, and
 * resolveConfig precedence chain for all three configurable state labels.
 */
import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir, makeConfigTestHelpers } from "./test-utils.ts";
import {
  parseConfigFile,
  applyEnvOverrides,
  resolveConfig,
  DEFAULTS,
} from "./config.ts";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("DEFAULTS — state labels", () => {
  it("inProgressLabel defaults to 'in-progress'", () => {
    expect(DEFAULTS.issue.inProgressLabel).toBe("in-progress");
  });

  it("doneLabel defaults to 'done'", () => {
    expect(DEFAULTS.issue.doneLabel).toBe("done");
  });

  it("stuckLabel defaults to 'stuck'", () => {
    expect(DEFAULTS.issue.stuckLabel).toBe("stuck");
  });
});

// ---------------------------------------------------------------------------
// Config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — inProgressLabel", () => {
  const ctx = useTempDir();

  it("parses inProgressLabel from config", () => {
    const file = join(ctx.dir, "ip.json");
    writeFileSync(file, JSON.stringify({ issue: { inProgressLabel: "wip" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.issue!.inProgressLabel).toBe("wip");
  });

  it("rejects empty inProgressLabel", () => {
    const file = join(ctx.dir, "ip-empty.json");
    writeFileSync(file, JSON.stringify({ issue: { inProgressLabel: "" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issue.inProgressLabel' must be a non-empty label name",
    );
  });
});

describe("parseConfigFile — doneLabel", () => {
  const ctx = useTempDir();

  it("parses doneLabel from config", () => {
    const file = join(ctx.dir, "done.json");
    writeFileSync(file, JSON.stringify({ issue: { doneLabel: "completed" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.issue!.doneLabel).toBe("completed");
  });

  it("rejects empty doneLabel", () => {
    const file = join(ctx.dir, "done-empty.json");
    writeFileSync(file, JSON.stringify({ issue: { doneLabel: "" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issue.doneLabel' must be a non-empty label name",
    );
  });
});

describe("parseConfigFile — stuckLabel", () => {
  const ctx = useTempDir();

  it("parses stuckLabel from config", () => {
    const file = join(ctx.dir, "stuck.json");
    writeFileSync(file, JSON.stringify({ issue: { stuckLabel: "blocked" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.issue!.stuckLabel).toBe("blocked");
  });

  it("rejects empty stuckLabel", () => {
    const file = join(ctx.dir, "stuck-empty.json");
    writeFileSync(file, JSON.stringify({ issue: { stuckLabel: "" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issue.stuckLabel' must be a non-empty label name",
    );
  });
});

// ---------------------------------------------------------------------------
// Env var overrides
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — state labels", () => {
  it("extracts RALPHAI_ISSUE_IN_PROGRESS_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_IN_PROGRESS_LABEL: "working",
    });
    expect(result.issue!.inProgressLabel).toBe("working");
  });

  it("extracts RALPHAI_ISSUE_DONE_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_DONE_LABEL: "finished",
    });
    expect(result.issue!.doneLabel).toBe("finished");
  });

  it("extracts RALPHAI_ISSUE_STUCK_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_STUCK_LABEL: "blocked",
    });
    expect(result.issue!.stuckLabel).toBe("blocked");
  });

  it("ignores empty env vars", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_IN_PROGRESS_LABEL: "",
      RALPHAI_ISSUE_DONE_LABEL: "",
      RALPHAI_ISSUE_STUCK_LABEL: "",
    });
    expect(result.issue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — inProgressLabel precedence", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  it("returns default when no overrides", () => {
    const cwd = join(ctx.dir, "repo-ip-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.inProgressLabel.value).toBe("in-progress");
    expect(config.issue.inProgressLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-ip-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { inProgressLabel: "wip" } });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.inProgressLabel.value).toBe("wip");
    expect(config.issue.inProgressLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-ip-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { inProgressLabel: "wip" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_IN_PROGRESS_LABEL: "working" }),
      cliArgs: [],
    });
    expect(config.issue.inProgressLabel.value).toBe("working");
    expect(config.issue.inProgressLabel.source).toBe("env");
  });
});

describe("resolveConfig — doneLabel precedence", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  it("returns default when no overrides", () => {
    const cwd = join(ctx.dir, "repo-done-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.doneLabel.value).toBe("done");
    expect(config.issue.doneLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-done-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { doneLabel: "completed" } });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.doneLabel.value).toBe("completed");
    expect(config.issue.doneLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-done-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { doneLabel: "completed" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_DONE_LABEL: "finished" }),
      cliArgs: [],
    });
    expect(config.issue.doneLabel.value).toBe("finished");
    expect(config.issue.doneLabel.source).toBe("env");
  });
});

describe("resolveConfig — stuckLabel precedence", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  it("returns default when no overrides", () => {
    const cwd = join(ctx.dir, "repo-stuck-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.stuckLabel.value).toBe("stuck");
    expect(config.issue.stuckLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-stuck-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { stuckLabel: "blocked" } });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.stuckLabel.value).toBe("blocked");
    expect(config.issue.stuckLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-stuck-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { stuckLabel: "blocked" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_STUCK_LABEL: "needs-help" }),
      cliArgs: [],
    });
    expect(config.issue.stuckLabel.value).toBe("needs-help");
    expect(config.issue.stuckLabel.source).toBe("env");
  });
});
