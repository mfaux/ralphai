import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir, makeConfigTestHelpers } from "./test-utils.ts";
import {
  parseConfigFile,
  applyEnvOverrides,
  parseCLIArgs,
  resolveConfig,
} from "./config.ts";

// ---- parseConfigFile: docker.hostRuntime ----

describe("parseConfigFile — docker.hostRuntime", () => {
  const ctx = useTempDir();

  it("parses docker.hostRuntime = true", () => {
    const file = join(ctx.dir, "dhr-true.json");
    writeFileSync(file, JSON.stringify({ docker: { hostRuntime: true } }));
    const result = parseConfigFile(file)!;
    expect(result.values.docker?.hostRuntime).toBe(true);
  });

  it("parses docker.hostRuntime = false", () => {
    const file = join(ctx.dir, "dhr-false.json");
    writeFileSync(file, JSON.stringify({ docker: { hostRuntime: false } }));
    const result = parseConfigFile(file)!;
    expect(result.values.docker?.hostRuntime).toBe(false);
  });

  it("rejects non-boolean docker.hostRuntime value", () => {
    const file = join(ctx.dir, "dhr-bad.json");
    writeFileSync(file, JSON.stringify({ docker: { hostRuntime: "yes" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'docker.hostRuntime' must be true or false",
    );
  });
});

// ---- applyEnvOverrides: RALPHAI_DOCKER_HOST_RUNTIME ----

describe("applyEnvOverrides — RALPHAI_DOCKER_HOST_RUNTIME", () => {
  it("parses RALPHAI_DOCKER_HOST_RUNTIME=true", () => {
    const result = applyEnvOverrides({
      RALPHAI_DOCKER_HOST_RUNTIME: "true",
    });
    expect(result.docker?.hostRuntime).toBe(true);
  });

  it("parses RALPHAI_DOCKER_HOST_RUNTIME=false", () => {
    const result = applyEnvOverrides({
      RALPHAI_DOCKER_HOST_RUNTIME: "false",
    });
    expect(result.docker?.hostRuntime).toBe(false);
  });

  it("validates RALPHAI_DOCKER_HOST_RUNTIME as boolean", () => {
    expect(() =>
      applyEnvOverrides({ RALPHAI_DOCKER_HOST_RUNTIME: "yes" }),
    ).toThrow("must be 'true' or 'false'");
  });
});

// ---- parseCLIArgs: --docker-host-runtime / --no-docker-host-runtime ----

describe("parseCLIArgs — docker.hostRuntime flags", () => {
  it("parses --docker-host-runtime", () => {
    const result = parseCLIArgs(["--docker-host-runtime"]);
    expect(result.overrides.docker?.hostRuntime).toBe(true);
    expect(result.rawFlags["docker.hostRuntime"]).toBe("--docker-host-runtime");
  });

  it("parses --no-docker-host-runtime", () => {
    const result = parseCLIArgs(["--no-docker-host-runtime"]);
    expect(result.overrides.docker?.hostRuntime).toBe(false);
    expect(result.rawFlags["docker.hostRuntime"]).toBe(
      "--no-docker-host-runtime",
    );
  });
});

// ---- resolveConfig: docker.hostRuntime precedence ----

describe("resolveConfig — docker.hostRuntime", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  it("defaults to false", () => {
    const cwd = join(ctx.dir, "repo-dhr-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.docker.hostRuntime.value).toBe(false);
    expect(config.docker.hostRuntime.source).toBe("default");
  });

  it("docker.hostRuntime: full precedence chain (default < config < env < CLI)", () => {
    const cwd = join(ctx.dir, "repo-dhr-prec");
    mkdirSync(cwd, { recursive: true });

    // Default: false
    const r0 = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(r0.config.docker.hostRuntime.value).toBe(false);
    expect(r0.config.docker.hostRuntime.source).toBe("default");

    // Config file overrides default
    writeGlobalConfig(cwd, { docker: { hostRuntime: true } });
    const r1 = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(r1.config.docker.hostRuntime.value).toBe(true);
    expect(r1.config.docker.hostRuntime.source).toBe("config");

    // Env var overrides config
    const r2 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_DOCKER_HOST_RUNTIME: "false" }),
      cliArgs: [],
    });
    expect(r2.config.docker.hostRuntime.value).toBe(false);
    expect(r2.config.docker.hostRuntime.source).toBe("env");

    // CLI flag overrides env
    const r3 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_DOCKER_HOST_RUNTIME: "false" }),
      cliArgs: ["--docker-host-runtime"],
    });
    expect(r3.config.docker.hostRuntime.value).toBe(true);
    expect(r3.config.docker.hostRuntime.source).toBe("cli");
  });
});
