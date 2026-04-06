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
// agentInteractiveCommand — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — agentInteractiveCommand", () => {
  const ctx = useTempDir();

  it("parses agentInteractiveCommand from config", () => {
    const file = join(ctx.dir, "interactive.json");
    writeFileSync(
      file,
      JSON.stringify({ agentInteractiveCommand: "claude -i" }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.agentInteractiveCommand).toBe("claude -i");
  });

  it("accepts empty agentInteractiveCommand", () => {
    const file = join(ctx.dir, "interactive-empty.json");
    writeFileSync(file, JSON.stringify({ agentInteractiveCommand: "" }));
    const result = parseConfigFile(file)!;
    expect(result.values.agentInteractiveCommand).toBe("");
  });

  it("rejects non-string agentInteractiveCommand", () => {
    const file = join(ctx.dir, "interactive-num.json");
    writeFileSync(file, JSON.stringify({ agentInteractiveCommand: 42 }));
    expect(() => parseConfigFile(file)).toThrow(
      "'agentInteractiveCommand' must be a string, got number",
    );
  });
});

// ---------------------------------------------------------------------------
// agentInteractiveCommand — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — agentInteractiveCommand", () => {
  it("extracts RALPHAI_AGENT_INTERACTIVE_COMMAND", () => {
    const result = applyEnvOverrides({
      RALPHAI_AGENT_INTERACTIVE_COMMAND: "claude -i",
    });
    expect(result.agentInteractiveCommand).toBe("claude -i");
  });

  it("ignores empty RALPHAI_AGENT_INTERACTIVE_COMMAND", () => {
    const result = applyEnvOverrides({
      RALPHAI_AGENT_INTERACTIVE_COMMAND: "",
    });
    expect(result.agentInteractiveCommand).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// agentInteractiveCommand — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — agentInteractiveCommand", () => {
  it("has default empty string", () => {
    expect(DEFAULTS.agentInteractiveCommand).toBe("");
  });
});

// ---------------------------------------------------------------------------
// agentInteractiveCommand — CLI arg parsing
// ---------------------------------------------------------------------------

describe("parseCLIArgs — agentInteractiveCommand", () => {
  it("parses --agent-interactive-command=", () => {
    const { overrides, rawFlags } = parseCLIArgs([
      "--agent-interactive-command=claude -i",
    ]);
    expect(overrides.agentInteractiveCommand).toBe("claude -i");
    expect(rawFlags.agentInteractiveCommand).toBe(
      "--agent-interactive-command=claude -i",
    );
  });

  it("accepts empty --agent-interactive-command=", () => {
    const { overrides } = parseCLIArgs(["--agent-interactive-command="]);
    expect(overrides.agentInteractiveCommand).toBe("");
  });
});

// ---------------------------------------------------------------------------
// agentInteractiveCommand — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — agentInteractiveCommand precedence", () => {
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
    const cwd = join(ctx.dir, "repo-interactive-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.agentInteractiveCommand.value).toBe("");
    expect(config.agentInteractiveCommand.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-interactive-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { agentInteractiveCommand: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.agentInteractiveCommand.value).toBe("from-config");
    expect(config.agentInteractiveCommand.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-interactive-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { agentInteractiveCommand: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_AGENT_INTERACTIVE_COMMAND: "from-env" }),
      cliArgs: [],
    });
    expect(config.agentInteractiveCommand.value).toBe("from-env");
    expect(config.agentInteractiveCommand.source).toBe("env");
  });

  it("CLI overrides env var", () => {
    const cwd = join(ctx.dir, "repo-interactive-cli");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { agentInteractiveCommand: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_AGENT_INTERACTIVE_COMMAND: "from-env" }),
      cliArgs: ["--agent-interactive-command=from-cli"],
    });
    expect(config.agentInteractiveCommand.value).toBe("from-cli");
    expect(config.agentInteractiveCommand.source).toBe("cli");
  });
});
