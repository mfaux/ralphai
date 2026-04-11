import { describe, it, expect } from "bun:test";
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

  it("parses agent.command", () => {
    const file = join(ctx.dir, "agent.json");
    writeFileSync(file, JSON.stringify({ agent: { command: "claude -p" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.agent?.command).toBe("claude -p");
  });

  it("rejects empty agent.command", () => {
    const file = join(ctx.dir, "empty-agent.json");
    writeFileSync(file, JSON.stringify({ agent: { command: "" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'agent.command' must be a non-empty string",
    );
  });

  it("parses agent.setupCommand", () => {
    const file = join(ctx.dir, "setup.json");
    writeFileSync(
      file,
      JSON.stringify({ agent: { setupCommand: "bun install" } }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.agent?.setupCommand).toBe("bun install");
  });

  it("allows empty agent.setupCommand (disabled)", () => {
    const file = join(ctx.dir, "setup-empty.json");
    writeFileSync(file, JSON.stringify({ agent: { setupCommand: "" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.agent?.setupCommand).toBe("");
  });

  it("rejects non-string agent.setupCommand", () => {
    const file = join(ctx.dir, "setup-bad.json");
    writeFileSync(file, JSON.stringify({ agent: { setupCommand: 42 } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'agent.setupCommand' must be a string",
    );
  });

  it("parses hooks.feedback as array", () => {
    const file = join(ctx.dir, "fc-array.json");
    writeFileSync(
      file,
      JSON.stringify({ hooks: { feedback: ["npm test", "npm run build"] } }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.hooks?.feedback).toBe("npm test,npm run build");
  });

  it("parses hooks.feedback as string", () => {
    const file = join(ctx.dir, "fc-string.json");
    writeFileSync(file, JSON.stringify({ hooks: { feedback: "npm test" } }));
    const result = parseConfigFile(file)!;
    expect(result.values.hooks?.feedback).toBe("npm test");
  });

  it("rejects hooks.feedback array with empty entry", () => {
    const file = join(ctx.dir, "fc-bad.json");
    writeFileSync(
      file,
      JSON.stringify({ hooks: { feedback: ["npm test", ""] } }),
    );
    expect(() => parseConfigFile(file)).toThrow(
      "'hooks.feedback' array contains an empty entry",
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

  it("parses gate.maxStuck", () => {
    const file = join(ctx.dir, "stuck.json");
    writeFileSync(file, JSON.stringify({ gate: { maxStuck: 5 } }));
    const result = parseConfigFile(file)!;
    expect(result.values.gate?.maxStuck).toBe(5);
  });

  it("rejects gate.maxStuck of 0", () => {
    const file = join(ctx.dir, "stuck0.json");
    writeFileSync(file, JSON.stringify({ gate: { maxStuck: 0 } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'gate.maxStuck' must be a positive integer",
    );
  });

  it("parses boolean fields as native booleans", () => {
    const file = join(ctx.dir, "bools.json");
    writeFileSync(
      file,
      JSON.stringify({
        issue: { commentProgress: false },
      }),
    );
    const result = parseConfigFile(file)!;
    expect(result.values.issue?.commentProgress).toBe(false);
  });

  it("parses gate.review boolean field", () => {
    const file = join(ctx.dir, "review-true.json");
    writeFileSync(file, JSON.stringify({ gate: { review: true } }));
    const result = parseConfigFile(file)!;
    expect(result.values.gate?.review).toBe(true);

    const file2 = join(ctx.dir, "review-false.json");
    writeFileSync(file2, JSON.stringify({ gate: { review: false } }));
    const result2 = parseConfigFile(file2)!;
    expect(result2.values.gate?.review).toBe(false);
  });

  it("rejects non-boolean gate.review value", () => {
    const file = join(ctx.dir, "review-bad.json");
    writeFileSync(file, JSON.stringify({ gate: { review: "yes" } }));
    expect(() => parseConfigFile(file)).toThrow(
      "'gate.review' must be true or false",
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

  it("extracts agent.command", () => {
    const result = applyEnvOverrides({ RALPHAI_AGENT_COMMAND: "claude -p" });
    expect(result.agent?.command).toBe("claude -p");
  });

  it("extracts agent.setupCommand", () => {
    const result = applyEnvOverrides({
      RALPHAI_AGENT_SETUP_COMMAND: "npm install",
    });
    expect(result.agent?.setupCommand).toBe("npm install");
  });

  it("extracts empty agent.setupCommand (disables)", () => {
    // Empty env vars are ignored by the generic guard, but an explicit
    // non-empty value should come through. This test documents that
    // RALPHAI_AGENT_SETUP_COMMAND="" is treated as "not set" (same as other keys).
    const result = applyEnvOverrides({ RALPHAI_AGENT_SETUP_COMMAND: "" });
    expect(result.agent).toBeUndefined();
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

  it("validates gate.maxStuck as positive int", () => {
    expect(() => applyEnvOverrides({ RALPHAI_GATE_MAX_STUCK: "0" })).toThrow(
      "must be a positive integer",
    );
  });

  it("extracts gate.maxStuck as number", () => {
    const result = applyEnvOverrides({ RALPHAI_GATE_MAX_STUCK: "5" });
    expect(result.gate?.maxStuck).toBe(5);
  });

  it("extracts gate.review from RALPHAI_GATE_REVIEW", () => {
    const result = applyEnvOverrides({ RALPHAI_GATE_REVIEW: "false" });
    expect(result.gate?.review).toBe(false);
  });

  it("validates gate.review env var as boolean", () => {
    expect(() => applyEnvOverrides({ RALPHAI_GATE_REVIEW: "yes" })).toThrow(
      "must be 'true' or 'false'",
    );
  });

  it("parses RALPHAI_PR_DRAFT=false", () => {
    const result = applyEnvOverrides({ RALPHAI_PR_DRAFT: "false" });
    expect(result.pr?.draft).toBe(false);
  });

  it("parses RALPHAI_PR_DRAFT=true", () => {
    const result = applyEnvOverrides({ RALPHAI_PR_DRAFT: "true" });
    expect(result.pr?.draft).toBe(true);
  });

  it("validates RALPHAI_PR_DRAFT as boolean", () => {
    expect(() => applyEnvOverrides({ RALPHAI_PR_DRAFT: "yes" })).toThrow(
      "must be 'true' or 'false'",
    );
  });

  it("parses RALPHAI_GIT_BRANCH_PREFIX", () => {
    const result = applyEnvOverrides({
      RALPHAI_GIT_BRANCH_PREFIX: "ralphai/",
    });
    expect(result.git?.branchPrefix).toBe("ralphai/");
  });
});

// ---- CLI arg parsing ----

describe("parseCLIArgs", () => {
  it("returns empty for no args", () => {
    const result = parseCLIArgs([]);
    expect(result.overrides).toEqual({});
    expect(result.rawFlags).toEqual({});
  });

  it("parses --agent-command=value", () => {
    const result = parseCLIArgs(["--agent-command=claude -p"]);
    expect(result.overrides.agent?.command).toBe("claude -p");
  });

  it("rejects empty --agent-command", () => {
    expect(() => parseCLIArgs(["--agent-command="])).toThrow(
      "requires a non-empty value",
    );
  });

  it("parses --agent-setup-command=value", () => {
    const result = parseCLIArgs(["--agent-setup-command=bun install"]);
    expect(result.overrides.agent?.setupCommand).toBe("bun install");
    expect(result.rawFlags["agent.setupCommand"]).toBe(
      "--agent-setup-command=bun install",
    );
  });

  it("parses empty --agent-setup-command= (disables)", () => {
    const result = parseCLIArgs(["--agent-setup-command="]);
    expect(result.overrides.agent?.setupCommand).toBe("");
  });

  it("parses --hooks-feedback=value", () => {
    const result = parseCLIArgs(["--hooks-feedback=npm test,npm run build"]);
    expect(result.overrides.hooks?.feedback).toBe("npm test,npm run build");
  });

  it("parses empty --hooks-feedback (disables)", () => {
    const result = parseCLIArgs(["--hooks-feedback="]);
    expect(result.overrides.hooks?.feedback).toBe("");
  });

  it("parses --base-branch=value", () => {
    const result = parseCLIArgs(["--base-branch=develop"]);
    expect(result.overrides.baseBranch).toBe("develop");
  });

  it("parses --gate-review", () => {
    const result = parseCLIArgs(["--gate-review"]);
    expect(result.overrides.gate?.review).toBe(true);
    expect(result.rawFlags["gate.review"]).toBe("--gate-review");
  });

  it("parses --gate-no-review", () => {
    const result = parseCLIArgs(["--gate-no-review"]);
    expect(result.overrides.gate?.review).toBe(false);
    expect(result.rawFlags["gate.review"]).toBe("--gate-no-review");
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
    const result = parseCLIArgs(["--agent-command=claude -p", "--gate-review"]);
    expect(result.overrides.agent?.command).toBe("claude -p");
    expect(result.overrides.gate?.review).toBe(true);
  });

  it("parses --pr-draft", () => {
    const result = parseCLIArgs(["--pr-draft"]);
    expect(result.overrides.pr?.draft).toBe(true);
    expect(result.rawFlags["pr.draft"]).toBe("--pr-draft");
  });

  it("parses --no-pr-draft", () => {
    const result = parseCLIArgs(["--no-pr-draft"]);
    expect(result.overrides.pr?.draft).toBe(false);
    expect(result.rawFlags["pr.draft"]).toBe("--no-pr-draft");
  });

  it("parses --git-branch-prefix=value", () => {
    const result = parseCLIArgs(["--git-branch-prefix=ralphai/"]);
    expect(result.overrides.git?.branchPrefix).toBe("ralphai/");
    expect(result.rawFlags["git.branchPrefix"]).toBe(
      "--git-branch-prefix=ralphai/",
    );
  });

  it("parses empty --git-branch-prefix= (reset to default)", () => {
    const result = parseCLIArgs(["--git-branch-prefix="]);
    expect(result.overrides.git?.branchPrefix).toBe("");
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
    expect(config.gate.maxStuck.value).toBe(3);
    expect(config.gate.maxStuck.source).toBe("default");
    expect(config.agent.setupCommand.value).toBe("");
    expect(config.agent.setupCommand.source).toBe("default");
    expect(config.gate.review.value).toBe(true);
    expect(config.gate.review.source).toBe("default");
  });

  it("config file overrides defaults", () => {
    const cwd = join(ctx.dir, "repo-override");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, {
      baseBranch: "develop",
      gate: { maxStuck: 5 },
    });
    const { config } = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(config.baseBranch.value).toBe("develop");
    expect(config.baseBranch.source).toBe("config");
    expect(config.gate.maxStuck.value).toBe(5);
    expect(config.gate.maxStuck.source).toBe("config");
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
      gate: { maxStuck: 7 },
    });
    const { config } = resolveConfig({
      cwd,
      envVars: env({
        RALPHAI_BASE_BRANCH: "from-env",
      }),
      cliArgs: ["--base-branch=from-cli"],
    });
    // baseBranch: CLI wins
    expect(config.baseBranch.value).toBe("from-cli");
    expect(config.baseBranch.source).toBe("cli");
    // gate.maxStuck: config wins (no env or CLI override)
    expect(config.gate.maxStuck.value).toBe(7);
    expect(config.gate.maxStuck.source).toBe("config");
  });

  it("agent.setupCommand: full precedence chain", () => {
    const cwd = join(ctx.dir, "repo-setup-prec");
    mkdirSync(cwd, { recursive: true });
    writeGlobalConfig(cwd, { agent: { setupCommand: "npm install" } });

    // Config file wins over default
    const r1 = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(r1.config.agent.setupCommand.value).toBe("npm install");
    expect(r1.config.agent.setupCommand.source).toBe("config");

    // Env wins over config
    const r2 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_AGENT_SETUP_COMMAND: "pnpm install" }),
      cliArgs: [],
    });
    expect(r2.config.agent.setupCommand.value).toBe("pnpm install");
    expect(r2.config.agent.setupCommand.source).toBe("env");

    // CLI wins over env
    const r3 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_AGENT_SETUP_COMMAND: "pnpm install" }),
      cliArgs: ["--agent-setup-command=bun install"],
    });
    expect(r3.config.agent.setupCommand.value).toBe("bun install");
    expect(r3.config.agent.setupCommand.source).toBe("cli");
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
    writeGlobalConfig(cwd, { gate: { maxStuck: 0 } });
    expect(() => resolveConfig({ cwd, envVars: env(), cliArgs: [] })).toThrow(
      "'gate.maxStuck' must be a positive integer",
    );
  });

  it("throws on env var validation error", () => {
    const cwd = join(ctx.dir, "repo-env-bad");
    mkdirSync(cwd, { recursive: true });
    expect(() =>
      resolveConfig({
        cwd,
        envVars: env({ RALPHAI_GATE_MAX_STUCK: "0" }),
        cliArgs: [],
      }),
    ).toThrow("must be a positive integer");
  });

  it("throws on CLI arg validation error", () => {
    const cwd = join(ctx.dir, "repo-cli-bad");
    mkdirSync(cwd, { recursive: true });
    expect(() =>
      resolveConfig({
        cwd,
        envVars: env(),
        cliArgs: ["--gate-max-stuck=abc"],
      }),
    ).toThrow("must be a positive integer");
  });

  it("gate.review: full precedence chain (default < config < env < CLI)", () => {
    const cwd = join(ctx.dir, "repo-review-prec");
    mkdirSync(cwd, { recursive: true });

    // Default: true
    const r0 = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(r0.config.gate.review.value).toBe(true);
    expect(r0.config.gate.review.source).toBe("default");

    // Config file overrides default
    writeGlobalConfig(cwd, { gate: { review: false } });
    const r1 = resolveConfig({ cwd, envVars: env(), cliArgs: [] });
    expect(r1.config.gate.review.value).toBe(false);
    expect(r1.config.gate.review.source).toBe("config");

    // Env var overrides config
    const r2 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_GATE_REVIEW: "true" }),
      cliArgs: [],
    });
    expect(r2.config.gate.review.value).toBe(true);
    expect(r2.config.gate.review.source).toBe("env");

    // CLI flag overrides env
    const r3 = resolveConfig({
      cwd,
      envVars: env({ RALPHAI_GATE_REVIEW: "true" }),
      cliArgs: ["--gate-no-review"],
    });
    expect(r3.config.gate.review.value).toBe(false);
    expect(r3.config.gate.review.source).toBe("cli");
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
    const configData = {
      agent: { command: "claude -p" },
      baseBranch: "main",
    };
    const filePath = writeConfigFile(cwd, configData, envVars);
    expect(filePath).toContain("config.json");

    const parsed = parseConfigFile(filePath);
    expect(parsed).not.toBeNull();
    expect(parsed!.values.agent?.command).toBe("claude -p");
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
