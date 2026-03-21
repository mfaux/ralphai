/**
 * Config module — TypeScript port of config loading and validation.
 *
 * Ported from:
 *   runner/lib/defaults.sh  — default values
 *   runner/lib/validate.sh  — validation helpers
 *   runner/lib/config.sh    — config file loading, env overrides
 *   runner/lib/cli.sh       — CLI arg parsing (config-related portion)
 *
 * Provides a single resolveConfig() entry point that composes:
 *   defaults -> config file -> env vars -> CLI args
 * with source tracking for --show-config.
 */

import { readFileSync, existsSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All recognised config keys. */
export interface RalphaiConfig {
  agentCommand: string;
  feedbackCommands: string;
  baseBranch: string;
  maxStuck: number;
  mode: "branch" | "pr" | "patch";
  issueSource: "none" | "github";
  issueLabel: string;
  issueInProgressLabel: string;
  issueRepo: string;
  issueCommentProgress: string; // "true" | "false" — kept as string to match shell
  turnTimeout: number;
  promptMode: "auto" | "at-path" | "inline";
  continuous: string; // "true" | "false"
  autoCommit: string; // "true" | "false"
  turns: number;
  maxLearnings: number;
  workspaces: Record<string, WorkspaceOverrides> | null;
}

export interface WorkspaceOverrides {
  feedbackCommands?: string[] | string;
  [key: string]: unknown;
}

/** Where a resolved value came from. */
export type ConfigSource = "default" | "config" | "env" | "cli";

/** A resolved value paired with its source. */
export interface ResolvedValue<T> {
  value: T;
  source: ConfigSource;
}

/** Fully resolved config with source tracking. */
export type ResolvedConfig = {
  [K in keyof RalphaiConfig]: ResolvedValue<RalphaiConfig[K]>;
};

// ---------------------------------------------------------------------------
// Defaults (matches defaults.sh lines 4-19)
// ---------------------------------------------------------------------------

export const DEFAULTS: Readonly<RalphaiConfig> = {
  agentCommand: "",
  feedbackCommands: "",
  baseBranch: "main",
  maxStuck: 3,
  mode: "branch",
  issueSource: "none",
  issueLabel: "ralphai",
  issueInProgressLabel: "ralphai:in-progress",
  issueRepo: "",
  issueCommentProgress: "true",
  turnTimeout: 0,
  promptMode: "auto",
  continuous: "false",
  autoCommit: "false",
  turns: 5, // default turns budget (overridden by config/env/cli)
  maxLearnings: 20,
  workspaces: null,
};

// ---------------------------------------------------------------------------
// Validation helpers (ported from validate.sh)
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Validate that `value` is one of the `allowed` values.
 * Error format matches validate.sh: "ERROR: <label> must be 'a', 'b', or 'c', got '<value>'"
 */
export function validateEnum(
  value: string,
  label: string,
  allowed: readonly string[],
): void {
  if (allowed.includes(value)) return;
  let msg: string;
  if (allowed.length === 1) {
    msg = `'${allowed[0]}'`;
  } else if (allowed.length === 2) {
    msg = `'${allowed[0]}' or '${allowed[1]}'`;
  } else {
    msg = allowed
      .map((a, i) => (i === allowed.length - 1 ? `or '${a}'` : `'${a}', `))
      .join("");
  }
  throw new ConfigError(`ERROR: ${label} must be ${msg}, got '${value}'`);
}

/**
 * Validate that `value` is "true" or "false".
 * Matches validate.sh's validate_boolean().
 */
export function validateBoolean(value: string, label: string): void {
  validateEnum(value, label, ["true", "false"]);
}

/**
 * Validate that `value` is a positive integer (>= 1).
 * Matches validate.sh's validate_positive_int().
 */
export function validatePositiveInt(value: string, label: string): void {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new ConfigError(
      `ERROR: ${label} must be a positive integer, got '${value}'`,
    );
  }
}

/**
 * Validate that `value` is a non-negative integer (>= 0).
 * Matches validate.sh's validate_nonneg_int().
 */
export function validateNonNegInt(
  value: string,
  label: string,
  hint?: string,
): void {
  if (!/^[0-9]+$/.test(value)) {
    const hintPart = hint ? ` (${hint})` : "";
    throw new ConfigError(
      `ERROR: ${label} must be a non-negative integer${hintPart}, got '${value}'`,
    );
  }
}

/**
 * Validate a comma-separated list has no empty entries.
 * Matches validate.sh's validate_comma_list().
 */
export function validateCommaList(value: string, label: string): void {
  if (value === "") return;
  const parts = value.split(",");
  for (const part of parts) {
    if (part.trim() === "") {
      throw new ConfigError(`ERROR: ${label} contains an empty entry`);
    }
  }
}

// ---------------------------------------------------------------------------
// Config file parsing (ported from config.sh load_config node -e block)
// ---------------------------------------------------------------------------

/** Allowed keys in ralphai.json (matches config.sh line 43). */
const ALLOWED_CONFIG_KEYS = new Set([
  "agentCommand",
  "feedbackCommands",
  "baseBranch",
  "maxStuck",
  "mode",
  "issueSource",
  "issueLabel",
  "issueInProgressLabel",
  "issueRepo",
  "issueCommentProgress",
  "turnTimeout",
  "promptMode",
  "continuous",
  "autoCommit",
  "turns",
  "maxLearnings",
  "workspaces",
]);

export interface ParsedConfigFile {
  /** Values extracted from the config file. */
  values: Partial<RalphaiConfig>;
  /** Warning messages (e.g. unknown keys). */
  warnings: string[];
}

/**
 * Parse and validate a ralphai.json config file.
 * Returns the parsed values and any warnings.
 * Throws ConfigError for invalid values.
 * Returns null if the file does not exist.
 */
export function parseConfigFile(filePath: string): ParsedConfigFile | null {
  if (!existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`${filePath}: cannot read file: ${msg}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${filePath}: invalid JSON`);
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    const t =
      data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
    throw new ConfigError(`${filePath}: expected a JSON object, got ${t}`);
  }

  const obj = data as Record<string, unknown>;
  const warnings: string[] = [];
  const values: Partial<RalphaiConfig> = {};

  // Warn on unknown keys
  const unknown = Object.keys(obj).filter((k) => !ALLOWED_CONFIG_KEYS.has(k));
  if (unknown.length > 0) {
    warnings.push(`${filePath}: ignoring unknown config key '${unknown[0]}'`);
  }

  function err(msg: string): never {
    throw new ConfigError(`${filePath}: ${msg}`);
  }

  // agentCommand (string, non-empty)
  if ("agentCommand" in obj) {
    const v = obj.agentCommand;
    if (typeof v !== "string" || v === "")
      err("'agentCommand' must be a non-empty string");
    values.agentCommand = v;
  }

  // feedbackCommands (array of strings or comma-separated string)
  if ("feedbackCommands" in obj) {
    const v = obj.feedbackCommands;
    if (Array.isArray(v)) {
      if (v.some((s) => typeof s !== "string" || (s as string).trim() === ""))
        err("'feedbackCommands' array contains an empty entry");
      values.feedbackCommands = v.join(",");
    } else if (typeof v === "string") {
      values.feedbackCommands = v;
    } else {
      err(
        `'feedbackCommands' must be an array of strings or a comma-separated string, got ${typeof v}`,
      );
    }
  }

  // baseBranch (string, non-empty, no spaces)
  if ("baseBranch" in obj) {
    const v = String(obj.baseBranch || "");
    if (v === "") err("'baseBranch' must be a non-empty branch name");
    if (/\s/.test(v))
      err(`'baseBranch' must be a single token without spaces, got '${v}'`);
    values.baseBranch = v;
  }

  // maxStuck (positive integer)
  if ("maxStuck" in obj) {
    const v = obj.maxStuck;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
      err(`'maxStuck' must be a positive integer, got '${v}'`);
    values.maxStuck = v as number;
  }

  // mode (enum)
  if ("mode" in obj) {
    const v = String(obj.mode || "");
    if (!["branch", "pr", "patch"].includes(v))
      err(`'mode' must be 'branch', 'pr', or 'patch', got '${v}'`);
    values.mode = v as RalphaiConfig["mode"];
  }

  // issueSource (enum)
  if ("issueSource" in obj) {
    const v = String(obj.issueSource || "");
    if (!["none", "github"].includes(v))
      err(`'issueSource' must be 'none' or 'github', got '${v}'`);
    values.issueSource = v as RalphaiConfig["issueSource"];
  }

  // issueLabel (string, non-empty)
  if ("issueLabel" in obj) {
    const v = String(obj.issueLabel || "");
    if (v === "") err("'issueLabel' must be a non-empty label name");
    values.issueLabel = v;
  }

  // issueInProgressLabel (string, non-empty)
  if ("issueInProgressLabel" in obj) {
    const v = String(obj.issueInProgressLabel || "");
    if (v === "") err("'issueInProgressLabel' must be a non-empty label name");
    values.issueInProgressLabel = v;
  }

  // issueRepo (string, can be empty)
  if ("issueRepo" in obj) {
    values.issueRepo = String(obj.issueRepo || "");
  }

  // issueCommentProgress (boolean)
  if ("issueCommentProgress" in obj) {
    const v = obj.issueCommentProgress;
    if (typeof v !== "boolean")
      err(`'issueCommentProgress' must be 'true' or 'false', got '${v}'`);
    values.issueCommentProgress = String(v);
  }

  // turnTimeout (non-negative integer)
  if ("turnTimeout" in obj) {
    const v = obj.turnTimeout;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
      err(`'turnTimeout' must be a non-negative integer (seconds), got '${v}'`);
    values.turnTimeout = v as number;
  }

  // promptMode (enum)
  if ("promptMode" in obj) {
    const v = String(obj.promptMode || "");
    if (!["auto", "at-path", "inline"].includes(v))
      err(`'promptMode' must be 'auto', 'at-path', or 'inline', got '${v}'`);
    values.promptMode = v as RalphaiConfig["promptMode"];
  }

  // continuous (boolean)
  if ("continuous" in obj) {
    const v = obj.continuous;
    if (typeof v !== "boolean")
      err(`'continuous' must be 'true' or 'false', got '${v}'`);
    values.continuous = String(v);
  }

  // autoCommit (boolean)
  if ("autoCommit" in obj) {
    const v = obj.autoCommit;
    if (typeof v !== "boolean")
      err(`'autoCommit' must be 'true' or 'false', got '${v}'`);
    values.autoCommit = String(v);
  }

  // turns (non-negative integer, 0 = unlimited)
  if ("turns" in obj) {
    const v = obj.turns;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
      err(`'turns' must be a non-negative integer (0 = unlimited), got '${v}'`);
    values.turns = v as number;
  }

  // maxLearnings (non-negative integer, 0 = unlimited)
  if ("maxLearnings" in obj) {
    const v = obj.maxLearnings;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
      err(
        `'maxLearnings' must be a non-negative integer (0 = unlimited), got '${v}'`,
      );
    values.maxLearnings = v as number;
  }

  // workspaces (object of per-package overrides)
  if ("workspaces" in obj) {
    const ws = obj.workspaces;
    if (ws === null || typeof ws !== "object" || Array.isArray(ws)) {
      const t = ws === null ? "null" : Array.isArray(ws) ? "array" : typeof ws;
      err(`'workspaces' must be an object, got ${t}`);
    }
    const wsObj = ws as Record<string, unknown>;
    for (const k of Object.keys(wsObj)) {
      const entry = wsObj[k];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        const t =
          entry === null
            ? "null"
            : Array.isArray(entry)
              ? "array"
              : typeof entry;
        err(`workspaces['${k}'] must be an object, got ${t}`);
      }
      const entryObj = entry as Record<string, unknown>;
      if ("feedbackCommands" in entryObj) {
        const fc = entryObj.feedbackCommands;
        if (!Array.isArray(fc) && typeof fc !== "string")
          err(
            `workspaces['${k}'].feedbackCommands must be an array of strings or a comma-separated string, got ${typeof fc}`,
          );
      }
    }
    values.workspaces = wsObj as Record<string, WorkspaceOverrides>;
  }

  return { values, warnings };
}

// ---------------------------------------------------------------------------
// Env var overrides (ported from config.sh apply_env_overrides)
// ---------------------------------------------------------------------------

/** Env var name -> config key mapping. */
const ENV_VAR_MAP: ReadonlyArray<
  [envVar: string, configKey: keyof RalphaiConfig]
> = [
  ["RALPHAI_AGENT_COMMAND", "agentCommand"],
  ["RALPHAI_FEEDBACK_COMMANDS", "feedbackCommands"],
  ["RALPHAI_BASE_BRANCH", "baseBranch"],
  ["RALPHAI_MAX_STUCK", "maxStuck"],
  ["RALPHAI_MODE", "mode"],
  ["RALPHAI_TURN_TIMEOUT", "turnTimeout"],
  ["RALPHAI_ISSUE_SOURCE", "issueSource"],
  ["RALPHAI_ISSUE_LABEL", "issueLabel"],
  ["RALPHAI_ISSUE_IN_PROGRESS_LABEL", "issueInProgressLabel"],
  ["RALPHAI_ISSUE_REPO", "issueRepo"],
  ["RALPHAI_ISSUE_COMMENT_PROGRESS", "issueCommentProgress"],
  ["RALPHAI_PROMPT_MODE", "promptMode"],
  ["RALPHAI_CONTINUOUS", "continuous"],
  ["RALPHAI_AUTO_COMMIT", "autoCommit"],
  ["RALPHAI_TURNS", "turns"],
  ["RALPHAI_MAX_LEARNINGS", "maxLearnings"],
];

/**
 * Extract config overrides from environment variables.
 * Validates values (matching config.sh apply_env_overrides behavior).
 */
export function applyEnvOverrides(
  env: Record<string, string | undefined>,
): Partial<RalphaiConfig> {
  const overrides: Partial<RalphaiConfig> = {};

  const get = (name: string): string | undefined => {
    const v = env[name];
    return v !== undefined && v !== "" ? v : undefined;
  };

  // agentCommand
  const agentCmd = get("RALPHAI_AGENT_COMMAND");
  if (agentCmd !== undefined) overrides.agentCommand = agentCmd;

  // feedbackCommands
  const feedbackCmds = get("RALPHAI_FEEDBACK_COMMANDS");
  if (feedbackCmds !== undefined) overrides.feedbackCommands = feedbackCmds;

  // baseBranch (validate no spaces)
  const baseBranch = get("RALPHAI_BASE_BRANCH");
  if (baseBranch !== undefined) {
    if (/\s/.test(baseBranch)) {
      throw new ConfigError(
        `ERROR: RALPHAI_BASE_BRANCH must be a single token without spaces, got '${baseBranch}'`,
      );
    }
    overrides.baseBranch = baseBranch;
  }

  // maxStuck (positive integer)
  const maxStuck = get("RALPHAI_MAX_STUCK");
  if (maxStuck !== undefined) {
    validatePositiveInt(maxStuck, "RALPHAI_MAX_STUCK");
    overrides.maxStuck = parseInt(maxStuck, 10);
  }

  // mode (enum)
  const mode = get("RALPHAI_MODE");
  if (mode !== undefined) {
    validateEnum(mode, "RALPHAI_MODE", ["branch", "pr", "patch"]);
    overrides.mode = mode as RalphaiConfig["mode"];
  }

  // turnTimeout (non-negative integer)
  const turnTimeout = get("RALPHAI_TURN_TIMEOUT");
  if (turnTimeout !== undefined) {
    validateNonNegInt(turnTimeout, "RALPHAI_TURN_TIMEOUT", "seconds");
    overrides.turnTimeout = parseInt(turnTimeout, 10);
  }

  // issueSource (enum)
  const issueSource = get("RALPHAI_ISSUE_SOURCE");
  if (issueSource !== undefined) {
    validateEnum(issueSource, "RALPHAI_ISSUE_SOURCE", ["none", "github"]);
    overrides.issueSource = issueSource as RalphaiConfig["issueSource"];
  }

  // issueLabel
  const issueLabel = get("RALPHAI_ISSUE_LABEL");
  if (issueLabel !== undefined) overrides.issueLabel = issueLabel;

  // issueInProgressLabel
  const issueIpLabel = get("RALPHAI_ISSUE_IN_PROGRESS_LABEL");
  if (issueIpLabel !== undefined) overrides.issueInProgressLabel = issueIpLabel;

  // issueRepo
  const issueRepo = get("RALPHAI_ISSUE_REPO");
  if (issueRepo !== undefined) overrides.issueRepo = issueRepo;

  // issueCommentProgress (boolean)
  const issueComment = get("RALPHAI_ISSUE_COMMENT_PROGRESS");
  if (issueComment !== undefined) {
    validateBoolean(issueComment, "RALPHAI_ISSUE_COMMENT_PROGRESS");
    overrides.issueCommentProgress = issueComment;
  }

  // promptMode (enum)
  const promptMode = get("RALPHAI_PROMPT_MODE");
  if (promptMode !== undefined) {
    validateEnum(promptMode, "RALPHAI_PROMPT_MODE", [
      "auto",
      "at-path",
      "inline",
    ]);
    overrides.promptMode = promptMode as RalphaiConfig["promptMode"];
  }

  // continuous (boolean)
  const continuous = get("RALPHAI_CONTINUOUS");
  if (continuous !== undefined) {
    validateBoolean(continuous, "RALPHAI_CONTINUOUS");
    overrides.continuous = continuous;
  }

  // autoCommit (boolean)
  const autoCommit = get("RALPHAI_AUTO_COMMIT");
  if (autoCommit !== undefined) {
    validateBoolean(autoCommit, "RALPHAI_AUTO_COMMIT");
    overrides.autoCommit = autoCommit;
  }

  // turns (non-negative integer)
  const turns = get("RALPHAI_TURNS");
  if (turns !== undefined) {
    validateNonNegInt(turns, "RALPHAI_TURNS", "0 = unlimited");
    overrides.turns = parseInt(turns, 10);
  }

  // maxLearnings (non-negative integer)
  const maxLearnings = get("RALPHAI_MAX_LEARNINGS");
  if (maxLearnings !== undefined) {
    validateNonNegInt(maxLearnings, "RALPHAI_MAX_LEARNINGS", "0 = unlimited");
    overrides.maxLearnings = parseInt(maxLearnings, 10);
  }

  return overrides;
}

// ---------------------------------------------------------------------------
// CLI arg parsing (ported from cli.sh, config-relevant portion only)
// ---------------------------------------------------------------------------

/** Parsed CLI arguments relevant to config resolution. */
export interface ParsedCLIArgs {
  overrides: Partial<RalphaiConfig>;
  /** Raw CLI flag strings for --show-config source labels. */
  rawFlags: Partial<Record<keyof RalphaiConfig, string>>;
}

/**
 * Parse CLI arguments and extract config overrides.
 * Matches cli.sh's argument parsing for config-related flags.
 * Non-config flags (--dry-run, --resume, etc.) are ignored here.
 */
export function parseCLIArgs(args: readonly string[]): ParsedCLIArgs {
  const overrides: Partial<RalphaiConfig> = {};
  const rawFlags: Partial<Record<keyof RalphaiConfig, string>> = {};

  for (const arg of args) {
    if (arg.startsWith("--turns=")) {
      const v = arg.slice("--turns=".length);
      validateNonNegInt(v, "--turns");
      overrides.turns = parseInt(v, 10);
      rawFlags.turns = arg;
    } else if (arg.startsWith("--agent-command=")) {
      const v = arg.slice("--agent-command=".length);
      if (v === "") {
        throw new ConfigError(
          "ERROR: --agent-command requires a non-empty value (e.g. --agent-command='claude -p')",
        );
      }
      overrides.agentCommand = v;
      rawFlags.agentCommand = arg;
    } else if (arg.startsWith("--feedback-commands=")) {
      const v = arg.slice("--feedback-commands=".length);
      if (v !== "") validateCommaList(v, "--feedback-commands");
      overrides.feedbackCommands = v;
      rawFlags.feedbackCommands = arg;
    } else if (arg.startsWith("--base-branch=")) {
      const v = arg.slice("--base-branch=".length);
      if (v === "") {
        throw new ConfigError(
          "ERROR: --base-branch requires a non-empty value (e.g. --base-branch=main)",
        );
      }
      if (/\s/.test(v)) {
        throw new ConfigError(
          `ERROR: --base-branch must be a single token without spaces, got '${v}'`,
        );
      }
      overrides.baseBranch = v;
      rawFlags.baseBranch = arg;
    } else if (arg.startsWith("--max-stuck=")) {
      const v = arg.slice("--max-stuck=".length);
      validatePositiveInt(v, "--max-stuck");
      overrides.maxStuck = parseInt(v, 10);
      rawFlags.maxStuck = arg;
    } else if (arg.startsWith("--turn-timeout=")) {
      const v = arg.slice("--turn-timeout=".length);
      validateNonNegInt(v, "--turn-timeout", "seconds");
      overrides.turnTimeout = parseInt(v, 10);
      rawFlags.turnTimeout = arg;
    } else if (arg === "--branch") {
      overrides.mode = "branch";
      rawFlags.mode = "--branch";
    } else if (arg === "--pr") {
      overrides.mode = "pr";
      rawFlags.mode = "--pr";
    } else if (arg === "--patch") {
      overrides.mode = "patch";
      rawFlags.mode = "--patch";
    } else if (arg === "--continuous") {
      overrides.continuous = "true";
      rawFlags.continuous = "--continuous";
    } else if (arg === "--auto-commit") {
      overrides.autoCommit = "true";
      rawFlags.autoCommit = "--auto-commit";
    } else if (arg === "--no-auto-commit") {
      overrides.autoCommit = "false";
      rawFlags.autoCommit = "--no-auto-commit";
    } else if (arg.startsWith("--prompt-mode=")) {
      const v = arg.slice("--prompt-mode=".length);
      validateEnum(v, "--prompt-mode", ["auto", "at-path", "inline"]);
      overrides.promptMode = v as RalphaiConfig["promptMode"];
      rawFlags.promptMode = arg;
    } else if (arg.startsWith("--issue-source=")) {
      const v = arg.slice("--issue-source=".length);
      validateEnum(v, "--issue-source", ["none", "github"]);
      overrides.issueSource = v as RalphaiConfig["issueSource"];
      rawFlags.issueSource = arg;
    } else if (arg.startsWith("--issue-label=")) {
      const v = arg.slice("--issue-label=".length);
      if (v === "") {
        throw new ConfigError(
          "ERROR: --issue-label requires a non-empty value",
        );
      }
      overrides.issueLabel = v;
      rawFlags.issueLabel = arg;
    } else if (arg.startsWith("--issue-in-progress-label=")) {
      const v = arg.slice("--issue-in-progress-label=".length);
      if (v === "") {
        throw new ConfigError(
          "ERROR: --issue-in-progress-label requires a non-empty value",
        );
      }
      overrides.issueInProgressLabel = v;
      rawFlags.issueInProgressLabel = arg;
    } else if (arg.startsWith("--issue-repo=")) {
      const v = arg.slice("--issue-repo=".length);
      overrides.issueRepo = v;
      rawFlags.issueRepo = arg;
    } else if (arg.startsWith("--issue-comment-progress=")) {
      const v = arg.slice("--issue-comment-progress=".length);
      validateBoolean(v, "--issue-comment-progress");
      overrides.issueCommentProgress = v;
      rawFlags.issueCommentProgress = arg;
    }
    // Non-config flags (--dry-run, --resume, --allow-dirty, --show-config,
    // --help) are deliberately not handled here.
  }

  return { overrides, rawFlags };
}

// ---------------------------------------------------------------------------
// resolveConfig — compose defaults -> file -> env -> CLI with source tracking
// ---------------------------------------------------------------------------

export interface ResolveConfigInput {
  configFilePath: string;
  envVars: Record<string, string | undefined>;
  cliArgs: readonly string[];
}

export interface ResolveConfigResult {
  config: ResolvedConfig;
  warnings: string[];
}

/**
 * Resolve the full config by composing layers:
 *   1. Built-in defaults
 *   2. Config file values
 *   3. Environment variable overrides
 *   4. CLI argument overrides
 *
 * Each field tracks its source for --show-config display.
 */
export function resolveConfig(input: ResolveConfigInput): ResolveConfigResult {
  const { configFilePath, envVars, cliArgs } = input;
  const warnings: string[] = [];

  // Layer 1: defaults
  const resolved: ResolvedConfig = {} as ResolvedConfig;
  for (const key of Object.keys(DEFAULTS) as Array<keyof RalphaiConfig>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (resolved as any)[key] = {
      value: DEFAULTS[key],
      source: "default" as ConfigSource,
    };
  }

  // Layer 2: config file
  const parsed = parseConfigFile(configFilePath);
  if (parsed) {
    warnings.push(...parsed.warnings);
    for (const key of Object.keys(parsed.values) as Array<
      keyof RalphaiConfig
    >) {
      const val = parsed.values[key];
      if (val !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (resolved as any)[key] = {
          value: val,
          source: "config" as ConfigSource,
        };
      }
    }
  }

  // Layer 3: env vars
  const envOverrides = applyEnvOverrides(envVars);
  for (const key of Object.keys(envOverrides) as Array<keyof RalphaiConfig>) {
    const val = envOverrides[key];
    if (val !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (resolved as any)[key] = {
        value: val,
        source: "env" as ConfigSource,
      };
    }
  }

  // Layer 4: CLI args
  const { overrides: cliOverrides } = parseCLIArgs(cliArgs);
  for (const key of Object.keys(cliOverrides) as Array<keyof RalphaiConfig>) {
    const val = cliOverrides[key];
    if (val !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (resolved as any)[key] = {
        value: val,
        source: "cli" as ConfigSource,
      };
    }
  }

  return { config: resolved, warnings };
}
