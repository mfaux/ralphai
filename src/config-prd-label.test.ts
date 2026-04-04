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
// prdLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — prdLabel", () => {
  const ctx = useTempDir();

  it("parses prdLabel from config", () => {
    const file = join(ctx.dir, "prd.json");
    writeFileSync(file, JSON.stringify({ prdLabel: "custom-prd" }));
    const result = parseConfigFile(file)!;
    expect(result.values.prdLabel).toBe("custom-prd");
  });

  it("rejects empty prdLabel", () => {
    const file = join(ctx.dir, "prd-empty.json");
    writeFileSync(file, JSON.stringify({ prdLabel: "" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'prdLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string prdLabel to string", () => {
    const file = join(ctx.dir, "prd-num.json");
    writeFileSync(file, JSON.stringify({ prdLabel: 42 }));
    const result = parseConfigFile(file)!;
    expect(result.values.prdLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// prdLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — prdLabel", () => {
  it("extracts RALPHAI_PRD_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_PRD_LABEL: "env-prd",
    });
    expect(result.prdLabel).toBe("env-prd");
  });

  it("ignores empty RALPHAI_PRD_LABEL", () => {
    const result = applyEnvOverrides({ RALPHAI_PRD_LABEL: "" });
    expect(result.prdLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prdLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — prdLabel", () => {
  it("has default ralphai-prd", () => {
    expect(DEFAULTS.prdLabel).toBe("ralphai-prd");
  });
});

// ---------------------------------------------------------------------------
// prdLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — prdLabel precedence", () => {
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
    expect(config.prdLabel.value).toBe("ralphai-prd");
    expect(config.prdLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-prd-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { prdLabel: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.prdLabel.value).toBe("from-config");
    expect(config.prdLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-prd-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { prdLabel: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_PRD_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.prdLabel.value).toBe("from-env");
    expect(config.prdLabel.source).toBe("env");
  });
});
