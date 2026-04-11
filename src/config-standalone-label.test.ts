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
// standaloneLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — standaloneLabel", () => {
  const ctx = useTempDir();

  it("parses standaloneLabel from config", () => {
    const file = join(ctx.dir, "standalone.json");
    writeFileSync(
      file,
      JSON.stringify({ issue: { standaloneLabel: "custom-standalone" } }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.issue!.standaloneLabel).toBe("custom-standalone");
  });

  it("rejects empty standaloneLabel", () => {
    const file = join(ctx.dir, "standalone-empty.json");
    writeFileSync(file, JSON.stringify({ issue: { standaloneLabel: "" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issue.standaloneLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string standaloneLabel to string", () => {
    const file = join(ctx.dir, "standalone-num.json");
    writeFileSync(file, JSON.stringify({ issue: { standaloneLabel: 42 } }));
    const result = parseConfigFile(file)!;
    expect(result.values.issue!.standaloneLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// standaloneLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — standaloneLabel", () => {
  it("extracts RALPHAI_ISSUE_STANDALONE_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_STANDALONE_LABEL: "env-standalone",
    });
    expect(result.issue!.standaloneLabel).toBe("env-standalone");
  });

  it("ignores empty RALPHAI_ISSUE_STANDALONE_LABEL", () => {
    const result = applyEnvOverrides({ RALPHAI_ISSUE_STANDALONE_LABEL: "" });
    expect(result.issue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// standaloneLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — standaloneLabel", () => {
  it("has default ralphai-standalone", () => {
    expect(DEFAULTS.issue.standaloneLabel).toBe("ralphai-standalone");
  });
});

// ---------------------------------------------------------------------------
// standaloneLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — standaloneLabel precedence", () => {
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
    const cwd = join(ctx.dir, "repo-standalone-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.standaloneLabel.value).toBe("ralphai-standalone");
    expect(config.issue.standaloneLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-standalone-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { standaloneLabel: "from-config" } });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.standaloneLabel.value).toBe("from-config");
    expect(config.issue.standaloneLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-standalone-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { standaloneLabel: "from-config" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_STANDALONE_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.issue.standaloneLabel.value).toBe("from-env");
    expect(config.issue.standaloneLabel.source).toBe("env");
  });
});
