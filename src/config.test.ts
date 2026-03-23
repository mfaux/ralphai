import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  validateEnum,
  validateBoolean,
  validatePositiveInt,
  validateNonNegInt,
  validateCommaList,
  parseConfigFile,
  applyEnvOverrides,
  parseCLIArgs,
  resolveConfig,
  getConfigFilePath,
  writeConfigFile,
  ConfigError,
  DEFAULTS,
} from "./config.ts";

// ---- Validation helpers ----

describe("validateEnum", () => {
  it("accepts a valid value", () => {
    expect(() =>
      validateEnum("branch", "mode", ["branch", "pr", "patch"]),
    ).not.toThrow();
  });

  it("rejects an invalid value with formatted message", () => {
    expect(() =>
      validateEnum("bad", "mode", ["branch", "pr", "patch"]),
    ).toThrow("ERROR: mode must be 'branch', 'pr', or 'patch', got 'bad'");
  });

  it("formats single-option enum", () => {
    expect(() => validateEnum("no", "flag", ["yes"])).toThrow(
      "ERROR: flag must be 'yes', got 'no'",
    );
  });

  it("formats two-option enum", () => {
    expect(() => validateEnum("maybe", "flag", ["yes", "no"])).toThrow(
      "ERROR: flag must be 'yes' or 'no', got 'maybe'",
    );
  });
});

describe("validateBoolean", () => {
  it("accepts true", () => {
    expect(() => validateBoolean("true", "flag")).not.toThrow();
  });

  it("accepts false", () => {
    expect(() => validateBoolean("false", "flag")).not.toThrow();
  });

  it("rejects non-boolean", () => {
    expect(() => validateBoolean("yes", "flag")).toThrow(
      "ERROR: flag must be 'true' or 'false', got 'yes'",
    );
  });
});

describe("validatePositiveInt", () => {
  it("accepts 1", () => {
    expect(() => validatePositiveInt("1", "count")).not.toThrow();
  });

  it("accepts multi-digit", () => {
    expect(() => validatePositiveInt("42", "count")).not.toThrow();
  });

  it("rejects 0", () => {
    expect(() => validatePositiveInt("0", "count")).toThrow(
      "ERROR: count must be a positive integer, got '0'",
    );
  });

  it("rejects negative", () => {
    expect(() => validatePositiveInt("-1", "count")).toThrow(
      "ERROR: count must be a positive integer, got '-1'",
    );
  });

  it("rejects non-numeric", () => {
    expect(() => validatePositiveInt("abc", "count")).toThrow(
      "ERROR: count must be a positive integer, got 'abc'",
    );
  });
});

describe("validateNonNegInt", () => {
  it("accepts 0", () => {
    expect(() => validateNonNegInt("0", "timeout")).not.toThrow();
  });

  it("accepts positive", () => {
    expect(() => validateNonNegInt("10", "timeout")).not.toThrow();
  });

  it("rejects negative", () => {
    expect(() => validateNonNegInt("-1", "timeout")).toThrow(
      "ERROR: timeout must be a non-negative integer, got '-1'",
    );
  });

  it("includes hint when provided", () => {
    expect(() => validateNonNegInt("-1", "timeout", "seconds")).toThrow(
      "ERROR: timeout must be a non-negative integer (seconds), got '-1'",
    );
  });
});

describe("validateCommaList", () => {
  it("accepts empty string", () => {
    expect(() => validateCommaList("", "cmds")).not.toThrow();
  });

  it("accepts single entry", () => {
    expect(() => validateCommaList("npm test", "cmds")).not.toThrow();
  });

  it("accepts multiple entries", () => {
    expect(() =>
      validateCommaList("npm test,npm run build", "cmds"),
    ).not.toThrow();
  });

  it("rejects empty entry (trailing comma)", () => {
    expect(() => validateCommaList("npm test,", "cmds")).toThrow(
      "ERROR: cmds contains an empty entry",
    );
  });

  it("rejects empty entry (leading comma)", () => {
    expect(() => validateCommaList(",npm test", "cmds")).toThrow(
      "ERROR: cmds contains an empty entry",
    );
  });
});

// ---- Config file parsing ----

describe("parseConfigFile", () => {
  const ctx = useTempDir();

  it("returns null for missing file", () => {
    const result = parseConfigFile(join(ctx.dir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("throws on invalid JSON", () => {
    const file = join(ctx.dir, "bad.json");
    writeFileSync(file, "not json");
    expect(() => parseConfigFile(file)).toThrow("invalid JSON");
  });

  it("throws on non-object JSON", () => {
    const file = join(ctx.dir, "array.json");
    writeFileSync(file, "[1,2,3]");
    expect(() => parseConfigFile(file)).toThrow(
      "expected a JSON object, got array",
    );
  });

  it("throws on null JSON", () => {
    const file = join(ctx.dir, "null.json");
    writeFileSync(file, "null");
    expect(() => parseConfigFile(file)).toThrow(
      "expected a JSON object, got null",
    );
  });

  it("parses empty object", () => {
    const file = join(ctx.dir, "empty.json");
    writeFileSync(file, "{}");
    const result = parseConfigFile(file)!;
    expect(result.values).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it("warns on unknown keys", () => {
    const file = join(ctx.dir, "unknown.json");
    writeFileSync(file, JSON.stringify({ unknownKey: "value" }));
    const result = parseConfigFile(file)!;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      "ignoring unknown config key 'unknownKey'",
    );
  });

  it("parses agentCommand", () => {
    const file = join(ctx.dir, "agent.json");
    writeFileSync(file, JSON.stringify({ agentCommand: "claude -p" }));
    const result = parseConfigFile(file)!;
    expect(result.values.agentCommand).toBe("claude -p");
  });

  it("rejects empty agentCommand", () => {
    const file = join(ctx.dir, "empty-agent.json");
    writeFileSync(file, JSON.stringify({ agentCommand: "" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'agentCommand' must be a non-empty string",
    );
  });

  it("parses feedbackCommands as array", () => {
    const file = join(ctx.dir, "fc-array.json");
    writeFileSync(
      file,
      JSON.stringify({ feedbackCommands: ["npm test", "npm run build"] }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.feedbackCommands).toBe("npm test,npm run build");
  });

  it("parses feedbackCommands as string", () => {
    const file = join(ctx.dir, "fc-string.json");
    writeFileSync(file, JSON.stringify({ feedbackCommands: "npm test" }));
    const result = parseConfigFile(file)!;
    expect(result.values.feedbackCommands).toBe("npm test");
  });

  it("rejects feedbackCommands array with empty entry", () => {
    const file = join(ctx.dir, "fc-bad.json");
    writeFileSync(file, JSON.stringify({ feedbackCommands: ["npm test", ""] }));
    expect(() => parseConfigFile(file)).toThrow(
      "'feedbackCommands' array contains an empty entry",
    );
  });

  it("parses baseBranch", () => {
    const file = join(ctx.dir, "branch.json");
    writeFileSync(file, JSON.stringify({ baseBranch: "develop" }));
    const result = parseConfigFile(file)!;
    expect(result.values.baseBranch).toBe("develop");
  });

  it("rejects baseBranch with spaces", () => {
    const file = join(ctx.dir, "branch-space.json");
    writeFileSync(file, JSON.stringify({ baseBranch: "my branch" }));
    expect(() => parseConfigFile(file)).toThrow(
      "must be a single token without spaces",
    );
  });

  it("parses maxStuck", () => {
    const file = join(ctx.dir, "stuck.json");
    writeFileSync(file, JSON.stringify({ maxStuck: 5 }));
    const result = parseConfigFile(file)!;
    expect(result.values.maxStuck).toBe(5);
  });

  it("rejects maxStuck of 0", () => {
    const file = join(ctx.dir, "stuck0.json");
    writeFileSync(file, JSON.stringify({ maxStuck: 0 }));
    expect(() => parseConfigFile(file)).toThrow(
      "'maxStuck' must be a positive integer",
    );
  });

  it("parses mode enum", () => {
    const file = join(ctx.dir, "mode.json");
    writeFileSync(file, JSON.stringify({ mode: "pr" }));
    const result = parseConfigFile(file)!;
    expect(result.values.mode).toBe("pr");
  });

  it("rejects invalid mode", () => {
    const file = join(ctx.dir, "bad-mode.json");
    writeFileSync(file, JSON.stringify({ mode: "invalid" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'mode' must be 'branch', 'pr', or 'patch'",
    );
  });

  it("parses boolean fields as booleans in JSON, stored as strings", () => {
    const file = join(ctx.dir, "bools.json");
    writeFileSync(
      file,
      JSON.stringify({
        continuous: true,
        autoCommit: true,
        issueCommentProgress: false,
      }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.continuous).toBe("true");
    expect(result.values.autoCommit).toBe("true");
    expect(result.values.issueCommentProgress).toBe("false");
  });

  it("rejects non-boolean for continuous", () => {
    const file = join(ctx.dir, "bad-cont.json");
    writeFileSync(file, JSON.stringify({ continuous: "yes" }));
    expect(() => parseConfigFile(file)).toThrow(
      "'continuous' must be 'true' or 'false'",
    );
  });

  it("parses turns", () => {
    const file = join(ctx.dir, "turns.json");
    writeFileSync(file, JSON.stringify({ turns: 10 }));
    const result = parseConfigFile(file)!;
    expect(result.values.turns).toBe(10);
  });

  it("accepts turns of 0 (unlimited)", () => {
    const file = join(ctx.dir, "turns0.json");
    writeFileSync(file, JSON.stringify({ turns: 0 }));
    const result = parseConfigFile(file)!;
    expect(result.values.turns).toBe(0);
  });

  it("rejects negative turns", () => {
    const file = join(ctx.dir, "neg-turns.json");
    writeFileSync(file, JSON.stringify({ turns: -1 }));
    expect(() => parseConfigFile(file)).toThrow(
      "'turns' must be a non-negative integer",
    );
  });

  it("parses workspaces", () => {
    const file = join(ctx.dir, "ws.json");
    writeFileSync(
      file,
      JSON.stringify({
        workspaces: {
          "packages/foo": { feedbackCommands: ["bun test"] },
        },
      }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.workspaces).toEqual({
      "packages/foo": { feedbackCommands: ["bun test"] },
    });
  });

  it("rejects non-object workspaces", () => {
    const file = join(ctx.dir, "ws-bad.json");
    writeFileSync(file, JSON.stringify({ workspaces: [] }));
    expect(() => parseConfigFile(file)).toThrow(
      "'workspaces' must be an object, got array",
    );
  });
});

// ---- Env var overrides ----

describe("applyEnvOverrides", () => {
  it("returns empty for no env vars", () => {
    const result = applyEnvOverrides({});
    expect(result).toEqual({});
  });

  it("ignores empty env var values", () => {
    const result = applyEnvOverrides({ RALPHAI_AGENT_COMMAND: "" });
    expect(result).toEqual({});
  });

  it("extracts agentCommand", () => {
    const result = applyEnvOverrides({ RALPHAI_AGENT_COMMAND: "claude -p" });
    expect(result.agentCommand).toBe("claude -p");
  });

  it("extracts baseBranch", () => {
    const result = applyEnvOverrides({ RALPHAI_BASE_BRANCH: "develop" });
    expect(result.baseBranch).toBe("develop");
  });

  it("rejects baseBranch with spaces", () => {
    expect(() =>
      applyEnvOverrides({ RALPHAI_BASE_BRANCH: "my branch" }),
    ).toThrow("must be a single token without spaces");
  });

  it("validates maxStuck as positive int", () => {
    expect(() => applyEnvOverrides({ RALPHAI_MAX_STUCK: "0" })).toThrow(
      "must be a positive integer",
    );
  });

  it("extracts maxStuck as number", () => {
    const result = applyEnvOverrides({ RALPHAI_MAX_STUCK: "5" });
    expect(result.maxStuck).toBe(5);
  });

  it("validates mode enum", () => {
    expect(() => applyEnvOverrides({ RALPHAI_MODE: "invalid" })).toThrow(
      "must be 'branch', 'pr', or 'patch'",
    );
  });

  it("validates boolean fields", () => {
    expect(() => applyEnvOverrides({ RALPHAI_CONTINUOUS: "yes" })).toThrow(
      "must be 'true' or 'false'",
    );
  });

  it("extracts turns as number", () => {
    const result = applyEnvOverrides({ RALPHAI_TURNS: "10" });
    expect(result.turns).toBe(10);
  });
});

// ---- CLI arg parsing ----

describe("parseCLIArgs", () => {
  it("returns empty for no args", () => {
    const result = parseCLIArgs([]);
    expect(result.overrides).toEqual({});
    expect(result.rawFlags).toEqual({});
  });

  it("parses --turns=N", () => {
    const result = parseCLIArgs(["--turns=10"]);
    expect(result.overrides.turns).toBe(10);
  });

  it("parses --turns=0 (unlimited)", () => {
    const result = parseCLIArgs(["--turns=0"]);
    expect(result.overrides.turns).toBe(0);
  });

  it("rejects non-numeric --turns", () => {
    expect(() => parseCLIArgs(["--turns=abc"])).toThrow(
      "must be a non-negative integer",
    );
  });

  it("parses --agent-command=value", () => {
    const result = parseCLIArgs(["--agent-command=claude -p"]);
    expect(result.overrides.agentCommand).toBe("claude -p");
  });

  it("rejects empty --agent-command", () => {
    expect(() => parseCLIArgs(["--agent-command="])).toThrow(
      "requires a non-empty value",
    );
  });

  it("parses --feedback-commands=value", () => {
    const result = parseCLIArgs(["--feedback-commands=npm test,npm run build"]);
    expect(result.overrides.feedbackCommands).toBe("npm test,npm run build");
  });

  it("parses empty --feedback-commands (disables)", () => {
    const result = parseCLIArgs(["--feedback-commands="]);
    expect(result.overrides.feedbackCommands).toBe("");
  });

  it("parses --base-branch=value", () => {
    const result = parseCLIArgs(["--base-branch=develop"]);
    expect(result.overrides.baseBranch).toBe("develop");
  });

  it("parses --branch", () => {
    const result = parseCLIArgs(["--branch"]);
    expect(result.overrides.mode).toBe("branch");
    expect(result.rawFlags.mode).toBe("--branch");
  });

  it("parses --pr", () => {
    const result = parseCLIArgs(["--pr"]);
    expect(result.overrides.mode).toBe("pr");
    expect(result.rawFlags.mode).toBe("--pr");
  });

  it("parses --patch", () => {
    const result = parseCLIArgs(["--patch"]);
    expect(result.overrides.mode).toBe("patch");
    expect(result.rawFlags.mode).toBe("--patch");
  });

  it("parses --continuous", () => {
    const result = parseCLIArgs(["--continuous"]);
    expect(result.overrides.continuous).toBe("true");
  });

  it("parses --auto-commit", () => {
    const result = parseCLIArgs(["--auto-commit"]);
    expect(result.overrides.autoCommit).toBe("true");
    expect(result.rawFlags.autoCommit).toBe("--auto-commit");
  });

  it("parses --no-auto-commit", () => {
    const result = parseCLIArgs(["--no-auto-commit"]);
    expect(result.overrides.autoCommit).toBe("false");
    expect(result.rawFlags.autoCommit).toBe("--no-auto-commit");
  });

  it("parses --issue-source=github", () => {
    const result = parseCLIArgs(["--issue-source=github"]);
    expect(result.overrides.issueSource).toBe("github");
  });

  it("ignores non-config flags", () => {
    const result = parseCLIArgs([
      "--dry-run",
      "--resume",
      "--allow-dirty",
      "--show-config",
      "--help",
    ]);
    expect(result.overrides).toEqual({});
  });

  it("parses multiple flags together", () => {
    const result = parseCLIArgs([
      "--turns=10",
      "--agent-command=claude -p",
      "--pr",
      "--continuous",
    ]);
    expect(result.overrides.turns).toBe(10);
    expect(result.overrides.agentCommand).toBe("claude -p");
    expect(result.overrides.mode).toBe("pr");
    expect(result.overrides.continuous).toBe("true");
  });
});

// ---- resolveConfig ----

describe("resolveConfig", () => {
  const ctx = useTempDir();

  /** Build envVars that route global state into the temp dir. */
  function env(
    extra?: Record<string, string>,
  ): Record<string, string | undefined> {
    return { RALPHAI_HOME: join(ctx.dir, "home"), ...extra };
  }

  /** Write a config file to the global state path for the given cwd. */
  function writeGlobalConfig(
    cwd: string,
    config: Record<string, unknown>,
  ): void {
    const filePath = getConfigFilePath(cwd, env());
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(config));
  }

  it("returns defaults when no config file, env, or CLI args", () => {
    const cwd = join(ctx.dir, "repo-defaults");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.baseBranch.value).toBe("main");
    expect(config.baseBranch.source).toBe("default");
    expect(config.mode.value).toBe("branch");
    expect(config.mode.source).toBe("default");
    expect(config.turns.value).toBe(5);
    expect(config.turns.source).toBe("default");
    expect(config.maxStuck.value).toBe(3);
    expect(config.maxStuck.source).toBe("default");
  });

  it("config file overrides defaults", () => {
    const cwd = join(ctx.dir, "repo-override");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { baseBranch: "develop", maxStuck: 5 });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.baseBranch.value).toBe("develop");
    expect(config.baseBranch.source).toBe("config");
    expect(config.maxStuck.value).toBe(5);
    expect(config.maxStuck.source).toBe("config");
    // Unset fields remain default
    expect(config.mode.value).toBe("branch");
    expect(config.mode.source).toBe("default");
  });

  it("env vars override config file", () => {
    const cwd = join(ctx.dir, "repo-env");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { baseBranch: "develop" });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_BASE_BRANCH: "staging" }),
      cliArgs: [],
    });
    expect(config.baseBranch.value).toBe("staging");
    expect(config.baseBranch.source).toBe("env");
  });

  it("CLI args override env vars", () => {
    const cwd = join(ctx.dir, "repo-cli");
    mkdirSync(cwd, { recursive: true });
    const { config } = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_BASE_BRANCH: "staging" }),
      cliArgs: ["--base-branch=production"],
    });
    expect(config.baseBranch.value).toBe("production");
    expect(config.baseBranch.source).toBe("cli");
  });

  it("full precedence chain: default < config < env < CLI", () => {
    const cwd = join(ctx.dir, "repo-full");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, {
      baseBranch: "from-config",
      mode: "pr",
      maxStuck: 7,
      turns: 20,
    });
    const { config } = resolveConfig({
      cwd,
      envVars: env({
        RALPHAI_BASE_BRANCH: "from-env",
        RALPHAI_MODE: "patch",
      }),
      cliArgs: ["--base-branch=from-cli"],
    });
    // baseBranch: CLI wins
    expect(config.baseBranch.value).toBe("from-cli");
    expect(config.baseBranch.source).toBe("cli");
    // mode: env wins (no CLI override)
    expect(config.mode.value).toBe("patch");
    expect(config.mode.source).toBe("env");
    // maxStuck: config wins (no env or CLI override)
    expect(config.maxStuck.value).toBe(7);
    expect(config.maxStuck.source).toBe("config");
    // turns: config wins (no env or CLI override)
    expect(config.turns.value).toBe(20);
    expect(config.turns.source).toBe("config");
    // continuous: default (nothing overrides)
    expect(config.continuous.value).toBe("false");
    expect(config.continuous.source).toBe("default");
  });

  it("propagates config file warnings", () => {
    const cwd = join(ctx.dir, "repo-warn");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { unknownField: true });
    const { warnings } = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: [],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ignoring unknown config key");
  });

  it("throws on config file validation error", () => {
    const cwd = join(ctx.dir, "repo-bad");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { mode: "invalid" });
    expect(() => resolveConfig({ cwd, envVars: env(), cliArgs: [] })).toThrow(
      "'mode' must be 'branch', 'pr', or 'patch'",
    );
  });

  it("throws on env var validation error", () => {
    const cwd = join(ctx.dir, "repo-env-bad");
    mkdirSync(cwd, { recursive: true });
    expect(() =>
      resolveConfig({
        cwd,
        envVars: env({ RALPHAI_MODE: "invalid" }),
        cliArgs: [],
      }),
    ).toThrow("must be 'branch', 'pr', or 'patch'");
  });

  it("throws on CLI arg validation error", () => {
    const cwd = join(ctx.dir, "repo-cli-bad");
    mkdirSync(cwd, { recursive: true });
    expect(() =>
      resolveConfig({ cwd, envVars: env(), cliArgs: ["--turns=abc"] }),
    ).toThrow("must be a non-negative integer");
  });

  it("returns the resolved config file path", () => {
    const cwd = join(ctx.dir, "repo-path");
    mkdirSync(cwd, { recursive: true });
    const { configFilePath } = resolveConfig({
      cwd,
      envVars: env(),
      cliArgs: [],
    });
    expect(configFilePath).toContain("config.json");
    expect(configFilePath).toContain(join("home", "repos"));
  });
});

// ---- writeConfigFile / getConfigFilePath ----

describe("writeConfigFile", () => {
  const ctx = useTempDir();

  it("writes config and reads it back", () => {
    const cwd = join(ctx.dir, "repo-write");
    mkdirSync(cwd, { recursive: true });
    const envVars = { RALPHAI_HOME: join(ctx.dir, "home") };
    const configData = { agentCommand: "claude -p", baseBranch: "main" };
    const filePath = writeConfigFile(cwd, configData, envVars);
    expect(filePath).toContain("config.json");

    const parsed = parseConfigFile(filePath);
    expect(parsed).not.toBeNull();
    expect(parsed!.values.agentCommand).toBe("claude -p");
    expect(parsed!.values.baseBranch).toBe("main");
  });

  it("getConfigFilePath returns path under RALPHAI_HOME", () => {
    const cwd = join(ctx.dir, "repo-path-test");
    mkdirSync(cwd, { recursive: true });
    const envVars = { RALPHAI_HOME: join(ctx.dir, "home") };
    const path = getConfigFilePath(cwd, envVars);
    expect(path).toContain(join(ctx.dir, "home", "repos"));
    expect(path).toMatch(/config\.json$/);
  });
});
