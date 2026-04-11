/**
 * Config module — loading, validation, and resolution.
 *
 * Provides a single resolveConfig() entry point that composes:
 *   defaults -> config file -> env vars -> CLI args
 * with source tracking for --show-config.
 *
 * Config keys are organized into nested groups:
 *   agent, hooks, gate, prompt, pr, git, issue
 * plus flat top-level keys: baseBranch, sandbox, dockerImage, etc.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { resolveRepoStateDir } from "./plan-lifecycle.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Agent-related config keys. */
export interface AgentConfig {
  command: string;
  interactiveCommand: string;
  setupCommand: string;
}

/** Hook/callback config keys. */
export interface HooksConfig {
  feedback: string;
  prFeedback: string;
  beforeRun: string;
  afterRun: string;
  feedbackTimeout: number;
}

/** Gating / iteration-control config keys. */
export interface GateConfig {
  maxStuck: number;
  review: boolean;
  maxRejections: number;
  maxIterations: number;
  reviewMaxFiles: number;
  validators: string;
  iterationTimeout: number;
}

/** Prompt-related config keys. */
export interface PromptConfig {
  verbose: boolean;
  preamble: string;
  learnings: boolean;
  commitStyle: string;
}

/** PR-related config keys. */
export interface PrConfig {
  draft: boolean;
}

/** Git-related config keys. */
export interface GitConfig {
  branchPrefix: string;
}

/** Issue-tracker config keys. */
export interface IssueConfig {
  source: "none" | "github";
  standaloneLabel: string;
  subissueLabel: string;
  prdLabel: string;
  repo: string;
  commentProgress: boolean;
  hitlLabel: string;
  inProgressLabel: string;
  doneLabel: string;
  stuckLabel: string;
}

export interface WorkspaceOverrides {
  feedbackCommands?: string[] | string;
  prFeedbackCommands?: string[] | string;
  validators?: string[] | string;
  beforeRun?: string;
  preamble?: string;
  [key: string]: unknown;
}

/** All recognised config keys, organized into nested groups. */
export interface RalphaiConfig {
  agent: AgentConfig;
  hooks: HooksConfig;
  gate: GateConfig;
  prompt: PromptConfig;
  pr: PrConfig;
  git: GitConfig;
  issue: IssueConfig;
  baseBranch: string;
  sandbox: "none" | "docker";
  dockerImage: string;
  dockerMounts: string;
  dockerEnvVars: string;
  workspaces: Record<string, WorkspaceOverrides> | null;
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

/** Resolved group: each leaf is wrapped with source metadata. */
type ResolvedGroup<T> = {
  [K in keyof T]: ResolvedValue<T[K]>;
};

/** Fully resolved config with source tracking at every leaf. */
export interface ResolvedConfig {
  agent: ResolvedGroup<AgentConfig>;
  hooks: ResolvedGroup<HooksConfig>;
  gate: ResolvedGroup<GateConfig>;
  prompt: ResolvedGroup<PromptConfig>;
  pr: ResolvedGroup<PrConfig>;
  git: ResolvedGroup<GitConfig>;
  issue: ResolvedGroup<IssueConfig>;
  baseBranch: ResolvedValue<string>;
  sandbox: ResolvedValue<"none" | "docker">;
  dockerImage: ResolvedValue<string>;
  dockerMounts: ResolvedValue<string>;
  dockerEnvVars: ResolvedValue<string>;
  workspaces: ResolvedValue<Record<string, WorkspaceOverrides> | null>;
}

/**
 * Plain config values without resolution metadata.
 *
 * Use `configValues(rc)` to strip a `ResolvedConfig` down to just values.
 * This is the type business-logic code should accept — it doesn't need to
 * know where a value came from.
 */
export type ConfigValues = RalphaiConfig;

/**
 * Strip resolution metadata from a `ResolvedConfig`, returning plain values.
 *
 * Walks the nested group structure, extracting `.value` from each
 * `ResolvedValue` leaf.
 */
export function configValues(rc: ResolvedConfig): ConfigValues {
  return {
    agent: {
      command: rc.agent.command.value,
      interactiveCommand: rc.agent.interactiveCommand.value,
      setupCommand: rc.agent.setupCommand.value,
    },
    hooks: {
      feedback: rc.hooks.feedback.value,
      prFeedback: rc.hooks.prFeedback.value,
      beforeRun: rc.hooks.beforeRun.value,
      afterRun: rc.hooks.afterRun.value,
      feedbackTimeout: rc.hooks.feedbackTimeout.value,
    },
    gate: {
      maxStuck: rc.gate.maxStuck.value,
      review: rc.gate.review.value,
      maxRejections: rc.gate.maxRejections.value,
      maxIterations: rc.gate.maxIterations.value,
      reviewMaxFiles: rc.gate.reviewMaxFiles.value,
      validators: rc.gate.validators.value,
      iterationTimeout: rc.gate.iterationTimeout.value,
    },
    prompt: {
      verbose: rc.prompt.verbose.value,
      preamble: rc.prompt.preamble.value,
      learnings: rc.prompt.learnings.value,
      commitStyle: rc.prompt.commitStyle.value,
    },
    pr: {
      draft: rc.pr.draft.value,
    },
    git: {
      branchPrefix: rc.git.branchPrefix.value,
    },
    issue: {
      source: rc.issue.source.value,
      standaloneLabel: rc.issue.standaloneLabel.value,
      subissueLabel: rc.issue.subissueLabel.value,
      prdLabel: rc.issue.prdLabel.value,
      repo: rc.issue.repo.value,
      commentProgress: rc.issue.commentProgress.value,
      hitlLabel: rc.issue.hitlLabel.value,
      inProgressLabel: rc.issue.inProgressLabel.value,
      doneLabel: rc.issue.doneLabel.value,
      stuckLabel: rc.issue.stuckLabel.value,
    },
    baseBranch: rc.baseBranch.value,
    sandbox: rc.sandbox.value,
    dockerImage: rc.dockerImage.value,
    dockerMounts: rc.dockerMounts.value,
    dockerEnvVars: rc.dockerEnvVars.value,
    workspaces: rc.workspaces.value,
  };
}

// ---------------------------------------------------------------------------
// Effective sandbox resolution
// ---------------------------------------------------------------------------

/** Result of resolving the effective sandbox value at runner start. */
export interface EffectiveSandboxResult {
  /** The sandbox mode to use for this run. */
  sandbox: "none" | "docker";
  /**
   * When set, the runner should exit with this error message.
   * Indicates the user explicitly requested Docker but it's unavailable.
   */
  error?: string;
}

/**
 * Resolve the effective sandbox value at runner start.
 *
 * When sandbox is "docker", re-checks Docker availability (it may have
 * become unavailable between config resolution and runner start):
 *
 * - **Auto-detected** (`sandboxSource === "auto-detected"`): silently falls
 *   back to `"none"` — the user never explicitly requested Docker.
 * - **Explicit** (config/env/CLI): returns an error — the user asked for
 *   Docker, so the failure is actionable.
 *
 * The `checkDocker` parameter allows injection for testing.
 */
export function computeEffectiveSandbox(
  cfg: Pick<ConfigValues, "sandbox">,
  sandboxSource: ConfigSource,
  checkDocker: () => { available: boolean; error?: string } = () => ({
    available: true,
  }),
): EffectiveSandboxResult {
  if (cfg.sandbox !== "docker") {
    return { sandbox: cfg.sandbox };
  }

  const dockerCheck = checkDocker();
  if (dockerCheck.available) {
    return { sandbox: "docker" };
  }

  // Docker unavailable — behaviour depends on how sandbox was set
  if (sandboxSource === "auto-detected") {
    return { sandbox: "none" };
  }

  return {
    sandbox: "docker",
    error: dockerCheck.error ?? "Docker is not available.",
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULTS: Readonly<RalphaiConfig> = {
  agent: {
    command: "",
    interactiveCommand: "",
    setupCommand: "",
  },
  hooks: {
    feedback: "",
    prFeedback: "",
    beforeRun: "",
    afterRun: "",
    feedbackTimeout: 300,
  },
  gate: {
    maxStuck: 3,
    review: true,
    maxRejections: 2,
    maxIterations: 0,
    reviewMaxFiles: 25,
    validators: "",
    iterationTimeout: 0,
  },
  prompt: {
    verbose: false,
    preamble: "",
    learnings: true,
    commitStyle: "conventional",
  },
  pr: {
    draft: true,
  },
  git: {
    branchPrefix: "",
  },
  issue: {
    source: "none",
    standaloneLabel: "ralphai-standalone",
    subissueLabel: "ralphai-subissue",
    prdLabel: "ralphai-prd",
    repo: "",
    commentProgress: true,
    hitlLabel: "ralphai-subissue-hitl",
    inProgressLabel: "in-progress",
    doneLabel: "done",
    stuckLabel: "stuck",
  },
  baseBranch: "main",
  sandbox: "none",
  dockerImage: "",
  dockerMounts: "",
  dockerEnvVars: "",

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
// Old-key migration mapping
// ---------------------------------------------------------------------------

/**
 * Map from old flat config key names to their new nested path.
 * Used by parseConfigFile() to detect stale configs and guide migration.
 */
const OLD_KEY_TO_NEW: Readonly<Record<string, string>> = {
  agentCommand: "agent.command",
  setupCommand: "agent.setupCommand",
  feedbackCommands: "hooks.feedback",
  prFeedbackCommands: "hooks.prFeedback",
  maxStuck: "gate.maxStuck",
  issueSource: "issue.source",
  standaloneLabel: "issue.standaloneLabel",
  subissueLabel: "issue.subissueLabel",
  prdLabel: "issue.prdLabel",
  issueRepo: "issue.repo",
  issueCommentProgress: "issue.commentProgress",
  issueHitlLabel: "issue.hitlLabel",
  agentInteractiveCommand: "agent.interactiveCommand",
  iterationTimeout: "gate.iterationTimeout",
  review: "gate.review",
  verbose: "prompt.verbose",
  promptMode: "(removed — no longer supported)",
};

// ---------------------------------------------------------------------------
// Config file parsing
// ---------------------------------------------------------------------------

/** Allowed top-level keys in nested config.json. */
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "agent",
  "hooks",
  "gate",
  "prompt",
  "pr",
  "git",
  "issue",
  "baseBranch",
  "sandbox",
  "dockerImage",
  "dockerMounts",
  "dockerEnvVars",

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

  function err(msg: string): never {
    throw new ConfigError(`${filePath}: ${msg}`);
  }

  // Detect old flat keys and throw with migration guidance
  for (const key of Object.keys(obj)) {
    if (key in OLD_KEY_TO_NEW) {
      const newPath = OLD_KEY_TO_NEW[key]!;
      err(
        `'${key}' is no longer a top-level key. Use '${newPath}' instead (e.g. { "${newPath.split(".")[0]}": { "${newPath.split(".")[1] ?? key}": ... } })`,
      );
    }
  }

  // Warn on unknown top-level keys
  const unknown = Object.keys(obj).filter(
    (k) => !ALLOWED_TOP_LEVEL_KEYS.has(k),
  );
  if (unknown.length > 0) {
    warnings.push(`${filePath}: ignoring unknown config key '${unknown[0]}'`);
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

  // --- agent group ---
  if ("agent" in obj) {
    const ag = obj.agent;
    if (ag === null || typeof ag !== "object" || Array.isArray(ag))
      err("'agent' must be an object");
    const agObj = ag as Record<string, unknown>;
    const agentValues: Partial<AgentConfig> = {};

    if ("command" in agObj) {
      const v = agObj.command;
      if (typeof v !== "string" || v === "")
        err("'agent.command' must be a non-empty string");
      agentValues.command = v;
    }
    if ("interactiveCommand" in agObj) {
      const v = agObj.interactiveCommand;
      if (typeof v !== "string")
        err(`'agent.interactiveCommand' must be a string, got ${typeof v}`);
      agentValues.interactiveCommand = v;
    }
    if ("setupCommand" in agObj) {
      const v = agObj.setupCommand;
      if (typeof v !== "string")
        err(`'agent.setupCommand' must be a string, got ${typeof v}`);
      agentValues.setupCommand = v;
    }

    if (Object.keys(agentValues).length > 0) {
      values.agent = { ...DEFAULTS.agent, ...agentValues };
    }
  }

  // --- hooks group ---
  if ("hooks" in obj) {
    const hk = obj.hooks;
    if (hk === null || typeof hk !== "object" || Array.isArray(hk))
      err("'hooks' must be an object");
    const hkObj = hk as Record<string, unknown>;
    const hooksValues: Partial<HooksConfig> = {};

    if ("feedback" in hkObj) {
      hooksValues.feedback = parseStringListField(
        "hooks.feedback",
        hkObj.feedback,
      );
    }
    if ("prFeedback" in hkObj) {
      hooksValues.prFeedback = parseStringListField(
        "hooks.prFeedback",
        hkObj.prFeedback,
      );
    }
    if ("beforeRun" in hkObj) {
      const v = hkObj.beforeRun;
      if (typeof v !== "string")
        err(`'hooks.beforeRun' must be a string, got ${typeof v}`);
      hooksValues.beforeRun = v;
    }
    if ("afterRun" in hkObj) {
      const v = hkObj.afterRun;
      if (typeof v !== "string")
        err(`'hooks.afterRun' must be a string, got ${typeof v}`);
      hooksValues.afterRun = v;
    }
    if ("feedbackTimeout" in hkObj) {
      const v = hkObj.feedbackTimeout;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
        err(
          `'hooks.feedbackTimeout' must be a non-negative integer (seconds), got '${v}'`,
        );
      hooksValues.feedbackTimeout = v;
    }

    if (Object.keys(hooksValues).length > 0) {
      values.hooks = { ...DEFAULTS.hooks, ...hooksValues };
    }
  }

  // --- gate group ---
  if ("gate" in obj) {
    const gt = obj.gate;
    if (gt === null || typeof gt !== "object" || Array.isArray(gt))
      err("'gate' must be an object");
    const gtObj = gt as Record<string, unknown>;
    const gateValues: Partial<GateConfig> = {};

    if ("maxStuck" in gtObj) {
      const v = gtObj.maxStuck;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
        err(`'gate.maxStuck' must be a positive integer, got '${v}'`);
      gateValues.maxStuck = v;
    }
    if ("review" in gtObj) {
      const v = gtObj.review;
      if (typeof v !== "boolean")
        err(`'gate.review' must be true or false, got '${v}'`);
      gateValues.review = v;
    }
    if ("maxRejections" in gtObj) {
      const v = gtObj.maxRejections;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
        err(`'gate.maxRejections' must be a non-negative integer, got '${v}'`);
      gateValues.maxRejections = v;
    }
    if ("maxIterations" in gtObj) {
      const v = gtObj.maxIterations;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
        err(`'gate.maxIterations' must be a non-negative integer, got '${v}'`);
      gateValues.maxIterations = v;
    }
    if ("reviewMaxFiles" in gtObj) {
      const v = gtObj.reviewMaxFiles;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
        err(`'gate.reviewMaxFiles' must be a positive integer, got '${v}'`);
      gateValues.reviewMaxFiles = v;
    }
    if ("validators" in gtObj) {
      const v = gtObj.validators;
      if (typeof v !== "string")
        err(`'gate.validators' must be a string, got ${typeof v}`);
      gateValues.validators = v;
    }
    if ("iterationTimeout" in gtObj) {
      const v = gtObj.iterationTimeout;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
        err(
          `'gate.iterationTimeout' must be a non-negative integer (seconds), got '${v}'`,
        );
      gateValues.iterationTimeout = v;
    }

    if (Object.keys(gateValues).length > 0) {
      values.gate = { ...DEFAULTS.gate, ...gateValues };
    }
  }

  // --- prompt group ---
  if ("prompt" in obj) {
    const pr = obj.prompt;
    if (pr === null || typeof pr !== "object" || Array.isArray(pr))
      err("'prompt' must be an object");
    const prObj = pr as Record<string, unknown>;
    const promptValues: Partial<PromptConfig> = {};

    if ("verbose" in prObj) {
      const v = prObj.verbose;
      if (typeof v !== "boolean")
        err(`'prompt.verbose' must be true or false, got '${v}'`);
      promptValues.verbose = v;
    }
    if ("preamble" in prObj) {
      const v = prObj.preamble;
      if (typeof v !== "string")
        err(`'prompt.preamble' must be a string, got ${typeof v}`);
      promptValues.preamble = v;
    }
    if ("learnings" in prObj) {
      const v = prObj.learnings;
      if (typeof v !== "boolean")
        err(`'prompt.learnings' must be true or false, got '${v}'`);
      promptValues.learnings = v;
    }
    if ("commitStyle" in prObj) {
      const v = prObj.commitStyle;
      if (typeof v !== "string")
        err(`'prompt.commitStyle' must be a string, got ${typeof v}`);
      promptValues.commitStyle = v;
    }

    if (Object.keys(promptValues).length > 0) {
      values.prompt = { ...DEFAULTS.prompt, ...promptValues };
    }
  }

  // --- pr group ---
  if ("pr" in obj) {
    const p = obj.pr;
    if (p === null || typeof p !== "object" || Array.isArray(p))
      err("'pr' must be an object");
    const pObj = p as Record<string, unknown>;
    const prValues: Partial<PrConfig> = {};

    if ("draft" in pObj) {
      const v = pObj.draft;
      if (typeof v !== "boolean")
        err(`'pr.draft' must be true or false, got '${v}'`);
      prValues.draft = v;
    }

    if (Object.keys(prValues).length > 0) {
      values.pr = { ...DEFAULTS.pr, ...prValues };
    }
  }

  // --- git group ---
  if ("git" in obj) {
    const g = obj.git;
    if (g === null || typeof g !== "object" || Array.isArray(g))
      err("'git' must be an object");
    const gObj = g as Record<string, unknown>;
    const gitValues: Partial<GitConfig> = {};

    if ("branchPrefix" in gObj) {
      const v = gObj.branchPrefix;
      if (typeof v !== "string")
        err(`'git.branchPrefix' must be a string, got ${typeof v}`);
      gitValues.branchPrefix = v;
    }

    if (Object.keys(gitValues).length > 0) {
      values.git = { ...DEFAULTS.git, ...gitValues };
    }
  }

  // --- issue group ---
  if ("issue" in obj) {
    const is = obj.issue;
    if (is === null || typeof is !== "object" || Array.isArray(is))
      err("'issue' must be an object");
    const isObj = is as Record<string, unknown>;
    const issueValues: Partial<IssueConfig> = {};

    if ("source" in isObj) {
      const v = String(isObj.source || "");
      if (!["none", "github"].includes(v))
        err(`'issue.source' must be 'none' or 'github', got '${v}'`);
      issueValues.source = v as IssueConfig["source"];
    }
    if ("standaloneLabel" in isObj) {
      const v = String(isObj.standaloneLabel || "");
      if (v === "")
        err("'issue.standaloneLabel' must be a non-empty label name");
      issueValues.standaloneLabel = v;
    }
    if ("subissueLabel" in isObj) {
      const v = String(isObj.subissueLabel || "");
      if (v === "") err("'issue.subissueLabel' must be a non-empty label name");
      issueValues.subissueLabel = v;
    }
    if ("prdLabel" in isObj) {
      const v = String(isObj.prdLabel || "");
      if (v === "") err("'issue.prdLabel' must be a non-empty label name");
      issueValues.prdLabel = v;
    }
    if ("repo" in isObj) {
      issueValues.repo = String(isObj.repo || "");
    }
    if ("commentProgress" in isObj) {
      const v = isObj.commentProgress;
      if (typeof v !== "boolean")
        err(`'issue.commentProgress' must be true or false, got '${v}'`);
      issueValues.commentProgress = v;
    }
    if ("hitlLabel" in isObj) {
      const v = String(isObj.hitlLabel || "");
      if (v === "") err("'issue.hitlLabel' must be a non-empty label name");
      issueValues.hitlLabel = v;
    }
    if ("inProgressLabel" in isObj) {
      const v = String(isObj.inProgressLabel || "");
      if (v === "")
        err("'issue.inProgressLabel' must be a non-empty label name");
      issueValues.inProgressLabel = v;
    }
    if ("doneLabel" in isObj) {
      const v = String(isObj.doneLabel || "");
      if (v === "") err("'issue.doneLabel' must be a non-empty label name");
      issueValues.doneLabel = v;
    }
    if ("stuckLabel" in isObj) {
      const v = String(isObj.stuckLabel || "");
      if (v === "") err("'issue.stuckLabel' must be a non-empty label name");
      issueValues.stuckLabel = v;
    }

    if (Object.keys(issueValues).length > 0) {
      values.issue = { ...DEFAULTS.issue, ...issueValues };
    }
  }

  // --- flat top-level keys ---

  // baseBranch (string, non-empty, no spaces)
  if ("baseBranch" in obj) {
    const v = String(obj.baseBranch || "");
    if (v === "") err("'baseBranch' must be a non-empty branch name");
    if (/\s/.test(v))
      err(`'baseBranch' must be a single token without spaces, got '${v}'`);
    values.baseBranch = v;
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
      if ("validators" in entryObj) {
        const v = entryObj.validators;
        if (!Array.isArray(v) && typeof v !== "string")
          err(
            `workspaces['${k}'].validators must be an array of strings or a comma-separated string, got ${typeof v}`,
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
 * Uses RALPHAI_<GROUP>_<KEY> naming convention.
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

  // --- agent group ---
  const agentCmd = get("RALPHAI_AGENT_COMMAND");
  const agentSetupCmd = get("RALPHAI_AGENT_SETUP_COMMAND");
  const agentInteractiveCmd = get("RALPHAI_AGENT_INTERACTIVE_COMMAND");

  if (
    agentCmd !== undefined ||
    agentSetupCmd !== undefined ||
    agentInteractiveCmd !== undefined
  ) {
    const agentOverrides: Partial<AgentConfig> = {};
    if (agentCmd !== undefined) agentOverrides.command = agentCmd;
    if (agentSetupCmd !== undefined)
      agentOverrides.setupCommand = agentSetupCmd;
    if (agentInteractiveCmd !== undefined)
      agentOverrides.interactiveCommand = agentInteractiveCmd;
    overrides.agent = { ...DEFAULTS.agent, ...agentOverrides };
  }

  // --- hooks group ---
  const hooksFeedback = get("RALPHAI_HOOKS_FEEDBACK");
  const hooksPrFeedback = get("RALPHAI_HOOKS_PR_FEEDBACK");
  const hooksBeforeRun = get("RALPHAI_HOOKS_BEFORE_RUN");
  const hooksAfterRun = get("RALPHAI_HOOKS_AFTER_RUN");
  const hooksFeedbackTimeout = get("RALPHAI_HOOKS_FEEDBACK_TIMEOUT");

  if (
    hooksFeedback !== undefined ||
    hooksPrFeedback !== undefined ||
    hooksBeforeRun !== undefined ||
    hooksAfterRun !== undefined ||
    hooksFeedbackTimeout !== undefined
  ) {
    const hooksOverrides: Partial<HooksConfig> = {};
    if (hooksFeedback !== undefined) hooksOverrides.feedback = hooksFeedback;
    if (hooksPrFeedback !== undefined)
      hooksOverrides.prFeedback = hooksPrFeedback;
    if (hooksBeforeRun !== undefined) hooksOverrides.beforeRun = hooksBeforeRun;
    if (hooksAfterRun !== undefined) hooksOverrides.afterRun = hooksAfterRun;
    if (hooksFeedbackTimeout !== undefined) {
      validateNonNegInt(
        hooksFeedbackTimeout,
        "RALPHAI_HOOKS_FEEDBACK_TIMEOUT",
        "seconds",
      );
      hooksOverrides.feedbackTimeout = parseInt(hooksFeedbackTimeout, 10);
    }
    overrides.hooks = { ...DEFAULTS.hooks, ...hooksOverrides };
  }

  // --- gate group ---
  const gateMaxStuck = get("RALPHAI_GATE_MAX_STUCK");
  const gateReview = get("RALPHAI_GATE_REVIEW");
  const gateMaxRejections = get("RALPHAI_GATE_MAX_REJECTIONS");
  const gateMaxIterations = get("RALPHAI_GATE_MAX_ITERATIONS");
  const gateReviewMaxFiles = get("RALPHAI_GATE_REVIEW_MAX_FILES");
  const gateValidators = get("RALPHAI_GATE_VALIDATORS");
  const gateIterationTimeout = get("RALPHAI_GATE_ITERATION_TIMEOUT");

  if (
    gateMaxStuck !== undefined ||
    gateReview !== undefined ||
    gateMaxRejections !== undefined ||
    gateMaxIterations !== undefined ||
    gateReviewMaxFiles !== undefined ||
    gateValidators !== undefined ||
    gateIterationTimeout !== undefined
  ) {
    const gateOverrides: Partial<GateConfig> = {};
    if (gateMaxStuck !== undefined) {
      validatePositiveInt(gateMaxStuck, "RALPHAI_GATE_MAX_STUCK");
      gateOverrides.maxStuck = parseInt(gateMaxStuck, 10);
    }
    if (gateReview !== undefined) {
      validateBoolean(gateReview, "RALPHAI_GATE_REVIEW");
      gateOverrides.review = gateReview === "true";
    }
    if (gateMaxRejections !== undefined) {
      validateNonNegInt(gateMaxRejections, "RALPHAI_GATE_MAX_REJECTIONS");
      gateOverrides.maxRejections = parseInt(gateMaxRejections, 10);
    }
    if (gateMaxIterations !== undefined) {
      validateNonNegInt(gateMaxIterations, "RALPHAI_GATE_MAX_ITERATIONS");
      gateOverrides.maxIterations = parseInt(gateMaxIterations, 10);
    }
    if (gateReviewMaxFiles !== undefined) {
      validatePositiveInt(gateReviewMaxFiles, "RALPHAI_GATE_REVIEW_MAX_FILES");
      gateOverrides.reviewMaxFiles = parseInt(gateReviewMaxFiles, 10);
    }
    if (gateValidators !== undefined) {
      gateOverrides.validators = gateValidators;
    }
    if (gateIterationTimeout !== undefined) {
      validateNonNegInt(
        gateIterationTimeout,
        "RALPHAI_GATE_ITERATION_TIMEOUT",
        "seconds",
      );
      gateOverrides.iterationTimeout = parseInt(gateIterationTimeout, 10);
    }
    overrides.gate = { ...DEFAULTS.gate, ...gateOverrides };
  }

  // --- prompt group ---
  const promptVerbose = get("RALPHAI_PROMPT_VERBOSE");
  const promptPreamble = get("RALPHAI_PROMPT_PREAMBLE");
  const promptLearnings = get("RALPHAI_PROMPT_LEARNINGS");
  const promptCommitStyle = get("RALPHAI_PROMPT_COMMIT_STYLE");

  if (
    promptVerbose !== undefined ||
    promptPreamble !== undefined ||
    promptLearnings !== undefined ||
    promptCommitStyle !== undefined
  ) {
    const promptOverrides: Partial<PromptConfig> = {};
    if (promptVerbose !== undefined) {
      validateBoolean(promptVerbose, "RALPHAI_PROMPT_VERBOSE");
      promptOverrides.verbose = promptVerbose === "true";
    }
    if (promptPreamble !== undefined) promptOverrides.preamble = promptPreamble;
    if (promptLearnings !== undefined) {
      validateBoolean(promptLearnings, "RALPHAI_PROMPT_LEARNINGS");
      promptOverrides.learnings = promptLearnings === "true";
    }
    if (promptCommitStyle !== undefined)
      promptOverrides.commitStyle = promptCommitStyle;
    overrides.prompt = { ...DEFAULTS.prompt, ...promptOverrides };
  }

  // --- pr group ---
  const prDraft = get("RALPHAI_PR_DRAFT");
  if (prDraft !== undefined) {
    validateBoolean(prDraft, "RALPHAI_PR_DRAFT");
    overrides.pr = { ...DEFAULTS.pr, draft: prDraft === "true" };
  }

  // --- git group ---
  const gitBranchPrefix = get("RALPHAI_GIT_BRANCH_PREFIX");
  if (gitBranchPrefix !== undefined) {
    overrides.git = { ...DEFAULTS.git, branchPrefix: gitBranchPrefix };
  }

  // --- issue group ---
  const issueSource = get("RALPHAI_ISSUE_SOURCE");
  const issueStandaloneLabel = get("RALPHAI_ISSUE_STANDALONE_LABEL");
  const issueSubissueLabel = get("RALPHAI_ISSUE_SUBISSUE_LABEL");
  const issuePrdLabel = get("RALPHAI_ISSUE_PRD_LABEL");
  const issueRepo = get("RALPHAI_ISSUE_REPO");
  const issueCommentProgress = get("RALPHAI_ISSUE_COMMENT_PROGRESS");
  const issueHitlLabel = get("RALPHAI_ISSUE_HITL_LABEL");
  const issueInProgressLabel = get("RALPHAI_ISSUE_IN_PROGRESS_LABEL");
  const issueDoneLabel = get("RALPHAI_ISSUE_DONE_LABEL");
  const issueStuckLabel = get("RALPHAI_ISSUE_STUCK_LABEL");

  if (
    issueSource !== undefined ||
    issueStandaloneLabel !== undefined ||
    issueSubissueLabel !== undefined ||
    issuePrdLabel !== undefined ||
    issueRepo !== undefined ||
    issueCommentProgress !== undefined ||
    issueHitlLabel !== undefined ||
    issueInProgressLabel !== undefined ||
    issueDoneLabel !== undefined ||
    issueStuckLabel !== undefined
  ) {
    const issueOverrides: Partial<IssueConfig> = {};
    if (issueSource !== undefined) {
      validateEnum(issueSource, "RALPHAI_ISSUE_SOURCE", ["none", "github"]);
      issueOverrides.source = issueSource as IssueConfig["source"];
    }
    if (issueStandaloneLabel !== undefined)
      issueOverrides.standaloneLabel = issueStandaloneLabel;
    if (issueSubissueLabel !== undefined)
      issueOverrides.subissueLabel = issueSubissueLabel;
    if (issuePrdLabel !== undefined) issueOverrides.prdLabel = issuePrdLabel;
    if (issueRepo !== undefined) issueOverrides.repo = issueRepo;
    if (issueCommentProgress !== undefined) {
      validateBoolean(issueCommentProgress, "RALPHAI_ISSUE_COMMENT_PROGRESS");
      issueOverrides.commentProgress = issueCommentProgress === "true";
    }
    if (issueHitlLabel !== undefined) issueOverrides.hitlLabel = issueHitlLabel;
    if (issueInProgressLabel !== undefined)
      issueOverrides.inProgressLabel = issueInProgressLabel;
    if (issueDoneLabel !== undefined) issueOverrides.doneLabel = issueDoneLabel;
    if (issueStuckLabel !== undefined)
      issueOverrides.stuckLabel = issueStuckLabel;
    overrides.issue = { ...DEFAULTS.issue, ...issueOverrides };
  }

  // --- flat top-level keys ---

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

  return overrides;
}

// ---------------------------------------------------------------------------
// CLI arg parsing (config-relevant portion only)
// ---------------------------------------------------------------------------

/** Parsed CLI arguments relevant to config resolution. */
export interface ParsedCLIArgs {
  overrides: Partial<RalphaiConfig>;
  /** Raw CLI flag strings for --show-config source labels. */
  rawFlags: Record<string, string>;
}

/**
 * Parse config-related CLI flags from the argument list.
 * Non-config flags (--dry-run, --resume, etc.) are ignored here.
 *
 * CLI flags use --<group>-<key> naming, e.g. --hooks-feedback=,
 * --gate-max-stuck=, --agent-command=.
 */
export function parseCLIArgs(args: readonly string[]): ParsedCLIArgs {
  const overrides: Partial<RalphaiConfig> = {};
  const rawFlags: Record<string, string> = {};

  /** Ensure overrides.agent exists, merging with defaults. */
  function ensureAgent(): AgentConfig {
    if (!overrides.agent) overrides.agent = { ...DEFAULTS.agent };
    return overrides.agent;
  }
  function ensureHooks(): HooksConfig {
    if (!overrides.hooks) overrides.hooks = { ...DEFAULTS.hooks };
    return overrides.hooks;
  }
  function ensureGate(): GateConfig {
    if (!overrides.gate) overrides.gate = { ...DEFAULTS.gate };
    return overrides.gate;
  }
  function ensurePrompt(): PromptConfig {
    if (!overrides.prompt) overrides.prompt = { ...DEFAULTS.prompt };
    return overrides.prompt;
  }
  function ensurePr(): PrConfig {
    if (!overrides.pr) overrides.pr = { ...DEFAULTS.pr };
    return overrides.pr;
  }
  function ensureGit(): GitConfig {
    if (!overrides.git) overrides.git = { ...DEFAULTS.git };
    return overrides.git;
  }
  function ensureIssue(): IssueConfig {
    if (!overrides.issue) overrides.issue = { ...DEFAULTS.issue };
    return overrides.issue;
  }

  for (const arg of args) {
    // --- agent group ---
    if (arg.startsWith("--agent-command=")) {
      const v = arg.slice("--agent-command=".length);
      if (v === "") {
        throw new ConfigError(
          "ERROR: --agent-command requires a non-empty value (e.g. --agent-command='claude -p')",
        );
      }
      ensureAgent().command = v;
      rawFlags["agent.command"] = arg;
    } else if (arg.startsWith("--agent-setup-command=")) {
      const v = arg.slice("--agent-setup-command=".length);
      ensureAgent().setupCommand = v;
      rawFlags["agent.setupCommand"] = arg;
    } else if (arg.startsWith("--agent-interactive-command=")) {
      const v = arg.slice("--agent-interactive-command=".length);
      ensureAgent().interactiveCommand = v;
      rawFlags["agent.interactiveCommand"] = arg;

      // --- hooks group ---
    } else if (arg.startsWith("--hooks-feedback=")) {
      const v = arg.slice("--hooks-feedback=".length);
      if (v !== "") validateCommaList(v, "--hooks-feedback");
      ensureHooks().feedback = v;
      rawFlags["hooks.feedback"] = arg;
    } else if (arg.startsWith("--hooks-pr-feedback=")) {
      const v = arg.slice("--hooks-pr-feedback=".length);
      if (v !== "") validateCommaList(v, "--hooks-pr-feedback");
      ensureHooks().prFeedback = v;
      rawFlags["hooks.prFeedback"] = arg;
    } else if (arg.startsWith("--hooks-before-run=")) {
      const v = arg.slice("--hooks-before-run=".length);
      ensureHooks().beforeRun = v;
      rawFlags["hooks.beforeRun"] = arg;
    } else if (arg.startsWith("--hooks-after-run=")) {
      const v = arg.slice("--hooks-after-run=".length);
      ensureHooks().afterRun = v;
      rawFlags["hooks.afterRun"] = arg;
    } else if (arg.startsWith("--hooks-feedback-timeout=")) {
      const v = arg.slice("--hooks-feedback-timeout=".length);
      validateNonNegInt(v, "--hooks-feedback-timeout", "seconds");
      ensureHooks().feedbackTimeout = parseInt(v, 10);
      rawFlags["hooks.feedbackTimeout"] = arg;

      // --- gate group ---
    } else if (arg.startsWith("--gate-max-stuck=")) {
      const v = arg.slice("--gate-max-stuck=".length);
      validatePositiveInt(v, "--gate-max-stuck");
      ensureGate().maxStuck = parseInt(v, 10);
      rawFlags["gate.maxStuck"] = arg;
    } else if (arg === "--gate-review") {
      ensureGate().review = true;
      rawFlags["gate.review"] = "--gate-review";
    } else if (arg === "--gate-no-review") {
      ensureGate().review = false;
      rawFlags["gate.review"] = "--gate-no-review";
    } else if (arg.startsWith("--gate-max-rejections=")) {
      const v = arg.slice("--gate-max-rejections=".length);
      validateNonNegInt(v, "--gate-max-rejections");
      ensureGate().maxRejections = parseInt(v, 10);
      rawFlags["gate.maxRejections"] = arg;
    } else if (arg.startsWith("--gate-max-iterations=")) {
      const v = arg.slice("--gate-max-iterations=".length);
      validateNonNegInt(v, "--gate-max-iterations");
      ensureGate().maxIterations = parseInt(v, 10);
      rawFlags["gate.maxIterations"] = arg;
    } else if (arg.startsWith("--gate-review-max-files=")) {
      const v = arg.slice("--gate-review-max-files=".length);
      validatePositiveInt(v, "--gate-review-max-files");
      ensureGate().reviewMaxFiles = parseInt(v, 10);
      rawFlags["gate.reviewMaxFiles"] = arg;
    } else if (arg.startsWith("--gate-validators=")) {
      const v = arg.slice("--gate-validators=".length);
      ensureGate().validators = v;
      rawFlags["gate.validators"] = arg;
    } else if (arg.startsWith("--gate-iteration-timeout=")) {
      const v = arg.slice("--gate-iteration-timeout=".length);
      validateNonNegInt(v, "--gate-iteration-timeout", "seconds");
      ensureGate().iterationTimeout = parseInt(v, 10);
      rawFlags["gate.iterationTimeout"] = arg;

      // --- prompt group ---
    } else if (arg === "--prompt-verbose") {
      ensurePrompt().verbose = true;
      rawFlags["prompt.verbose"] = "--prompt-verbose";
    } else if (arg.startsWith("--prompt-preamble=")) {
      const v = arg.slice("--prompt-preamble=".length);
      ensurePrompt().preamble = v;
      rawFlags["prompt.preamble"] = arg;
    } else if (arg === "--prompt-learnings") {
      ensurePrompt().learnings = true;
      rawFlags["prompt.learnings"] = "--prompt-learnings";
    } else if (arg === "--no-prompt-learnings") {
      ensurePrompt().learnings = false;
      rawFlags["prompt.learnings"] = "--no-prompt-learnings";
    } else if (arg.startsWith("--prompt-commit-style=")) {
      const v = arg.slice("--prompt-commit-style=".length);
      ensurePrompt().commitStyle = v;
      rawFlags["prompt.commitStyle"] = arg;

      // --- pr group ---
    } else if (arg === "--pr-draft") {
      ensurePr().draft = true;
      rawFlags["pr.draft"] = "--pr-draft";
    } else if (arg === "--no-pr-draft") {
      ensurePr().draft = false;
      rawFlags["pr.draft"] = "--no-pr-draft";

      // --- git group ---
    } else if (arg.startsWith("--git-branch-prefix=")) {
      const v = arg.slice("--git-branch-prefix=".length);
      ensureGit().branchPrefix = v;
      rawFlags["git.branchPrefix"] = arg;

      // --- issue group ---
    } else if (arg.startsWith("--issue-hitl-label=")) {
      const v = arg.slice("--issue-hitl-label=".length);
      if (v === "") {
        throw new ConfigError(
          "ERROR: --issue-hitl-label requires a non-empty value (e.g. --issue-hitl-label='ralphai-subissue-hitl')",
        );
      }
      ensureIssue().hitlLabel = v;
      rawFlags["issue.hitlLabel"] = arg;

      // --- flat top-level keys ---
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
      rawFlags["baseBranch"] = arg;
    } else if (arg.startsWith("--sandbox=")) {
      const v = arg.slice("--sandbox=".length);
      validateEnum(v, "--sandbox", ["none", "docker"]);
      overrides.sandbox = v as RalphaiConfig["sandbox"];
      rawFlags["sandbox"] = arg;
    } else if (arg.startsWith("--docker-image=")) {
      const v = arg.slice("--docker-image=".length);
      overrides.dockerImage = v;
      rawFlags["dockerImage"] = arg;
    } else if (arg.startsWith("--docker-mounts=")) {
      const v = arg.slice("--docker-mounts=".length);
      if (v !== "") validateCommaList(v, "--docker-mounts");
      overrides.dockerMounts = v;
      rawFlags["dockerMounts"] = arg;
    } else if (arg.startsWith("--docker-env-vars=")) {
      const v = arg.slice("--docker-env-vars=".length);
      if (v !== "") validateCommaList(v, "--docker-env-vars");
      overrides.dockerEnvVars = v;
      rawFlags["dockerEnvVars"] = arg;
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
 * Build a fresh ResolvedConfig from DEFAULTS, with every leaf set to
 * source "default".
 */
function buildDefaultResolved(): ResolvedConfig {
  function wrapGroup<T extends object>(group: T): ResolvedGroup<T> {
    const out: Record<string, ResolvedValue<unknown>> = {};
    for (const [k, v] of Object.entries(group)) {
      out[k] = { value: v, source: "default" as ConfigSource };
    }
    return out as ResolvedGroup<T>;
  }

  return {
    agent: wrapGroup(DEFAULTS.agent),
    hooks: wrapGroup(DEFAULTS.hooks),
    gate: wrapGroup(DEFAULTS.gate),
    prompt: wrapGroup(DEFAULTS.prompt),
    pr: wrapGroup(DEFAULTS.pr),
    git: wrapGroup(DEFAULTS.git),
    issue: wrapGroup(DEFAULTS.issue),
    baseBranch: { value: DEFAULTS.baseBranch, source: "default" },
    sandbox: { value: DEFAULTS.sandbox, source: "default" },
    dockerImage: { value: DEFAULTS.dockerImage, source: "default" },
    dockerMounts: { value: DEFAULTS.dockerMounts, source: "default" },
    dockerEnvVars: { value: DEFAULTS.dockerEnvVars, source: "default" },
    workspaces: { value: DEFAULTS.workspaces, source: "default" },
  };
}

/** Apply a group override: only override keys that differ from defaults. */
function applyGroupOverride<T extends object>(
  target: ResolvedGroup<T>,
  defaults: T,
  override: T,
  source: ConfigSource,
): void {
  for (const key of Object.keys(override) as Array<keyof T & string>) {
    if (override[key] !== defaults[key] || source !== "default") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (target as any)[key] = { value: override[key], source };
    }
  }
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
  const resolved = buildDefaultResolved();

  // Helper to apply a partial RalphaiConfig override at a given source
  function applyPartial(
    partial: Partial<RalphaiConfig>,
    source: ConfigSource,
  ): void {
    if (partial.agent)
      applyGroupOverride(resolved.agent, DEFAULTS.agent, partial.agent, source);
    if (partial.hooks)
      applyGroupOverride(resolved.hooks, DEFAULTS.hooks, partial.hooks, source);
    if (partial.gate)
      applyGroupOverride(resolved.gate, DEFAULTS.gate, partial.gate, source);
    if (partial.prompt)
      applyGroupOverride(
        resolved.prompt,
        DEFAULTS.prompt,
        partial.prompt,
        source,
      );
    if (partial.pr)
      applyGroupOverride(resolved.pr, DEFAULTS.pr, partial.pr, source);
    if (partial.git)
      applyGroupOverride(resolved.git, DEFAULTS.git, partial.git, source);
    if (partial.issue)
      applyGroupOverride(resolved.issue, DEFAULTS.issue, partial.issue, source);
    if (partial.baseBranch !== undefined)
      resolved.baseBranch = { value: partial.baseBranch, source };
    if (partial.sandbox !== undefined)
      resolved.sandbox = { value: partial.sandbox, source };
    if (partial.dockerImage !== undefined)
      resolved.dockerImage = { value: partial.dockerImage, source };
    if (partial.dockerMounts !== undefined)
      resolved.dockerMounts = { value: partial.dockerMounts, source };
    if (partial.dockerEnvVars !== undefined)
      resolved.dockerEnvVars = { value: partial.dockerEnvVars, source };
    if (partial.workspaces !== undefined)
      resolved.workspaces = { value: partial.workspaces, source };
  }

  // Layer 2: config file
  const parsed = parseConfigFile(configFilePath);
  if (parsed) {
    warnings.push(...parsed.warnings);
    applyPartial(parsed.values, "config");
  }

  // Layer 3: env vars
  const envOverrides = applyEnvOverrides(envVars);
  applyPartial(envOverrides, "env");

  // Layer 4: CLI args
  const { overrides: cliOverrides } = parseCLIArgs(cliArgs);
  applyPartial(cliOverrides, "cli");

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
