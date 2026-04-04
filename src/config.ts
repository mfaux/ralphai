/**
 * Config module — loading, validation, and resolution.
 *
 * Provides a single resolveConfig() entry point that composes:
 *   defaults -> config file -> env vars -> CLI args
 * with source tracking for --show-config.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { resolveRepoStateDir } from "./global-state.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All recognised config keys. */
export interface RalphaiConfig {
  agentCommand: string;
  setupCommand: string;
  feedbackCommands: string;
  baseBranch: string;
  maxStuck: number;
  issueSource: "none" | "github";
  issueLabel: string;
  issueInProgressLabel: string;
  issueDoneLabel: string;
  issueStuckLabel: string;
  issuePrdLabel: string;
  issuePrdInProgressLabel: string;
  issueRepo: string;
  issueCommentProgress: string; // "true" | "false" — kept as string to match shell
  iterationTimeout: number;
  autoCommit: string; // "true" | "false"
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
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULTS: Readonly<RalphaiConfig> = {
  agentCommand: "",
  setupCommand: "",
  feedbackCommands: "",
  baseBranch: "main",
  maxStuck: 3,
  issueSource: "none",
  issueLabel: "ralphai",
  issueInProgressLabel: "ralphai:in-progress",
  issueDoneLabel: "ralphai:done",
  issueStuckLabel: "ralphai:stuck",
  issuePrdLabel: "ralphai-prd",
  issuePrdInProgressLabel: "ralphai-prd:in-progress",
  issueRepo: "",
  issueCommentProgress: "true",
  iterationTimeout: 0,
  autoCommit: "false",
  workspaces: null,
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Validate that `value` is one of the `allowed` values.
 * Error format: "ERROR: <label> must be 'a', 'b', or 'c', got '<value>'"
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
 * Validate a boolean string value.
 */
export function validateBoolean(value: string, label: string): void {
  validateEnum(value, label, ["true", "false"]);
}

/**
 * Validate that `value` is a positive integer (>= 1).
 * Validate a positive integer string value.
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
 * Validate a non-negative integer string value.
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
 * Validate a comma-separated list string value.
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
// Config file parsing
// ---------------------------------------------------------------------------

/** Allowed keys in config.json. */
const ALLOWED_CONFIG_KEYS = new Set([
  "agentCommand",
  "setupCommand",
  "feedbackCommands",
  "baseBranch",
  "maxStuck",
  "issueSource",
  "issueLabel",
  "issueInProgressLabel",
  "issueDoneLabel",
  "issueStuckLabel",
  "issuePrdLabel",
  "issuePrdInProgressLabel",
  "issueRepo",
  "issueCommentProgress",
  "iterationTimeout",
  "autoCommit",
  "workspaces",
  "repoPath", // metadata: absolute path to the repo root (written by init)
]);

export interface ParsedConfigFile {
  /** Values extracted from the config file. */
  values: Partial<RalphaiConfig>;
  /** Warning messages (e.g. unknown keys). */
  warnings: string[];
}

/**
 * Parse and validate a config.json file.
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

  // setupCommand (string, can be empty)
  if ("setupCommand" in obj) {
    const v = obj.setupCommand;
    if (typeof v !== "string")
      err(`'setupCommand' must be a string, got ${typeof v}`);
    values.setupCommand = v;
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

  // issueDoneLabel (string, non-empty)
  if ("issueDoneLabel" in obj) {
    const v = String(obj.issueDoneLabel || "");
    if (v === "") err("'issueDoneLabel' must be a non-empty label name");
    values.issueDoneLabel = v;
  }

  // issueStuckLabel (string, non-empty)
  if ("issueStuckLabel" in obj) {
    const v = String(obj.issueStuckLabel || "");
    if (v === "") err("'issueStuckLabel' must be a non-empty label name");
    values.issueStuckLabel = v;
  }

  // issuePrdLabel (string, non-empty)
  if ("issuePrdLabel" in obj) {
    const v = String(obj.issuePrdLabel || "");
    if (v === "") err("'issuePrdLabel' must be a non-empty label name");
    values.issuePrdLabel = v;
  }

  // issuePrdInProgressLabel (string, non-empty)
  if ("issuePrdInProgressLabel" in obj) {
    const v = String(obj.issuePrdInProgressLabel || "");
    if (v === "")
      err("'issuePrdInProgressLabel' must be a non-empty label name");
    values.issuePrdInProgressLabel = v;
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

  // iterationTimeout (non-negative integer)
  if ("iterationTimeout" in obj) {
    const v = obj.iterationTimeout;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
      err(
        `'iterationTimeout' must be a non-negative integer (seconds), got '${v}'`,
      );
    values.iterationTimeout = v as number;
  }

  // autoCommit (boolean)
  if ("autoCommit" in obj) {
    const v = obj.autoCommit;
    if (typeof v !== "boolean")
      err(`'autoCommit' must be 'true' or 'false', got '${v}'`);
    values.autoCommit = String(v);
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

/**
 * Return the global config file path for a given working directory.
 * The path is `~/.ralphai/repos/<repoId>/config.json`.
 */
export function getConfigFilePath(
  cwd: string,
  env?: Record<string, string | undefined>,
): string {
  return join(resolveRepoStateDir(cwd, env), "config.json");
}

/**
 * Write a validated config object to the global config path.
 * Creates parent directories as needed.
 * Automatically stamps `repoPath` with the resolved `cwd`.
 */
export function writeConfigFile(
  cwd: string,
  config: Record<string, unknown>,
  env?: Record<string, string | undefined>,
): string {
  const filePath = getConfigFilePath(cwd, env);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Always stamp the repo path so `ralphai repos` can reverse-lookup.
  const withPath = { ...config, repoPath: resolve(cwd) };
  writeFileSync(filePath, JSON.stringify(withPath, null, 2) + "\n");
  return filePath;
}

// ---------------------------------------------------------------------------
// Env var overrides
// ---------------------------------------------------------------------------

/** Env var name -> config key mapping. */
const ENV_VAR_MAP: ReadonlyArray<
  [envVar: string, configKey: keyof RalphaiConfig]
> = [
  ["RALPHAI_AGENT_COMMAND", "agentCommand"],
  ["RALPHAI_SETUP_COMMAND", "setupCommand"],
  ["RALPHAI_FEEDBACK_COMMANDS", "feedbackCommands"],
  ["RALPHAI_BASE_BRANCH", "baseBranch"],
  ["RALPHAI_MAX_STUCK", "maxStuck"],
  ["RALPHAI_ITERATION_TIMEOUT", "iterationTimeout"],
  ["RALPHAI_ISSUE_SOURCE", "issueSource"],
  ["RALPHAI_ISSUE_LABEL", "issueLabel"],
  ["RALPHAI_ISSUE_IN_PROGRESS_LABEL", "issueInProgressLabel"],
  ["RALPHAI_ISSUE_DONE_LABEL", "issueDoneLabel"],
  ["RALPHAI_ISSUE_STUCK_LABEL", "issueStuckLabel"],
  ["RALPHAI_ISSUE_PRD_LABEL", "issuePrdLabel"],
  ["RALPHAI_ISSUE_PRD_IN_PROGRESS_LABEL", "issuePrdInProgressLabel"],
  ["RALPHAI_ISSUE_REPO", "issueRepo"],
  ["RALPHAI_ISSUE_COMMENT_PROGRESS", "issueCommentProgress"],
  ["RALPHAI_AUTO_COMMIT", "autoCommit"],
];

/**
 * Extract config overrides from environment variables.
 * Validates values and tracks source for --show-config.
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

  // setupCommand
  const setupCmd = get("RALPHAI_SETUP_COMMAND");
  if (setupCmd !== undefined) overrides.setupCommand = setupCmd;

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

  // iterationTimeout (non-negative integer)
  const iterationTimeout = get("RALPHAI_ITERATION_TIMEOUT");
  if (iterationTimeout !== undefined) {
    validateNonNegInt(iterationTimeout, "RALPHAI_ITERATION_TIMEOUT", "seconds");
    overrides.iterationTimeout = parseInt(iterationTimeout, 10);
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

  // issueDoneLabel
  const issueDoneLabel = get("RALPHAI_ISSUE_DONE_LABEL");
  if (issueDoneLabel !== undefined) overrides.issueDoneLabel = issueDoneLabel;

  // issueStuckLabel
  const issueStuckLabel = get("RALPHAI_ISSUE_STUCK_LABEL");
  if (issueStuckLabel !== undefined)
    overrides.issueStuckLabel = issueStuckLabel;

  // issuePrdLabel
  const issuePrdLabel = get("RALPHAI_ISSUE_PRD_LABEL");
  if (issuePrdLabel !== undefined) overrides.issuePrdLabel = issuePrdLabel;

  // issuePrdInProgressLabel
  const issuePrdIpLabel = get("RALPHAI_ISSUE_PRD_IN_PROGRESS_LABEL");
  if (issuePrdIpLabel !== undefined)
    overrides.issuePrdInProgressLabel = issuePrdIpLabel;

  // issueRepo
  const issueRepo = get("RALPHAI_ISSUE_REPO");
  if (issueRepo !== undefined) overrides.issueRepo = issueRepo;

  // issueCommentProgress (boolean)
  const issueComment = get("RALPHAI_ISSUE_COMMENT_PROGRESS");
  if (issueComment !== undefined) {
    validateBoolean(issueComment, "RALPHAI_ISSUE_COMMENT_PROGRESS");
    overrides.issueCommentProgress = issueComment;
  }

  // autoCommit (boolean)
  const autoCommit = get("RALPHAI_AUTO_COMMIT");
  if (autoCommit !== undefined) {
    validateBoolean(autoCommit, "RALPHAI_AUTO_COMMIT");
    overrides.autoCommit = autoCommit;
  }

  return overrides;
}

// ---------------------------------------------------------------------------
// CLI arg parsing (config-relevant portion only)
// ---------------------------------------------------------------------------

/** Parsed CLI arguments relevant to config resolution. */
export interface ParsedCLIArgs {
  overrides: Partial<RalphaiConfig>;
  /** Raw CLI flag strings for --show-config source labels. */
  rawFlags: Partial<Record<keyof RalphaiConfig, string>>;
}

/**
 * Parse CLI arguments and extract config overrides.
 * Parses config-related CLI flags from the argument list.
 * Non-config flags (--dry-run, --resume, etc.) are ignored here.
 */
export function parseCLIArgs(args: readonly string[]): ParsedCLIArgs {
  const overrides: Partial<RalphaiConfig> = {};
  const rawFlags: Partial<Record<keyof RalphaiConfig, string>> = {};

  for (const arg of args) {
    if (arg.startsWith("--agent-command=")) {
      const v = arg.slice("--agent-command=".length);
      if (v === "") {
        throw new ConfigError(
          "ERROR: --agent-command requires a non-empty value (e.g. --agent-command='claude -p')",
        );
      }
      overrides.agentCommand = v;
      rawFlags.agentCommand = arg;
    } else if (arg.startsWith("--setup-command=")) {
      const v = arg.slice("--setup-command=".length);
      overrides.setupCommand = v;
      rawFlags.setupCommand = arg;
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
    } else if (arg.startsWith("--iteration-timeout=")) {
      const v = arg.slice("--iteration-timeout=".length);
      validateNonNegInt(v, "--iteration-timeout", "seconds");
      overrides.iterationTimeout = parseInt(v, 10);
      rawFlags.iterationTimeout = arg;
    } else if (arg === "--auto-commit") {
      overrides.autoCommit = "true";
      rawFlags.autoCommit = "--auto-commit";
    } else if (arg === "--no-auto-commit") {
      overrides.autoCommit = "false";
      rawFlags.autoCommit = "--no-auto-commit";
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
  cwd: string;
  envVars: Record<string, string | undefined>;
  cliArgs: readonly string[];
}

export interface ResolveConfigResult {
  config: ResolvedConfig;
  /** Path to the config file that was loaded (or would be loaded). */
  configFilePath: string;
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
  const { cwd, envVars, cliArgs } = input;
  const configFilePath = getConfigFilePath(cwd, envVars);
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

  return { config: resolved, configFilePath, warnings };
}
