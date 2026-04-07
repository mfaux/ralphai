import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  parseConfigFile,
  applyEnvOverrides,
  parseCLIArgs,
  resolveConfig,
  getConfigFilePath,
  DEFAULTS,
} from "./config.ts";

// ---------------------------------------------------------------------------
// issueHitlLabel — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — issueHitlLabel", () => {
  const ctx = useTempDir();

  it("parses issueHitlLabel from config", () => {
    const file = join(ctx.dir, "hitl.json");
    writeFileSync(file, JSON.stringify({ issueHitlLabel: "custom-hitl" }));
    const result = parseConfigFile(file)!;
    expect(result.values.issueHitlLabel).toBe("custom-hitl");
  });

  it("rejects empty issueHitlLabel", () => {
    const file = join(ctx.dir, "hitl-empty.json");
    writeFileSync(file, JSON.stringify({ issueHitlLabel: "" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'issueHitlLabel' must be a non-empty label name",
    );
  });

  it("coerces non-string issueHitlLabel to string", () => {
    const file = join(ctx.dir, "hitl-num.json");
    writeFileSync(file, JSON.stringify({ issueHitlLabel: 42 }));
    const result = parseConfigFile(file)!;
    expect(result.values.issueHitlLabel).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// issueHitlLabel — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — issueHitlLabel", () => {
  it("extracts RALPHAI_ISSUE_HITL_LABEL", () => {
    const result = applyEnvOverrides({
      RALPHAI_ISSUE_HITL_LABEL: "env-hitl",
    });
    expect(result.issueHitlLabel).toBe("env-hitl");
  });

  it("ignores empty RALPHAI_ISSUE_HITL_LABEL", () => {
    const result = applyEnvOverrides({ RALPHAI_ISSUE_HITL_LABEL: "" });
    expect(result.issueHitlLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// issueHitlLabel — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — issueHitlLabel", () => {
  it("has default ralphai-subissue-hitl", () => {
    expect(DEFAULTS.issueHitlLabel).toBe("ralphai-subissue-hitl");
  });
});

// ---------------------------------------------------------------------------
// issueHitlLabel — CLI arg parsing
// ---------------------------------------------------------------------------

describe("parseCLIArgs — issueHitlLabel", () => {
  it("parses --issue-hitl-label=", () => {
    const { overrides, rawFlags } = parseCLIArgs([
      "--issue-hitl-label=my-hitl-label",
    ]);
    expect(overrides.issueHitlLabel).toBe("my-hitl-label");
    expect(rawFlags.issueHitlLabel).toBe("--issue-hitl-label=my-hitl-label");
  });

  it("rejects empty --issue-hitl-label=", () => {
    expect(() => parseCLIArgs(["--issue-hitl-label="])).toThrow(
      "--issue-hitl-label requires a non-empty value",
    );
  });
});

// ---------------------------------------------------------------------------
// issueHitlLabel — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — issueHitlLabel precedence", () => {
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
    const cwd = join(ctx.dir, "repo-hitl-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issueHitlLabel.value).toBe("ralphai-subissue-hitl");
    expect(config.issueHitlLabel.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-hitl-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issueHitlLabel: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.issueHitlLabel.value).toBe("from-config");
    expect(config.issueHitlLabel.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-hitl-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issueHitlLabel: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_HITL_LABEL: "from-env" }),
      cliArgs: [],
    });
    expect(config.issueHitlLabel.value).toBe("from-env");
    expect(config.issueHitlLabel.source).toBe("env");
  });

  it("CLI overrides env var", () => {
    const cwd = join(ctx.dir, "repo-hitl-cli");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { issueHitlLabel: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_ISSUE_HITL_LABEL: "from-env" }),
      cliArgs: ["--issue-hitl-label=from-cli"],
    });
    expect(config.issueHitlLabel.value).toBe("from-cli");
    expect(config.issueHitlLabel.source).toBe("cli");
  });
});
