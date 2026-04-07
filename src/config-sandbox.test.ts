/**
 * Tests for the `sandbox` config key — 4-layer resolution, validation,
 * and integration with the executor abstraction.
 */
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
  ConfigError,
} from "./config.ts";

// ---------------------------------------------------------------------------
// Default value
// ---------------------------------------------------------------------------

describe("sandbox default", () => {
  it("defaults to 'none'", () => {
    expect(DEFAULTS.sandbox).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// parseConfigFile — sandbox key
// ---------------------------------------------------------------------------

describe("parseConfigFile — sandbox key", () => {
  const ctx = useTempDir();

  it("parses sandbox='none' from config file", () => {
    const filePath = join(ctx.dir, "config.json");
    writeFileSync(filePath, JSON.stringify({ sandbox: "none" }));
    const result = parseConfigFile(filePath);
    expect(result!.values.sandbox).toBe("none");
  });

  it("parses sandbox='docker' from config file", () => {
    const filePath = join(ctx.dir, "config-docker.json");
    writeFileSync(filePath, JSON.stringify({ sandbox: "docker" }));
    const result = parseConfigFile(filePath);
    expect(result!.values.sandbox).toBe("docker");
  });

  it("rejects invalid sandbox value in config file", () => {
    const filePath = join(ctx.dir, "config-bad.json");
    writeFileSync(filePath, JSON.stringify({ sandbox: "podman" }));
    expect(() => parseConfigFile(filePath)).toThrow(
      "'sandbox' must be 'none' or 'docker', got 'podman'",
    );
  });
});

// ---------------------------------------------------------------------------
// applyEnvOverrides — RALPHAI_SANDBOX
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — RALPHAI_SANDBOX", () => {
  it("reads sandbox from RALPHAI_SANDBOX env var", () => {
    const result = applyEnvOverrides({ RALPHAI_SANDBOX: "none" });
    expect(result.sandbox).toBe("none");
  });

  it("reads sandbox=docker from RALPHAI_SANDBOX env var", () => {
    const result = applyEnvOverrides({ RALPHAI_SANDBOX: "docker" });
    expect(result.sandbox).toBe("docker");
  });

  it("ignores empty RALPHAI_SANDBOX env var", () => {
    const result = applyEnvOverrides({ RALPHAI_SANDBOX: "" });
    expect(result.sandbox).toBeUndefined();
  });

  it("rejects invalid RALPHAI_SANDBOX value", () => {
    expect(() => applyEnvOverrides({ RALPHAI_SANDBOX: "invalid" })).toThrow(
      "must be 'none' or 'docker'",
    );
  });
});

// ---------------------------------------------------------------------------
// parseCLIArgs — --sandbox flag
// ---------------------------------------------------------------------------

describe("parseCLIArgs — --sandbox flag", () => {
  it("parses --sandbox=none", () => {
    const result = parseCLIArgs(["--sandbox=none"]);
    expect(result.overrides.sandbox).toBe("none");
    expect(result.rawFlags.sandbox).toBe("--sandbox=none");
  });

  it("parses --sandbox=docker", () => {
    const result = parseCLIArgs(["--sandbox=docker"]);
    expect(result.overrides.sandbox).toBe("docker");
    expect(result.rawFlags.sandbox).toBe("--sandbox=docker");
  });

  it("rejects invalid --sandbox value", () => {
    expect(() => parseCLIArgs(["--sandbox=lxc"])).toThrow(
      "must be 'none' or 'docker'",
    );
  });

  it("combines with other flags", () => {
    const result = parseCLIArgs([
      "--agent-command=claude -p",
      "--sandbox=docker",
    ]);
    expect(result.overrides.agentCommand).toBe("claude -p");
    expect(result.overrides.sandbox).toBe("docker");
  });
});

// ---------------------------------------------------------------------------
// resolveConfig — sandbox 4-layer resolution
// ---------------------------------------------------------------------------

describe("resolveConfig — sandbox 4-layer resolution", () => {
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

  it("defaults to 'none' when no override is set", () => {
    const cwd = join(ctx.dir, "repo-sandbox-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.sandbox.value).toBe("none");
    expect(config.sandbox.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-sandbox-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { sandbox: "docker" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.sandbox.value).toBe("docker");
    expect(config.sandbox.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-sandbox-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { sandbox: "docker" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_SANDBOX: "none" }),
      cliArgs: [],
    });
    expect(config.sandbox.value).toBe("none");
    expect(config.sandbox.source).toBe("env");
  });

  it("CLI flag overrides env var", () => {
    const cwd = join(ctx.dir, "repo-sandbox-cli");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_SANDBOX: "none" }),
      cliArgs: ["--sandbox=docker"],
    });
    expect(config.sandbox.value).toBe("docker");
    expect(config.sandbox.source).toBe("cli");
  });

  it("full precedence chain: default < config < env < CLI", () => {
    const cwd = join(ctx.dir, "repo-sandbox-full");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { sandbox: "docker" });

    // Without env/CLI overrides: config wins
    const r1 = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(r1.config.sandbox.value).toBe("docker");
    expect(r1.config.sandbox.source).toBe("config");

    // With env override: env wins
    const r2 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_SANDBOX: "none" }),
      cliArgs: [],
    });
    expect(r2.config.sandbox.value).toBe("none");
    expect(r2.config.sandbox.source).toBe("env");

    // With CLI override: CLI wins
    const r3 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_SANDBOX: "none" }),
      cliArgs: ["--sandbox=docker"],
    });
    expect(r3.config.sandbox.value).toBe("docker");
    expect(r3.config.sandbox.source).toBe("cli");
  });
});
