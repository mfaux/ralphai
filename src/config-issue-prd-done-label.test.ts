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
// issuePrdDoneLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — issuePrdDoneLabel", () => {
  const ctx = useTempDir();

  it("parses issuePrdDoneLabel from config", () => {
    const file = join(ctx.dir, "prd-done.json");
    writeFileSync(
      file,
      JSON.stringify({ issuePrdDoneLabel: "custom-prd:finished" }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.issuePrdDoneLabel).toBe("custom-prd:finished");
  });

  it("rejects empty issuePrdDoneLabel", () => {
    const file = join(ctx.dir, "prd-done-empty.json");
    writeFileSync(file, JSON.stringify({ issuePrdDoneLabel: "" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issuePrdDoneLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string issuePrdDoneLabel to string", () => {
    const file = join(ctx.dir, "prd-done-num.json");
    writeFileSync(file, JSON.stringify({ issuePrdDoneLabel: 42 }));
    const result = parseConfigFile(file)!;
    expect(result.values.issuePrdDoneLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// issuePrdDoneLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — issuePrdDoneLabel", () => {
  it("extracts RALPHAI_ISSUE_PRD_DONE_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_PRD_DONE_LABEL: "env:prd-finished",
    });
    expect(result.issuePrdDoneLabel).toBe("env:prd-finished");
  });

  it("ignores empty RALPHAI_ISSUE_PRD_DONE_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_PRD_DONE_LABEL: "",
    });
    expect(result.issuePrdDoneLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// issuePrdDoneLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — issuePrdDoneLabel", () => {
  it("has default ralphai-prd:done", () => {
    expect(DEFAULTS.issuePrdDoneLabel).toBe("ralphai-prd:done");
  });
});

// ---------------------------------------------------------------------------
// issuePrdDoneLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — issuePrdDoneLabel precedence", () => {
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
    const cwd = join(ctx.dir, "repo-prd-done-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issuePrdDoneLabel.value).toBe("ralphai-prd:done");
    expect(config.issuePrdDoneLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-prd-done-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issuePrdDoneLabel: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issuePrdDoneLabel.value).toBe("from-config");
    expect(config.issuePrdDoneLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-prd-done-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issuePrdDoneLabel: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_PRD_DONE_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.issuePrdDoneLabel.value).toBe("from-env");
    expect(config.issuePrdDoneLabel.source).toBe("env");
  });
});
