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
// issuePrdInProgressLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — issuePrdInProgressLabel", () => {
  const ctx = useTempDir();

  it("parses issuePrdInProgressLabel from config", () => {
    const file = join(ctx.dir, "prd-ip.json");
    writeFileSync(
      file,
      JSON.stringify({ issuePrdInProgressLabel: "custom-prd:wip" }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.issuePrdInProgressLabel).toBe("custom-prd:wip");
  });

  it("rejects empty issuePrdInProgressLabel", () => {
    const file = join(ctx.dir, "prd-ip-empty.json");
    writeFileSync(file, JSON.stringify({ issuePrdInProgressLabel: "" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issuePrdInProgressLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string issuePrdInProgressLabel to string", () => {
    const file = join(ctx.dir, "prd-ip-num.json");
    writeFileSync(file, JSON.stringify({ issuePrdInProgressLabel: 42 }));
    const result = parseConfigFile(file)!;
    expect(result.values.issuePrdInProgressLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// issuePrdInProgressLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — issuePrdInProgressLabel", () => {
  it("extracts RALPHAI_ISSUE_PRD_IN_PROGRESS_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_PRD_IN_PROGRESS_LABEL: "env:prd-wip",
    });
    expect(result.issuePrdInProgressLabel).toBe("env:prd-wip");
  });

  it("ignores empty RALPHAI_ISSUE_PRD_IN_PROGRESS_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_PRD_IN_PROGRESS_LABEL: "",
    });
    expect(result.issuePrdInProgressLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// issuePrdInProgressLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — issuePrdInProgressLabel", () => {
  it("has default ralphai-prd:in-progress", () => {
    expect(DEFAULTS.issuePrdInProgressLabel).toBe("ralphai-prd:in-progress");
  });
});

// ---------------------------------------------------------------------------
// issuePrdInProgressLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — issuePrdInProgressLabel precedence", () => {
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
    const cwd = join(ctx.dir, "repo-prd-ip-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issuePrdInProgressLabel.value).toBe(
      "ralphai-prd:in-progress",
    );
    expect(config.issuePrdInProgressLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-prd-ip-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issuePrdInProgressLabel: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issuePrdInProgressLabel.value).toBe("from-config");
    expect(config.issuePrdInProgressLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-prd-ip-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issuePrdInProgressLabel: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_PRD_IN_PROGRESS_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.issuePrdInProgressLabel.value).toBe("from-env");
    expect(config.issuePrdInProgressLabel.source).toBe("env");
  });
});
