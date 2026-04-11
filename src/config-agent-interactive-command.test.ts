import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir, makeConfigTestHelpers } from "./test-utils.ts";
import {
  parseConfigFile,
  applyEnvOverrides,
  parseCLIArgs,
  resolveConfig,
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
      JSON.stringify({ agent: { interactiveCommand: "claude -i" } }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.agent!.interactiveCommand).toBe("claude -i");
  });

  it("accepts empty agentInteractiveCommand", () => {
    const file = join(ctx.dir, "interactive-empty.json");
    writeFileSync(file, JSON.stringify({ agent: { interactiveCommand: "" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.agent!.interactiveCommand).toBe("");
  });

  it("rejects non-string agentInteractiveCommand", () => {
    const file = join(ctx.dir, "interactive-num.json");
    writeFileSync(file, JSON.stringify({ agent: { interactiveCommand: 42 } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'agent.interactiveCommand' must be a string, got number",
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
    expect(result.agent!.interactiveCommand).toBe("claude -i");
  });

  it("ignores empty RALPHAI_AGENT_INTERACTIVE_COMMAND", () => {
    const result = applyEnvOverrides({
      RALPHAI_AGENT_INTERACTIVE_COMMAND: "",
    });
    expect(result.agent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// agentInteractiveCommand — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — agentInteractiveCommand", () => {
  it("has default empty string", () => {
    expect(DEFAULTS.agent.interactiveCommand).toBe("");
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
    expect(overrides.agent!.interactiveCommand).toBe("claude -i");
    expect(rawFlags["agent.interactiveCommand"]).toBe(
      "--agent-interactive-command=claude -i",
    );
  });

  it("accepts empty --agent-interactive-command=", () => {
    const { overrides } = parseCLIArgs(["--agent-interactive-command="]);
    expect(overrides.agent!.interactiveCommand).toBe("");
  });
});

// ---------------------------------------------------------------------------
// agentInteractiveCommand — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — agentInteractiveCommand precedence", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  it("returns default when no overrides", () => {
    const cwd = join(ctx.dir, "repo-interactive-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.agent.interactiveCommand.value).toBe("");
    expect(config.agent.interactiveCommand.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-interactive-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { agent: { interactiveCommand: "from-config" } });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.agent.interactiveCommand.value).toBe("from-config");
    expect(config.agent.interactiveCommand.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-interactive-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { agent: { interactiveCommand: "from-config" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_AGENT_INTERACTIVE_COMMAND: "from-env" }),
      cliArgs: [],
    });
    expect(config.agent.interactiveCommand.value).toBe("from-env");
    expect(config.agent.interactiveCommand.source).toBe("env");
  });

  it("CLI overrides env var", () => {
    const cwd = join(ctx.dir, "repo-interactive-cli");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { agent: { interactiveCommand: "from-config" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_AGENT_INTERACTIVE_COMMAND: "from-env" }),
      cliArgs: ["--agent-interactive-command=from-cli"],
    });
    expect(config.agent.interactiveCommand.value).toBe("from-cli");
    expect(config.agent.interactiveCommand.source).toBe("cli");
  });
});
