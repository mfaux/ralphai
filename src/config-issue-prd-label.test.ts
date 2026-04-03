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
// issuePrdLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — issuePrdLabel", () => {
  const ctx = useTempDir();

  it("parses issuePrdLabel from config", () => {
    const file = join(ctx.dir, "prd.json");
    writeFileSync(file, JSON.stringify({ issuePrdLabel: "custom-prd" }));
    const result = parseConfigFile(file)!;
    expect(result.values.issuePrdLabel).toBe("custom-prd");
  });

  it("rejects empty issuePrdLabel", () => {
    const file = join(ctx.dir, "prd-empty.json");
    writeFileSync(file, JSON.stringify({ issuePrdLabel: "" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issuePrdLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string issuePrdLabel to string", () => {
    const file = join(ctx.dir, "prd-num.json");
    writeFileSync(file, JSON.stringify({ issuePrdLabel: 42 }));
    const result = parseConfigFile(file)!;
    expect(result.values.issuePrdLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// issuePrdLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — issuePrdLabel", () => {
  it("extracts RALPHAI_ISSUE_PRD_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_PRD_LABEL: "env-prd",
    });
    expect(result.issuePrdLabel).toBe("env-prd");
  });

  it("ignores empty RALPHAI_ISSUE_PRD_LABEL", () => {
    const result = applyEnvOverrides({ RALPHAI_ISSUE_PRD_LABEL: "" });
    expect(result.issuePrdLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// issuePrdLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — issuePrdLabel", () => {
  it("has default ralphai-prd", () => {
    expect(DEFAULTS.issuePrdLabel).toBe("ralphai-prd");
  });
});

// ---------------------------------------------------------------------------
// issuePrdLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — issuePrdLabel precedence", () => {
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
    const cwd = join(ctx.dir, "repo-prd-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issuePrdLabel.value).toBe("ralphai-prd");
    expect(config.issuePrdLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-prd-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issuePrdLabel: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issuePrdLabel.value).toBe("from-config");
    expect(config.issuePrdLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-prd-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issuePrdLabel: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_PRD_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.issuePrdLabel.value).toBe("from-env");
    expect(config.issuePrdLabel.source).toBe("env");
  });
});
