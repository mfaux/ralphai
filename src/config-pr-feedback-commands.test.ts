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
// prFeedback (hooks.prFeedback) — default value
// ---------------------------------------------------------------------------

describe("DEFAULTS — hooks.prFeedback", () => {
  it('has default ""', () => {
    expect(DEFAULTS.hooks.prFeedback).toBe("");
  });
});

// ---------------------------------------------------------------------------
// prFeedback — config file parsing
// ---------------------------------------------------------------------------

describe("parseConfigFile — hooks.prFeedback", () => {
  const ctx = useTempDir();

  it("parses array format and joins to comma-separated string", () => {
    const file = join(ctx.dir, "arr.json");
    writeFileSync(
      file,
      JSON.stringify({ hooks: { prFeedback: ["cmd1", "cmd2"] } }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.hooks!.prFeedback).toBe("cmd1,cmd2");
  });

  it("parses string format as-is", () => {
    const file = join(ctx.dir, "str.json");
    writeFileSync(file, JSON.stringify({ hooks: { prFeedback: "cmd1,cmd2" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.hooks!.prFeedback).toBe("cmd1,cmd2");
  });

  it("missing key defaults to undefined (not in values)", () => {
    const file = join(ctx.dir, "empty.json");
    writeFileSync(file, JSON.stringify({ agent: { command: "claude -p" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.hooks).toBeUndefined();
  });

  it("rejects non-string/non-array type", () => {
    const file = join(ctx.dir, "bad-type.json");
    writeFileSync(file, JSON.stringify({ hooks: { prFeedback: 42 } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'hooks.prFeedback' must be an array of strings or a comma-separated string, got number",
    );
  });

  it("rejects array with empty entry", () => {
    const file = join(ctx.dir, "empty-entry.json");
    writeFileSync(
      file,
      JSON.stringify({ hooks: { prFeedback: ["cmd1", ""] } }),
    );
    expect(() => parseConfigFile(file)).toThrow(
      "'hooks.prFeedback' array contains an empty entry",
    );
  });

  it("rejects array with whitespace-only entry", () => {
    const file = join(ctx.dir, "ws-entry.json");
    writeFileSync(
      file,
      JSON.stringify({ hooks: { prFeedback: ["cmd1", "  "] } }),
    );
    expect(() => parseConfigFile(file)).toThrow(
      "'hooks.prFeedback' array contains an empty entry",
    );
  });

  it("unknown keys still trigger warnings", () => {
    const file = join(ctx.dir, "unknown-key.json");
    writeFileSync(
      file,
      JSON.stringify({ hooks: { prFeedback: "cmd1" }, bogusKey: true }),
    );
    const result = parseConfigFile(file)!;
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("bogusKey");
  });
});

// ---------------------------------------------------------------------------
// prFeedback — workspace overrides
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
// prFeedback — env var override
// ---------------------------------------------------------------------------

describe("applyEnvOverrides — hooks.prFeedback", () => {
  it("extracts RALPHAI_HOOKS_PR_FEEDBACK", () => {
    const result = applyEnvOverrides({
      RALPHAI_HOOKS_PR_FEEDBACK: "cmd1,cmd2",
    });
    expect(result.hooks!.prFeedback).toBe("cmd1,cmd2");
  });

  it("ignores empty RALPHAI_HOOKS_PR_FEEDBACK", () => {
    const result = applyEnvOverrides({
      RALPHAI_HOOKS_PR_FEEDBACK: "",
    });
    expect(result.hooks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prFeedback — CLI flag parsing
// ---------------------------------------------------------------------------

describe("parseCLIArgs — hooks.prFeedback", () => {
  it("parses --hooks-pr-feedback=value", () => {
    const result = parseCLIArgs(["--hooks-pr-feedback=cmd1,cmd2"]);
    expect(result.overrides.hooks!.prFeedback).toBe("cmd1,cmd2");
    expect(result.rawFlags["hooks.prFeedback"]).toBe(
      "--hooks-pr-feedback=cmd1,cmd2",
    );
  });

  it("allows empty --hooks-pr-feedback= to clear", () => {
    const result = parseCLIArgs(["--hooks-pr-feedback="]);
    expect(result.overrides.hooks!.prFeedback).toBe("");
  });

  it("rejects comma list with empty entry", () => {
    expect(() => parseCLIArgs(["--hooks-pr-feedback=cmd1,,cmd2"])).toThrow(
      "--hooks-pr-feedback contains an empty entry",
    );
  });

  it("rejects trailing comma", () => {
    expect(() => parseCLIArgs(["--hooks-pr-feedback=cmd1,"])).toThrow(
      "--hooks-pr-feedback contains an empty entry",
    );
  });
});

// ---------------------------------------------------------------------------
// prFeedback — resolveConfig precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — hooks.prFeedback precedence", () => {
  const ctx = useTempDir();
  const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);

  it('returns default "" when no overrides', () => {
    const cwd = join(ctx.dir, "repo-prfc-default");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.hooks.prFeedback.value).toBe("");
    expect(config.hooks.prFeedback.source).toBe("default");
  });

  it("config file overrides default", () => {
    const cwd = join(ctx.dir, "repo-prfc-config");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { hooks: { prFeedback: "from-config" } });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.hooks.prFeedback.value).toBe("from-config");
    expect(config.hooks.prFeedback.source).toBe("config");
  });

  it("env var overrides config file", () => {
    const cwd = join(ctx.dir, "repo-prfc-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { hooks: { prFeedback: "from-config" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_HOOKS_PR_FEEDBACK: "from-env" }),
      cliArgs: [],
    });
    expect(config.hooks.prFeedback.value).toBe("from-env");
    expect(config.hooks.prFeedback.source).toBe("env");
  });

  it("CLI flag overrides env var", () => {
    const cwd = join(ctx.dir, "repo-prfc-cli");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { hooks: { prFeedback: "from-config" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_HOOKS_PR_FEEDBACK: "from-env" }),
      cliArgs: ["--hooks-pr-feedback=from-cli"],
    });
    expect(config.hooks.prFeedback.value).toBe("from-cli");
    expect(config.hooks.prFeedback.source).toBe("cli");
  });

  it("empty CLI flag clears lower layers", () => {
    const cwd = join(ctx.dir, "repo-prfc-cli-empty");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { hooks: { prFeedback: "from-config" } });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_HOOKS_PR_FEEDBACK: "from-env" }),
      cliArgs: ["--hooks-pr-feedback="],
    });
    expect(config.hooks.prFeedback.value).toBe("");
    expect(config.hooks.prFeedback.source).toBe("cli");
  });

  it("existing config without hooks.prFeedback works", () => {
    const cwd = join(ctx.dir, "repo-prfc-absent");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { baseBranch: "develop" });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.hooks.prFeedback.value).toBe("");
    expect(config.hooks.prFeedback.source).toBe("default");
    // Verify other config is not affected
    expect(config.baseBranch.value).toBe("develop");
  });
});
