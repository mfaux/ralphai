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
// prFeedbackCommands — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — prFeedbackCommands", () => {
  it('has default ""', () => {
    expect(DEFAULTS.prFeedbackCommands).toBe("");
  });
});

// ---------------------------------------------------------------------------
// prFeedbackCommands — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — prFeedbackCommands", () => {
  const ctx = useTempDir();

  it("parses array format and joins to comma-separated string", () => {
    const file = join(ctx.dir, "arr.json");
    writeFileSync(
      file,
      JSON.stringify({ prFeedbackCommands: ["cmd1", "cmd2"] }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.prFeedbackCommands).toBe("cmd1,cmd2");
  });

  it("parses string format as-is", () => {
    const file = join(ctx.dir, "str.json");
    writeFileSync(file, JSON.stringify({ prFeedbackCommands: "cmd1,cmd2" }));
    const result = parseConfigFile(file)!;
    expect(result.values.prFeedbackCommands).toBe("cmd1,cmd2");
  });

  it("missing key defaults to undefined (not in values)", () => {
    const file = join(ctx.dir, "empty.json");
    writeFileSync(file, JSON.stringify({ agentCommand: "claude -p" }));
    const result = parseConfigFile(file)!;
    expect(result.values.prFeedbackCommands).toBeUndefined();
  });

  it("rejects non-string/non-array type", () => {
    const file = join(ctx.dir, "bad-type.json");
    writeFileSync(file, JSON.stringify({ prFeedbackCommands: 42 }));
    expect(() => parseConfigFile(file)).toThrow(
      "'prFeedbackCommands' must be an array of strings or a comma-separated string, got number",
    );
  });

  it("rejects array with empty entry", () => {
    const file = join(ctx.dir, "empty-entry.json");
    writeFileSync(file, JSON.stringify({ prFeedbackCommands: ["cmd1", ""] }));
    expect(() => parseConfigFile(file)).toThrow(
      "'prFeedbackCommands' array contains an empty entry",
    );
  });

  it("rejects array with whitespace-only entry", () => {
    const file = join(ctx.dir, "ws-entry.json");
    writeFileSync(file, JSON.stringify({ prFeedbackCommands: ["cmd1", "  "] }));
    expect(() => parseConfigFile(file)).toThrow(
      "'prFeedbackCommands' array contains an empty entry",
    );
  });

  it("unknown keys still trigger warnings", () => {
    const file = join(ctx.dir, "unknown-key.json");
    writeFileSync(
      file,
      JSON.stringify({ prFeedbackCommands: "cmd1", bogusKey: true }),
    );
    const result = parseConfigFile(file)!;
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("bogusKey");
  });
});

// ---------------------------------------------------------------------------
// prFeedbackCommands — workspace overrides
// ---------------------------------------------------------------------------

describe("parseConfigFile — workspace prFeedbackCommands", () => {
  const ctx = useTempDir();

  it("accepts prFeedbackCommands in workspace entry (array)", () => {
    const file = join(ctx.dir, "ws-arr.json");
    writeFileSync(
      file,
      JSON.stringify({
        workspaces: {
          "packages/foo": { prFeedbackCommands: ["cmd1", "cmd2"] },
        },
      }),
    );
    const result = parseConfigFile(file)!;
    expect(
      result.values.workspaces!["packages/foo"]!.prFeedbackCommands,
    ).toEqual(["cmd1", "cmd2"]);
  });

  it("accepts prFeedbackCommands in workspace entry (string)", () => {
    const file = join(ctx.dir, "ws-str.json");
    writeFileSync(
      file,
      JSON.stringify({
        workspaces: {
          "packages/bar": { prFeedbackCommands: "cmd1,cmd2" },
        },
      }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.workspaces!["packages/bar"]!.prFeedbackCommands).toBe(
      "cmd1,cmd2",
    );
  });

  it("rejects non-string/non-array prFeedbackCommands in workspace", () => {
    const file = join(ctx.dir, "ws-bad.json");
    writeFileSync(
      file,
      JSON.stringify({
        workspaces: {
          "packages/baz": { prFeedbackCommands: 42 },
        },
      }),
    );
    expect(() => parseConfigFile(file)).toThrow(
      "workspaces['packages/baz'].prFeedbackCommands must be an array of strings or a comma-separated string, got number",
    );
  });
});

// ---------------------------------------------------------------------------
// prFeedbackCommands — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — prFeedbackCommands", () => {
  it("extracts RALPHAI_PR_FEEDBACK_COMMANDS", () => {
    const result = applyEnvOverrides({
      RALPHAI_PR_FEEDBACK_COMMANDS: "cmd1,cmd2",
    });
    expect(result.prFeedbackCommands).toBe("cmd1,cmd2");
  });

  it("ignores empty RALPHAI_PR_FEEDBACK_COMMANDS", () => {
    const result = applyEnvOverrides({
      RALPHAI_PR_FEEDBACK_COMMANDS: "",
    });
    expect(result.prFeedbackCommands).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prFeedbackCommands — CLI flag parsing
// ---------------------------------------------------------------------------

describe("parseCLIArgs — prFeedbackCommands", () => {
  it("parses --pr-feedback-commands=value", () => {
    const result = parseCLIArgs(["--pr-feedback-commands=cmd1,cmd2"]);
    expect(result.overrides.prFeedbackCommands).toBe("cmd1,cmd2");
    expect(result.rawFlags.prFeedbackCommands).toBe(
      "--pr-feedback-commands=cmd1,cmd2",
    );
  });

  it("allows empty --pr-feedback-commands= to clear", () => {
    const result = parseCLIArgs(["--pr-feedback-commands="]);
    expect(result.overrides.prFeedbackCommands).toBe("");
  });

  it("rejects comma list with empty entry", () => {
    expect(() => parseCLIArgs(["--pr-feedback-commands=cmd1,,cmd2"])).toThrow(
      "--pr-feedback-commands contains an empty entry",
    );
  });

  it("rejects trailing comma", () => {
    expect(() => parseCLIArgs(["--pr-feedback-commands=cmd1,"])).toThrow(
      "--pr-feedback-commands contains an empty entry",
    );
  });
});

// ---------------------------------------------------------------------------
// prFeedbackCommands — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — prFeedbackCommands precedence", () => {
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

  it('returns default "" when no overrides', () => {
    const cwd = join(ctx.dir, "repo-prfc-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.prFeedbackCommands.value).toBe("");
    expect(config.prFeedbackCommands.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-prfc-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { prFeedbackCommands: "from-config" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.prFeedbackCommands.value).toBe("from-config");
    expect(config.prFeedbackCommands.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-prfc-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { prFeedbackCommands: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_PR_FEEDBACK_COMMANDS: "from-env" }),
      cliArgs: [],
    });
    expect(config.prFeedbackCommands.value).toBe("from-env");
    expect(config.prFeedbackCommands.source).toBe("env");
  });

  it("CLI flag overrides env var", () => {
    const cwd = join(ctx.dir, "repo-prfc-cli");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { prFeedbackCommands: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_PR_FEEDBACK_COMMANDS: "from-env" }),
      cliArgs: ["--pr-feedback-commands=from-cli"],
    });
    expect(config.prFeedbackCommands.value).toBe("from-cli");
    expect(config.prFeedbackCommands.source).toBe("cli");
  });

  it("empty CLI flag clears lower layers", () => {
    const cwd = join(ctx.dir, "repo-prfc-cli-empty");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { prFeedbackCommands: "from-config" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_PR_FEEDBACK_COMMANDS: "from-env" }),
      cliArgs: ["--pr-feedback-commands="],
    });
    expect(config.prFeedbackCommands.value).toBe("");
    expect(config.prFeedbackCommands.source).toBe("cli");
  });

  it("existing config without prFeedbackCommands works", () => {
    const cwd = join(ctx.dir, "repo-prfc-absent");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { baseBranch: "develop" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.prFeedbackCommands.value).toBe("");
    expect(config.prFeedbackCommands.source).toBe("default");
    // Verify other config is not affected
    expect(config.baseBranch.value).toBe("develop");
  });
});
