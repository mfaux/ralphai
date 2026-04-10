import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  parseConfigFile,
  parseCLIArgs,
  applyEnvOverrides,
  resolveConfig,
  getConfigFilePath,
  DEFAULTS,
} from "./config.ts";

// ---------------------------------------------------------------------------
// verbose — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — verbose", () => {
  const ctx = useTempDir();

  it("parses verbose: true from config", () => {
    const file = join(ctx.dir, "verbose-true.json");
    writeFileSync(file, JSON.stringify({ verbose: true }));
    const result = parseConfigFile(file)!;
    expect(result.values.verbose).toBe("true");
  });

  it("parses verbose: false from config", () => {
    const file = join(ctx.dir, "verbose-false.json");
    writeFileSync(file, JSON.stringify({ verbose: false }));
    const result = parseConfigFile(file)!;
    expect(result.values.verbose).toBe("false");
  });

  it("rejects non-boolean verbose value", () => {
    const file = join(ctx.dir, "verbose-invalid.json");
    writeFileSync(file, JSON.stringify({ verbose: "yes" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'verbose' must be 'true' or 'false', got 'yes'",
    );
  });
});

// ---------------------------------------------------------------------------
// verbose — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — verbose", () => {
  it("extracts RALPHAI_VERBOSE=true", () => {
    const result = applyEnvOverrides({ RALPHAI_VERBOSE: "true" });
    expect(result.verbose).toBe("true");
  });

  it("extracts RALPHAI_VERBOSE=false", () => {
    const result = applyEnvOverrides({ RALPHAI_VERBOSE: "false" });
    expect(result.verbose).toBe("false");
  });

  it("rejects invalid RALPHAI_VERBOSE value", () => {
    expect(() => applyEnvOverrides({ RALPHAI_VERBOSE: "yes" })).toThrow(
      "RALPHAI_VERBOSE must be 'true' or 'false', got 'yes'",
    );
  });

  it("ignores empty RALPHAI_VERBOSE", () => {
    const result = applyEnvOverrides({ RALPHAI_VERBOSE: "" });
    expect(result.verbose).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// verbose — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — verbose", () => {
  it("has default 'false'", () => {
    expect(DEFAULTS.verbose).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// verbose — CLI flag parsing
// ---------------------------------------------------------------------------

describe("parseCLIArgs — verbose", () => {
  it("--verbose sets verbose to 'true' with rawFlag", () => {
    const result = parseCLIArgs(["--verbose"]);
    expect(result.overrides.verbose).toBe("true");
    expect(result.rawFlags.verbose).toBe("--verbose");
  });
});

// ---------------------------------------------------------------------------
// verbose — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — verbose precedence", () => {
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

  it("returns default 'false' when no overrides", () => {
    const cwd = join(ctx.dir, "repo-verbose-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.verbose.value).toBe("false");
    expect(config.verbose.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-verbose-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { verbose: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.verbose.value).toBe("true");
    expect(config.verbose.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-verbose-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { verbose: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_VERBOSE: "false" }),
      cliArgs: [],
    });
    expect(config.verbose.value).toBe("false");
    expect(config.verbose.source).toBe("env");
  });

  it("CLI flag overrides env var", () => {
    const cwd = join(ctx.dir, "repo-verbose-cli");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_VERBOSE: "false" }),
      cliArgs: ["--verbose"],
    });
    expect(config.verbose.value).toBe("true");
    expect(config.verbose.source).toBe("cli");
  });

  it("full precedence chain: CLI > env > config > default", () => {
    const cwd = join(ctx.dir, "repo-verbose-full");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { verbose: false });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_VERBOSE: "false" }),
      cliArgs: ["--verbose"],
    });
    expect(config.verbose.value).toBe("true");
    expect(config.verbose.source).toBe("cli");
  });
});
