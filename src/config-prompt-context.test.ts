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

// ---- parseConfigFile: prompt.context ----

describe("parseConfigFile — prompt.context", () => {
  const ctx = useTempDir();

  it("parses prompt.context = true", () => {
    const file = join(ctx.dir, "ctx-true.json");
    writeFileSync(file, JSON.stringify({ prompt: { context: true } }));
    const result = parseConfigFile(file)!;
    expect(result.values.prompt?.context).toBe(true);
  });

  it("parses prompt.context = false", () => {
    const file = join(ctx.dir, "ctx-false.json");
    writeFileSync(file, JSON.stringify({ prompt: { context: false } }));
    const result = parseConfigFile(file)!;
    expect(result.values.prompt?.context).toBe(false);
  });

  it("rejects non-boolean prompt.context value", () => {
    const file = join(ctx.dir, "ctx-bad.json");
    writeFileSync(file, JSON.stringify({ prompt: { context: "yes" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'prompt.context' must be true or false",
    );
  });
});

// ---- applyEnvOverrides: RALPHAI_PROMPT_CONTEXT ----

describe("applyEnvOverrides — RALPHAI_PROMPT_CONTEXT", () => {
  it("parses RALPHAI_PROMPT_CONTEXT=false", () => {
    const result = applyEnvOverrides({ RALPHAI_PROMPT_CONTEXT: "false" });
    expect(result.prompt?.context).toBe(false);
  });

  it("parses RALPHAI_PROMPT_CONTEXT=true", () => {
    const result = applyEnvOverrides({ RALPHAI_PROMPT_CONTEXT: "true" });
    expect(result.prompt?.context).toBe(true);
  });

  it("validates RALPHAI_PROMPT_CONTEXT as boolean", () => {
    expect(() => applyEnvOverrides({ RALPHAI_PROMPT_CONTEXT: "yes" })).toThrow(
      "must be 'true' or 'false'",
    );
  });
});

// ---- parseCLIArgs: --prompt-context / --no-prompt-context ----

describe("parseCLIArgs — prompt.context flags", () => {
  it("parses --prompt-context", () => {
    const result = parseCLIArgs(["--prompt-context"]);
    expect(result.overrides.prompt?.context).toBe(true);
    expect(result.rawFlags["prompt.context"]).toBe("--prompt-context");
  });

  it("parses --no-prompt-context", () => {
    const result = parseCLIArgs(["--no-prompt-context"]);
    expect(result.overrides.prompt?.context).toBe(false);
    expect(result.rawFlags["prompt.context"]).toBe("--no-prompt-context");
  });
});

// ---- resolveConfig: prompt.context precedence ----

describe("resolveConfig — prompt.context", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  it("defaults to true", () => {
    const cwd = join(ctx.dir, "repo-ctx-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.prompt.context.value).toBe(true);
    expect(config.prompt.context.source).toBe("default");
  });

  it("prompt.context: full precedence chain (default < config < env < CLI)", () => {
    const cwd = join(ctx.dir, "repo-ctx-prec");
    mkdirSync(cwd, { recursive: true });

    // Default: true
    const r0 = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(r0.config.prompt.context.value).toBe(true);
    expect(r0.config.prompt.context.source).toBe("default");

    // Config file overrides default
    writeGlobalConfig(cwd, { prompt: { context: false } });
    const r1 = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(r1.config.prompt.context.value).toBe(false);
    expect(r1.config.prompt.context.source).toBe("config");

    // Env var overrides config
    const r2 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_PROMPT_CONTEXT: "true" }),
      cliArgs: [],
    });
    expect(r2.config.prompt.context.value).toBe(true);
    expect(r2.config.prompt.context.source).toBe("env");

    // CLI flag overrides env
    const r3 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_PROMPT_CONTEXT: "true" }),
      cliArgs: ["--no-prompt-context"],
    });
    expect(r3.config.prompt.context.value).toBe(false);
    expect(r3.config.prompt.context.source).toBe("cli");
  });
});
