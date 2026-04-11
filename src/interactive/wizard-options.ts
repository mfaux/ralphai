/**
 * Wizard options — pure data layer.
 *
 * Provides two pure functions:
 *   1. buildWizardOptions — produces display-ready option descriptors from a
 *      ResolvedConfig for the wizard-eligible config keys.
 *   2. selectionsToFlags — converts a map of config key → new value into
 *      synthetic CLI flag strings accepted by parseCLIArgs().
 */

import type { ConfigSource, ResolvedConfig } from "../config.ts";
import { configValues } from "../config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Prompt type metadata for each wizard option. */
export type PromptType =
  | {
      kind: "text";
      validate?: (value: string | undefined) => string | undefined;
    }
  | { kind: "select"; choices: readonly string[] };

/** A single wizard option descriptor. */
export interface WizardOption {
  /** Config key path (e.g. "agent.command"). */
  key: WizardConfigKey;
  /** Human-readable label shown in the multi-select. */
  label: string;
  /** Current resolved value (as a display string). */
  currentValue: string;
  /** Human-readable source hint (e.g. "config file", "default"). */
  sourceHint: string;
  /** Prompt type metadata. */
  prompt: PromptType;
}

/** The config keys that the wizard can modify. */
export type WizardConfigKey = (typeof WIZARD_KEYS)[number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered list of wizard-eligible config keys (dot-path notation). */
export const WIZARD_KEYS = [
  "agent.command",
  "agent.setupCommand",
  "hooks.feedback",
  "hooks.prFeedback",
  "baseBranch",
  "gate.maxStuck",
  "gate.iterationTimeout",
  "sandbox",
] as const;

/** Map ConfigSource to human-readable hint text. */
const SOURCE_HINTS: Record<ConfigSource, string> = {
  default: "default",
  "auto-detected": "auto-detected",
  config: "config file",
  env: "env var",
  cli: "CLI flag",
};

/** Map config key path to the CLI flag name (without leading --). */
const FLAG_NAMES: Record<WizardConfigKey, string> = {
  "agent.command": "agent-command",
  "agent.setupCommand": "agent-setup-command",
  "hooks.feedback": "hooks-feedback",
  "hooks.prFeedback": "hooks-pr-feedback",
  baseBranch: "base-branch",
  "gate.maxStuck": "gate-max-stuck",
  "gate.iterationTimeout": "gate-iteration-timeout",
  sandbox: "sandbox",
};

/** Human-readable labels for each wizard key. */
const LABELS: Record<WizardConfigKey, string> = {
  "agent.command": "Agent command",
  "agent.setupCommand": "Setup command",
  "hooks.feedback": "Feedback commands",
  "hooks.prFeedback": "PR feedback commands",
  baseBranch: "Base branch",
  "gate.maxStuck": "Max stuck iterations",
  "gate.iterationTimeout": "Iteration timeout (seconds)",
  sandbox: "Sandbox mode",
};

// ---------------------------------------------------------------------------
// Value / source accessors
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path key to its current value in a ConfigValues object.
 */
function getConfigValue(
  cfg: ReturnType<typeof configValues>,
  key: WizardConfigKey,
): string | number | boolean {
  switch (key) {
    case "agent.command":
      return cfg.agent.command;
    case "agent.setupCommand":
      return cfg.agent.setupCommand;
    case "hooks.feedback":
      return cfg.hooks.feedback;
    case "hooks.prFeedback":
      return cfg.hooks.prFeedback;
    case "baseBranch":
      return cfg.baseBranch;
    case "gate.maxStuck":
      return cfg.gate.maxStuck;
    case "gate.iterationTimeout":
      return cfg.gate.iterationTimeout;
    case "sandbox":
      return cfg.sandbox;
  }
}

/**
 * Resolve a dot-path key to its ConfigSource in a ResolvedConfig.
 */
function getConfigSource(
  config: ResolvedConfig,
  key: WizardConfigKey,
): ConfigSource {
  switch (key) {
    case "agent.command":
      return config.agent.command.source;
    case "agent.setupCommand":
      return config.agent.setupCommand.source;
    case "hooks.feedback":
      return config.hooks.feedback.source;
    case "hooks.prFeedback":
      return config.hooks.prFeedback.source;
    case "baseBranch":
      return config.baseBranch.source;
    case "gate.maxStuck":
      return config.gate.maxStuck.source;
    case "gate.iterationTimeout":
      return config.gate.iterationTimeout.source;
    case "sandbox":
      return config.sandbox.source;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate that a string is a positive integer (>= 1). */
function validatePositiveInt(value: string | undefined): string | undefined {
  if (!value || !/^\d+$/.test(value) || parseInt(value, 10) < 1) {
    return "Must be a positive integer (>= 1)";
  }
  return undefined;
}

/** Validate that a string is a non-negative integer (>= 0). */
function validateNonNegInt(value: string | undefined): string | undefined {
  if (!value || !/^\d+$/.test(value) || parseInt(value, 10) < 0) {
    return "Must be a non-negative integer (>= 0)";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Option list builder
// ---------------------------------------------------------------------------

/** Build prompt metadata for a given wizard key. */
function buildPrompt(key: WizardConfigKey): PromptType {
  switch (key) {
    case "gate.maxStuck":
      return { kind: "text", validate: validatePositiveInt };
    case "gate.iterationTimeout":
      return { kind: "text", validate: validateNonNegInt };
    case "sandbox":
      return { kind: "select", choices: ["none", "docker"] };
    default:
      return { kind: "text" };
  }
}

/**
 * Build an array of wizard option descriptors from a ResolvedConfig.
 *
 * Each descriptor includes the config key path, a human-readable label,
 * the current resolved value (as a display string), a source hint, and
 * prompt metadata.
 */
export function buildWizardOptions(config: ResolvedConfig): WizardOption[] {
  const cfg = configValues(config);
  return WIZARD_KEYS.map((key) => {
    return {
      key,
      label: LABELS[key],
      currentValue: String(getConfigValue(cfg, key)),
      sourceHint: SOURCE_HINTS[getConfigSource(config, key)],
      prompt: buildPrompt(key),
    };
  });
}

// ---------------------------------------------------------------------------
// Selections-to-flags converter
// ---------------------------------------------------------------------------

/**
 * Convert a map of config key → new value into an array of synthetic CLI flag
 * strings that parseCLIArgs() would accept.
 *
 * Each key produces "--<flag-name>=<value>".
 */
export function selectionsToFlags(
  selections: Partial<Record<WizardConfigKey, string>>,
): string[] {
  const flags: string[] = [];

  for (const key of WIZARD_KEYS) {
    const value = selections[key];
    if (value === undefined) continue;

    flags.push(`--${FLAG_NAMES[key]}=${value}`);
  }

  return flags;
}
