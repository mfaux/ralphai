/**
 * Tests for the `sandbox` config key — 4-layer resolution, auto-detection,
 * validation, and integration with the executor abstraction.
 */
import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

import { useTempDir, makeConfigTestHelpers } from "./test-utils.ts";
import {
  parseConfigFile,
  applyEnvOverrides,
  parseCLIArgs,
  resolveConfig,
  detectDockerAvailable,
  DEFAULTS,
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
    expect(result.overrides.agent!.command).toBe("claude -p");
    expect(result.overrides.sandbox).toBe("docker");
  });
});

// ---------------------------------------------------------------------------
// resolveConfig — sandbox 4-layer resolution
// ---------------------------------------------------------------------------

describe("resolveConfig — sandbox 4-layer resolution", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  // Use detectDocker override to keep existing layer tests deterministic —
  // they test precedence, not auto-detection.
  const noDocker = () => false;

  it("auto-detects 'none' when no override is set and Docker unavailable", () => {
    const cwd = join(ctx.dir, "repo-sandbox-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: [],
      detectDocker: () => false,
    });
    expect(config.sandbox.value).toBe("none");
    expect(config.sandbox.source).toBe("auto-detected");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-sandbox-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { sandbox: "docker" });
    const { config } = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: [],
      detectDocker: noDocker,
    });
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
      detectDocker: noDocker,
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
      detectDocker: noDocker,
    });
    expect(config.sandbox.value).toBe("docker");
    expect(config.sandbox.source).toBe("cli");
  });

  it("full precedence chain: default < config < env < CLI", () => {
    const cwd = join(ctx.dir, "repo-sandbox-full");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { sandbox: "docker" });

    // Without env/CLI overrides: config wins
    const r1 = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: [],
      detectDocker: noDocker,
    });
    expect(r1.config.sandbox.value).toBe("docker");
    expect(r1.config.sandbox.source).toBe("config");

    // With env override: env wins
    const r2 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_SANDBOX: "none" }),
      cliArgs: [],
      detectDocker: noDocker,
    });
    expect(r2.config.sandbox.value).toBe("none");
    expect(r2.config.sandbox.source).toBe("env");

    // With CLI override: CLI wins
    const r3 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_SANDBOX: "none" }),
      cliArgs: ["--sandbox=docker"],
      detectDocker: noDocker,
    });
    expect(r3.config.sandbox.value).toBe("docker");
    expect(r3.config.sandbox.source).toBe("cli");
  });
});

// ---------------------------------------------------------------------------
// detectDockerAvailable — unit tests
// ---------------------------------------------------------------------------

describe("detectDockerAvailable", () => {
  it("returns true when docker info succeeds", () => {
    const result = detectDockerAvailable(() => true, "linux");
    expect(result).toBe(true);
  });

  it("returns false when docker info fails", () => {
    const result = detectDockerAvailable(() => false, "linux");
    expect(result).toBe(false);
  });

  it("returns false on Windows regardless of Docker", () => {
    const result = detectDockerAvailable(() => true, "win32");
    expect(result).toBe(false);
  });

  it("passes 'docker info' to the check function", () => {
    let capturedCmd = "";
    detectDockerAvailable((cmd) => {
      capturedCmd = cmd;
      return true;
    }, "linux");
    expect(capturedCmd).toBe("docker info");
  });
});

// ---------------------------------------------------------------------------
// resolveConfig — sandbox auto-detection
// ---------------------------------------------------------------------------

describe("resolveConfig — sandbox auto-detection", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  it("auto-detects 'docker' when Docker is available and sandbox unset", () => {
    const cwd = join(ctx.dir, "repo-autodetect-docker");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: [],
      detectDocker: () => true,
    });
    expect(config.sandbox.value).toBe("docker");
    expect(config.sandbox.source).toBe("auto-detected");
  });

  it("auto-detects 'none' when Docker is NOT available and sandbox unset", () => {
    const cwd = join(ctx.dir, "repo-autodetect-none");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: [],
      detectDocker: () => false,
    });
    expect(config.sandbox.value).toBe("none");
    expect(config.sandbox.source).toBe("auto-detected");
  });

  it("explicit config overrides auto-detection", () => {
    const cwd = join(ctx.dir, "repo-autodetect-override-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { sandbox: "none" });
    // Even though Docker is available, config file wins
    const { config } = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: [],
      detectDocker: () => true,
    });
    expect(config.sandbox.value).toBe("none");
    expect(config.sandbox.source).toBe("config");
  });

  it("explicit env var overrides auto-detection", () => {
    const cwd = join(ctx.dir, "repo-autodetect-override-env");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_SANDBOX: "none" }),
      cliArgs: [],
      detectDocker: () => true,
    });
    expect(config.sandbox.value).toBe("none");
    expect(config.sandbox.source).toBe("env");
  });

  it("explicit CLI flag overrides auto-detection", () => {
    const cwd = join(ctx.dir, "repo-autodetect-override-cli");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: ["--sandbox=none"],
      detectDocker: () => true,
    });
    expect(config.sandbox.value).toBe("none");
    expect(config.sandbox.source).toBe("cli");
  });
});
