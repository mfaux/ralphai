import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  parseConfigFile,
  applyEnvOverrides,
  resolveConfig,
  getConfigFilePath,
  DEFAULTS,
} from "./config.ts";

// ---------------------------------------------------------------------------
// issueStuckLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — issueStuckLabel", () => {
  const ctx = useTempDir();

  it("parses issueStuckLabel from config", () => {
    const file = join(ctx.dir, "stuck.json");
    writeFileSync(file, JSON.stringify({ issueStuckLabel: "custom:stuck" }));
    const result = parseConfigFile(file)!;
    expect(result.values.issueStuckLabel).toBe("custom:stuck");
  });

  it("rejects empty issueStuckLabel", () => {
    const file = join(ctx.dir, "stuck-empty.json");
    writeFileSync(file, JSON.stringify({ issueStuckLabel: "" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issueStuckLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string issueStuckLabel to string", () => {
    const file = join(ctx.dir, "stuck-num.json");
    writeFileSync(file, JSON.stringify({ issueStuckLabel: 42 }));
    const result = parseConfigFile(file)!;
    expect(result.values.issueStuckLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// issueStuckLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — issueStuckLabel", () => {
  it("extracts RALPHAI_ISSUE_STUCK_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_STUCK_LABEL: "env:stuck",
    });
    expect(result.issueStuckLabel).toBe("env:stuck");
  });

  it("ignores empty RALPHAI_ISSUE_STUCK_LABEL", () => {
    const result = applyEnvOverrides({ RALPHAI_ISSUE_STUCK_LABEL: "" });
    expect(result.issueStuckLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// issueStuckLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — issueStuckLabel", () => {
  it("has default ralphai:stuck", () => {
    expect(DEFAULTS.issueStuckLabel).toBe("ralphai:stuck");
  });
});

// ---------------------------------------------------------------------------
// issueStuckLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — issueStuckLabel precedence", () => {
  const ctx = useTempDir();

  function env(
    extra?: Record<string, string>,
  ): Record<string, string | undefined> {
    return { RALPHAI_HOME: join(ctx.dir, "home"), ...extra };
  }

  function writeGlobalConfig(
    cwd: string,
    config: Record<string, unknown>,
  ): void {
    const filePath = getConfigFilePath(cwd, env());
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(config));
  }

  it("returns default when no overrides", () => {
    const cwd = join(ctx.dir, "repo-stuck-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issueStuckLabel.value).toBe("ralphai:stuck");
    expect(config.issueStuckLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-stuck-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issueStuckLabel: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issueStuckLabel.value).toBe("from-config");
    expect(config.issueStuckLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-stuck-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issueStuckLabel: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_STUCK_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.issueStuckLabel.value).toBe("from-env");
    expect(config.issueStuckLabel.source).toBe("env");
  });
});
