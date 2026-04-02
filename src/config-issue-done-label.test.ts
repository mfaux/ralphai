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
// issueDoneLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — issueDoneLabel", () => {
  const ctx = useTempDir();

  it("parses issueDoneLabel from config", () => {
    const file = join(ctx.dir, "done.json");
    writeFileSync(file, JSON.stringify({ issueDoneLabel: "custom:done" }));
    const result = parseConfigFile(file)!;
    expect(result.values.issueDoneLabel).toBe("custom:done");
  });

  it("rejects empty issueDoneLabel", () => {
    const file = join(ctx.dir, "done-empty.json");
    writeFileSync(file, JSON.stringify({ issueDoneLabel: "" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issueDoneLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string issueDoneLabel to string", () => {
    const file = join(ctx.dir, "done-num.json");
    writeFileSync(file, JSON.stringify({ issueDoneLabel: 42 }));
    const result = parseConfigFile(file)!;
    expect(result.values.issueDoneLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// issueDoneLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — issueDoneLabel", () => {
  it("extracts RALPHAI_ISSUE_DONE_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_DONE_LABEL: "env:done",
    });
    expect(result.issueDoneLabel).toBe("env:done");
  });

  it("ignores empty RALPHAI_ISSUE_DONE_LABEL", () => {
    const result = applyEnvOverrides({ RALPHAI_ISSUE_DONE_LABEL: "" });
    expect(result.issueDoneLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// issueDoneLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — issueDoneLabel", () => {
  it("has default ralphai:done", () => {
    expect(DEFAULTS.issueDoneLabel).toBe("ralphai:done");
  });
});

// ---------------------------------------------------------------------------
// issueDoneLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — issueDoneLabel precedence", () => {
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
    const cwd = join(ctx.dir, "repo-done-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issueDoneLabel.value).toBe("ralphai:done");
    expect(config.issueDoneLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-done-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issueDoneLabel: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issueDoneLabel.value).toBe("from-config");
    expect(config.issueDoneLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-done-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issueDoneLabel: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_DONE_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.issueDoneLabel.value).toBe("from-env");
    expect(config.issueDoneLabel.source).toBe("env");
  });
});
