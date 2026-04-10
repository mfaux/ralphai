/**
 * Config module — loading, validation, and resolution.
 *
 * Provides a single resolveConfig() entry point that composes:
 *   defaults -> config file -> env vars -> CLI args
 * with source tracking for --show-config.
 */

import { execSync } from "child_process";
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
  prFeedbackCommands: string;
  baseBranch: string;
  maxStuck: number;
  issueSource: "none" | "github";
  standaloneLabel: string;
  subissueLabel: string;
  prdLabel: string;
  issueRepo: string;
  issueCommentProgress: string; // "true" | "false" — kept as string to match shell
  issueHitlLabel: string;
  agentInteractiveCommand: string;
  iterationTimeout: number;
  sandbox: "none" | "docker";
  dockerImage: string;
  dockerMounts: string;
  dockerEnvVars: string;
  review: string; // "true" | "false"
  workspaces: Record<string, WorkspaceOverrides> | null;
}

export interface WorkspaceOverrides {
  feedbackCommands?: string[] | string;
  prFeedbackCommands?: string[] | string;
  [key: string]: unknown;
}

/** Where a resolved value came from. */
export type ConfigSource =
  | "default"
  | "auto-detected"
  | "config"
  | "env"
  | "cli";

/** A resolved value paired with its source. */
export interface ResolvedValue<T> {
  value: T;
  source: ConfigSource;
}

/** Fully resolved config with source tracking. */
export type ResolvedConfig = {
  [K in keyof RalphaiConfig]: ResolvedValue<RalphaiConfig[K]>;
};

/**
 * Plain config values without resolution metadata (source, raw).
 *
 * Use `configValues(rc)` to strip a `ResolvedConfig` down to just values.
 * This is the type business-logic code should accept — it doesn't need to
 * know where a value came from.
 */
export type ConfigValues = {
  [K in keyof RalphaiConfig]: RalphaiConfig[K];
};

/**
 * Strip resolution metadata from a `ResolvedConfig`, returning plain values.
 *
 * Consumers that only need config values (not source information) should
 * call this once and pass the result around, avoiding `rc.someKey.value`
 * boilerplate everywhere.
 */
export function configValues(rc: ResolvedConfig): ConfigValues {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(rc) as Array<keyof ResolvedConfig>) {
    out[key as string] = rc[key].value;
  }
  return out as ConfigValues;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULTS: Readonly<RalphaiConfig> = {
  agentCommand: "",
  setupCommand: "",
  feedbackCommands: "",
  prFeedbackCommands: "",
  baseBranch: "main",
  maxStuck: 3,
  issueSource: "none",
  standaloneLabel: "ralphai-standalone",
  subissueLabel: "ralphai-subissue",
  prdLabel: "ralphai-prd",
  issueRepo: "",
  issueCommentProgress: "true",
  issueHitlLabel: "ralphai-subissue-hitl",
  agentInteractiveCommand: "",
  iterationTimeout: 0,
  sandbox: "none",
  dockerImage: "",
  dockerMounts: "",
  dockerEnvVars: "",
  review: "true",
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
 */
export function validateBoolean(value: string, label: string): void {
  validateEnum(value, label, ["true", "false"]);
}

/**
 * Validate that `value` is a positive integer (>= 1).
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
  "prFeedbackCommands",
  "baseBranch",
  "maxStuck",
  "issueSource",
  "standaloneLabel",
  "subissueLabel",
  "prdLabel",
  "issueRepo",
  "issueCommentProgress",
  "issueHitlLabel",
  "agentInteractiveCommand",
  "iterationTimeout",
  "sandbox",
  "dockerImage",
  "dockerMounts",
  "dockerEnvVars",
  "review",
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

  /** Parse a value that accepts an array of strings or a comma-separated string. */
  function parseStringListField(fieldName: string, v: unknown): string {
    if (Array.isArray(v)) {
      if (v.some((s) => typeof s !== "string" || (s as string).trim() === ""))
        err(`'${fieldName}' array contains an empty entry`);
      return v.join(",");
    } else if (typeof v === "string") {
      return v;
    }
    err(
      `'${fieldName}' must be an array of strings or a comma-separated string, got ${typeof v}`,
    );
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
    values.feedbackCommands = parseStringListField(
      "feedbackCommands",
      obj.feedbackCommands,
    );
  }

  // prFeedbackCommands (array of strings or comma-separated string)
  if ("prFeedbackCommands" in obj) {
    values.prFeedbackCommands = parseStringListField(
      "prFeedbackCommands",
      obj.prFeedbackCommands,
    );
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

  // standaloneLabel (string, non-empty)
  if ("standaloneLabel" in obj) {
    const v = String(obj.standaloneLabel || "");
    if (v === "") err("'standaloneLabel' must be a non-empty label name");
    values.standaloneLabel = v;
  }

  // subissueLabel (string, non-empty)
  if ("subissueLabel" in obj) {
    const v = String(obj.subissueLabel || "");
    if (v === "") err("'subissueLabel' must be a non-empty label name");
    values.subissueLabel = v;
  }

  // prdLabel (string, non-empty)
  if ("prdLabel" in obj) {
    const v = String(obj.prdLabel || "");
    if (v === "") err("'prdLabel' must be a non-empty label name");
    values.prdLabel = v;
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

  // issueHitlLabel (string, non-empty)
  if ("issueHitlLabel" in obj) {
    const v = String(obj.issueHitlLabel || "");
    if (v === "") err("'issueHitlLabel' must be a non-empty label name");
    values.issueHitlLabel = v;
  }

  // agentInteractiveCommand (string, can be empty)
  if ("agentInteractiveCommand" in obj) {
    const v = obj.agentInteractiveCommand;
    if (typeof v !== "string")
      err(`'agentInteractiveCommand' must be a string, got ${typeof v}`);
    values.agentInteractiveCommand = v;
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

  // sandbox (enum: "none" | "docker")
  if ("sandbox" in obj) {
    const v = String(obj.sandbox || "");
    if (!["none", "docker"].includes(v))
      err(`'sandbox' must be 'none' or 'docker', got '${v}'`);
    values.sandbox = v as RalphaiConfig["sandbox"];
  }

  // dockerImage (string, can be empty)
  if ("dockerImage" in obj) {
    const v = obj.dockerImage;
    if (typeof v !== "string")
      err(`'dockerImage' must be a string, got ${typeof v}`);
    values.dockerImage = v;
  }

  // dockerMounts (CSV string or array of strings)
  if ("dockerMounts" in obj) {
    values.dockerMounts = parseStringListField(
      "dockerMounts",
      obj.dockerMounts,
    );
  }

  // dockerEnvVars (CSV string or array of strings)
  if ("dockerEnvVars" in obj) {
    values.dockerEnvVars = parseStringListField(
      "dockerEnvVars",
      obj.dockerEnvVars,
    );
  }

  // review (boolean)
  if ("review" in obj) {
    const v = obj.review;
    if (typeof v !== "boolean")
      err(`'review' must be 'true' or 'false', got '${v}'`);
    values.review = String(v);
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
      if ("prFeedbackCommands" in entryObj) {
        const pfc = entryObj.prFeedbackCommands;
        if (!Array.isArray(pfc) && typeof pfc !== "string")
          err(
            `workspaces['${k}'].prFeedbackCommands must be an array of strings or a comma-separated string, got ${typeof pfc}`,
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

  // prFeedbackCommands
  const prFeedbackCmds = get("RALPHAI_PR_FEEDBACK_COMMANDS");
  if (prFeedbackCmds !== undefined)
    overrides.prFeedbackCommands = prFeedbackCmds;

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

  // standaloneLabel
  const standaloneLabel = get("RALPHAI_STANDALONE_LABEL");
  if (standaloneLabel !== undefined)
    overrides.standaloneLabel = standaloneLabel;

  // subissueLabel
  const subissueLabel = get("RALPHAI_SUBISSUE_LABEL");
  if (subissueLabel !== undefined) overrides.subissueLabel = subissueLabel;

  // prdLabel
  const prdLabel = get("RALPHAI_PRD_LABEL");
  if (prdLabel !== undefined) overrides.prdLabel = prdLabel;

  // issueRepo
  const issueRepo = get("RALPHAI_ISSUE_REPO");
  if (issueRepo !== undefined) overrides.issueRepo = issueRepo;

  // issueCommentProgress (boolean)
  const issueComment = get("RALPHAI_ISSUE_COMMENT_PROGRESS");
  if (issueComment !== undefined) {
    validateBoolean(issueComment, "RALPHAI_ISSUE_COMMENT_PROGRESS");
    overrides.issueCommentProgress = issueComment;
  }

  // issueHitlLabel
  const issueHitlLabel = get("RALPHAI_ISSUE_HITL_LABEL");
  if (issueHitlLabel !== undefined) overrides.issueHitlLabel = issueHitlLabel;

  // agentInteractiveCommand
  const agentInteractiveCmd = get("RALPHAI_AGENT_INTERACTIVE_COMMAND");
  if (agentInteractiveCmd !== undefined)
    overrides.agentInteractiveCommand = agentInteractiveCmd;

  // sandbox (enum: "none" | "docker")
  const sandbox = get("RALPHAI_SANDBOX");
  if (sandbox !== undefined) {
    validateEnum(sandbox, "RALPHAI_SANDBOX", ["none", "docker"]);
    overrides.sandbox = sandbox as RalphaiConfig["sandbox"];
  }

  // dockerImage (string)
  const dockerImage = get("RALPHAI_DOCKER_IMAGE");
  if (dockerImage !== undefined) overrides.dockerImage = dockerImage;

  // dockerMounts (CSV string)
  const dockerMounts = get("RALPHAI_DOCKER_MOUNTS");
  if (dockerMounts !== undefined) {
    validateCommaList(dockerMounts, "RALPHAI_DOCKER_MOUNTS");
    overrides.dockerMounts = dockerMounts;
  }

  // dockerEnvVars (CSV string)
  const dockerEnvVars = get("RALPHAI_DOCKER_ENV_VARS");
  if (dockerEnvVars !== undefined) {
    validateCommaList(dockerEnvVars, "RALPHAI_DOCKER_ENV_VARS");
    overrides.dockerEnvVars = dockerEnvVars;
  }

  // review (boolean)
  const review = get("RALPHAI_REVIEW");
  if (review !== undefined) {
    validateBoolean(review, "RALPHAI_REVIEW");
    overrides.review = review;
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
 * Parse config-related CLI flags from the argument list.
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
    } else if (arg.startsWith("--pr-feedback-commands=")) {
      const v = arg.slice("--pr-feedback-commands=".length);
      if (v !== "") validateCommaList(v, "--pr-feedback-commands");
      overrides.prFeedbackCommands = v;
      rawFlags.prFeedbackCommands = arg;
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
    } else if (arg === "--review") {
      overrides.review = "true";
      rawFlags.review = "--review";
    } else if (arg === "--no-review") {
      overrides.review = "false";
      rawFlags.review = "--no-review";
    } else if (arg.startsWith("--issue-hitl-label=")) {
      const v = arg.slice("--issue-hitl-label=".length);
      if (v === "") {
        throw new ConfigError(
          "ERROR: --issue-hitl-label requires a non-empty value (e.g. --issue-hitl-label='ralphai-subissue-hitl')",
        );
      }
      overrides.issueHitlLabel = v;
      rawFlags.issueHitlLabel = arg;
    } else if (arg.startsWith("--agent-interactive-command=")) {
      const v = arg.slice("--agent-interactive-command=".length);
      overrides.agentInteractiveCommand = v;
      rawFlags.agentInteractiveCommand = arg;
    } else if (arg.startsWith("--sandbox=")) {
      const v = arg.slice("--sandbox=".length);
      validateEnum(v, "--sandbox", ["none", "docker"]);
      overrides.sandbox = v as RalphaiConfig["sandbox"];
      rawFlags.sandbox = arg;
    } else if (arg.startsWith("--docker-image=")) {
      const v = arg.slice("--docker-image=".length);
      overrides.dockerImage = v;
      rawFlags.dockerImage = arg;
    } else if (arg.startsWith("--docker-mounts=")) {
      const v = arg.slice("--docker-mounts=".length);
      if (v !== "") validateCommaList(v, "--docker-mounts");
      overrides.dockerMounts = v;
      rawFlags.dockerMounts = arg;
    } else if (arg.startsWith("--docker-env-vars=")) {
      const v = arg.slice("--docker-env-vars=".length);
      if (v !== "") validateCommaList(v, "--docker-env-vars");
      overrides.dockerEnvVars = v;
      rawFlags.dockerEnvVars = arg;
    }
    // Non-config flags (--dry-run, --resume, --allow-dirty, --show-config,
    // --help) are deliberately not handled here.
  }

  return { overrides, rawFlags };
}

// ---------------------------------------------------------------------------
// Docker auto-detection
// ---------------------------------------------------------------------------

/**
 * Probe whether Docker is available by running `docker info`.
 *
 * Used at config resolution time to auto-detect the sandbox default:
 * if Docker is available → default to "docker"; otherwise → "none".
 *
 * The check uses a short timeout (3 s) to avoid stalling config resolution
 * when Docker is installed but the daemon is unresponsive.
 *
 * Results are cached per-process — Docker availability rarely changes
 * mid-run, and caching avoids repeated `execSync` calls from test suites
 * that invoke `resolveConfig` many times.
 *
 * @param execCheck - Optional override for testability (returns true if the
 *   command exits 0). The default uses `execSync` with a 3-second timeout.
 *   Passing an override bypasses the cache.
 * @param platform - Override `process.platform` for testing.
 * @returns `true` when `docker info` exits 0; `false` otherwise.
 */
let _dockerAvailableCache: boolean | undefined;

export function detectDockerAvailable(
  execCheck?: (cmd: string) => boolean,
  platform?: string,
): boolean {
  const plat = platform ?? process.platform;
  if (plat === "win32") return false;

  // Custom exec check — bypass cache (test usage)
  if (execCheck) return execCheck("docker info");

  // Return cached result when available
  if (_dockerAvailableCache !== undefined) return _dockerAvailableCache;

  try {
    execSync("docker info", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    });
    _dockerAvailableCache = true;
  } catch {
    _dockerAvailableCache = false;
  }

  return _dockerAvailableCache;
}

/** Reset the Docker availability cache (for testing). */
export function _resetDockerAvailableCache(): void {
  _dockerAvailableCache = undefined;
}

// ---------------------------------------------------------------------------
// resolveConfig — compose defaults -> file -> env -> CLI with source tracking
// ---------------------------------------------------------------------------

export interface ResolveConfigInput {
  cwd: string;
  envVars: Record<string, string | undefined>;
  cliArgs: readonly string[];
  /**
   * Override Docker detection for testing. When provided, this function
   * is called instead of the real `detectDockerAvailable()`.
   */
  detectDocker?: () => boolean;
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
 *   5. Auto-detection fallbacks (sandbox: probe Docker when no explicit value)
 *
 * Each field tracks its source for --show-config display.
 */
export function resolveConfig(input: ResolveConfigInput): ResolveConfigResult {
  const { cwd, envVars, cliArgs, detectDocker } = input;
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

  // Layer 5: Auto-detection fallbacks
  // When sandbox has no explicit value (still at default "none"), probe
  // Docker availability. If Docker is running → "docker"; otherwise "none".
  // Both outcomes use source "auto-detected" so --show-config can display it.
  if (resolved.sandbox.source === "default") {
    const dockerAvailable = detectDocker
      ? detectDocker()
      : detectDockerAvailable();
    resolved.sandbox = {
      value: dockerAvailable ? "docker" : "none",
      source: "auto-detected",
    };
  }

  return { config: resolved, configFilePath, warnings };
}
