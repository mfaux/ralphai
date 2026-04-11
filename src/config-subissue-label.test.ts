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
// subissueLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — subissueLabel", () => {
  const ctx = useTempDir();

  it("parses subissueLabel from config", () => {
    const file = join(ctx.dir, "subissue.json");
    writeFileSync(
      file,
      JSON.stringify({ issue: { subissueLabel: "custom-subissue" } }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.issue!.subissueLabel).toBe("custom-subissue");
  });

  it("rejects empty subissueLabel", () => {
    const file = join(ctx.dir, "subissue-empty.json");
    writeFileSync(file, JSON.stringify({ issue: { subissueLabel: "" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issue.subissueLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string subissueLabel to string", () => {
    const file = join(ctx.dir, "subissue-num.json");
    writeFileSync(file, JSON.stringify({ issue: { subissueLabel: 42 } }));
    const result = parseConfigFile(file)!;
    expect(result.values.issue!.subissueLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// subissueLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — subissueLabel", () => {
  it("extracts RALPHAI_ISSUE_SUBISSUE_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_SUBISSUE_LABEL: "env-subissue",
    });
    expect(result.issue!.subissueLabel).toBe("env-subissue");
  });

  it("ignores empty RALPHAI_ISSUE_SUBISSUE_LABEL", () => {
    const result = applyEnvOverrides({ RALPHAI_ISSUE_SUBISSUE_LABEL: "" });
    expect(result.issue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// subissueLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — subissueLabel", () => {
  it("has default ralphai-subissue", () => {
    expect(DEFAULTS.issue.subissueLabel).toBe("ralphai-subissue");
  });
});

// ---------------------------------------------------------------------------
// subissueLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — subissueLabel precedence", () => {
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
    const cwd = join(ctx.dir, "repo-subissue-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.subissueLabel.value).toBe("ralphai-subissue");
    expect(config.issue.subissueLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-subissue-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { subissueLabel: "from-config" } });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issue.subissueLabel.value).toBe("from-config");
    expect(config.issue.subissueLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-subissue-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issue: { subissueLabel: "from-config" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_SUBISSUE_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.issue.subissueLabel.value).toBe("from-env");
    expect(config.issue.subissueLabel.source).toBe("env");
  });
});
