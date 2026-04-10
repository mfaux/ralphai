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
// terse — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — terse", () => {
  const ctx = useTempDir();

  it("parses terse: true from config", () => {
    const file = join(ctx.dir, "terse-true.json");
    writeFileSync(file, JSON.stringify({ terse: true }));
    const result = parseConfigFile(file)!;
    expect(result.values.terse).toBe("true");
  });

  it("parses terse: false from config", () => {
    const file = join(ctx.dir, "terse-false.json");
    writeFileSync(file, JSON.stringify({ terse: false }));
    const result = parseConfigFile(file)!;
    expect(result.values.terse).toBe("false");
  });

  it("rejects non-boolean terse value", () => {
    const file = join(ctx.dir, "terse-invalid.json");
    writeFileSync(file, JSON.stringify({ terse: "yes" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'terse' must be 'true' or 'false', got 'yes'",
    );
  });
});

// ---------------------------------------------------------------------------
// terse — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — terse", () => {
  it("extracts RALPHAI_TERSE=true", () => {
    const result = applyEnvOverrides({ RALPHAI_TERSE: "true" });
    expect(result.terse).toBe("true");
  });

  it("extracts RALPHAI_TERSE=false", () => {
    const result = applyEnvOverrides({ RALPHAI_TERSE: "false" });
    expect(result.terse).toBe("false");
  });

  it("rejects invalid RALPHAI_TERSE value", () => {
    expect(() => applyEnvOverrides({ RALPHAI_TERSE: "yes" })).toThrow(
      "RALPHAI_TERSE must be 'true' or 'false', got 'yes'",
    );
  });

  it("ignores empty RALPHAI_TERSE", () => {
    const result = applyEnvOverrides({ RALPHAI_TERSE: "" });
    expect(result.terse).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// terse — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — terse", () => {
  it("has default 'false'", () => {
    expect(DEFAULTS.terse).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// terse — CLI flag parsing
// ---------------------------------------------------------------------------

describe("parseCLIArgs — terse", () => {
  it("--terse sets terse to 'true' with rawFlag", () => {
    const result = parseCLIArgs(["--terse"]);
    expect(result.overrides.terse).toBe("true");
    expect(result.rawFlags.terse).toBe("--terse");
  });

  it("--no-terse sets terse to 'false' with rawFlag", () => {
    const result = parseCLIArgs(["--no-terse"]);
    expect(result.overrides.terse).toBe("false");
    expect(result.rawFlags.terse).toBe("--no-terse");
  });
});

// ---------------------------------------------------------------------------
// terse — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — terse precedence", () => {
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
    const cwd = join(ctx.dir, "repo-terse-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.terse.value).toBe("false");
    expect(config.terse.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-terse-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { terse: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.terse.value).toBe("true");
    expect(config.terse.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-terse-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { terse: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_TERSE: "false" }),
      cliArgs: [],
    });
    expect(config.terse.value).toBe("false");
    expect(config.terse.source).toBe("env");
  });

  it("CLI flag overrides env var", () => {
    const cwd = join(ctx.dir, "repo-terse-cli");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_TERSE: "false" }),
      cliArgs: ["--terse"],
    });
    expect(config.terse.value).toBe("true");
    expect(config.terse.source).toBe("cli");
  });

  it("full precedence chain: CLI > env > config > default", () => {
    const cwd = join(ctx.dir, "repo-terse-full");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { terse: false });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_TERSE: "false" }),
      cliArgs: ["--terse"],
    });
    expect(config.terse.value).toBe("true");
    expect(config.terse.source).toBe("cli");
  });
});
