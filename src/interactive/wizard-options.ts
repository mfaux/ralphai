/**
 * Wizard options — pure data layer.
 *
 * Provides two pure functions:
 *   1. buildWizardOptions — produces display-ready option descriptors from a
 *      ResolvedConfig for the 7 wizard-eligible config keys.
 *   2. selectionsToFlags — converts a map of config key → new value into
 *      synthetic CLI flag strings accepted by parseCLIArgs().
 */

import type { ConfigSource, ResolvedConfig, RalphaiConfig } from "../config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Prompt type metadata for each wizard option. */
export type PromptType =
  | { kind: "text"; validate?: (value: string) => string | undefined }
  | { kind: "select"; choices: readonly string[] };

/** A single wizard option descriptor. */
export interface WizardOption {
  /** Config key name (e.g. "agentCommand"). */
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

/** The 7 config keys that the wizard can modify. */
export type WizardConfigKey = (typeof WIZARD_KEYS)[number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered list of wizard-eligible config keys. */
export const WIZARD_KEYS = [
  "agentCommand",
  "setupCommand",
  "feedbackCommands",
  "prFeedbackCommands",
  "baseBranch",
  "maxStuck",
  "iterationTimeout",
  "autoCommit",
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

/** Map config key to the CLI flag name (without leading --). */
const FLAG_NAMES: Record<WizardConfigKey, string> = {
  agentCommand: "agent-command",
  setupCommand: "setup-command",
  feedbackCommands: "feedback-commands",
  prFeedbackCommands: "pr-feedback-commands",
  baseBranch: "base-branch",
  maxStuck: "max-stuck",
  iterationTimeout: "iteration-timeout",
  autoCommit: "auto-commit",
  sandbox: "sandbox",
};

/** Human-readable labels for each wizard key. */
const LABELS: Record<WizardConfigKey, string> = {
  agentCommand: "Agent command",
  setupCommand: "Setup command",
  feedbackCommands: "Feedback commands",
  prFeedbackCommands: "PR feedback commands",
  baseBranch: "Base branch",
  maxStuck: "Max stuck iterations",
  iterationTimeout: "Iteration timeout (seconds)",
  autoCommit: "Auto-commit",
  sandbox: "Sandbox mode",
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate that a string is a positive integer (>= 1). */
function validatePositiveInt(value: string): string | undefined {
  if (!/^\d+$/.test(value) || parseInt(value, 10) < 1) {
    return "Must be a positive integer (>= 1)";
  }
  return undefined;
}

/** Validate that a string is a non-negative integer (>= 0). */
function validateNonNegInt(value: string): string | undefined {
  if (!/^\d+$/.test(value) || parseInt(value, 10) < 0) {
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
    case "maxStuck":
      return { kind: "text", validate: validatePositiveInt };
    case "iterationTimeout":
      return { kind: "text", validate: validateNonNegInt };
    case "autoCommit":
      return { kind: "select", choices: ["true", "false"] };
    case "sandbox":
      return { kind: "select", choices: ["none", "docker"] };
    default:
      return { kind: "text" };
  }
}

/**
 * Build an array of wizard option descriptors from a ResolvedConfig.
 *
 * Each descriptor includes the config key, a human-readable label, the current
 * resolved value (as a display string), a source hint, and prompt metadata.
 */
export function buildWizardOptions(config: ResolvedConfig): WizardOption[] {
  return WIZARD_KEYS.map((key) => {
    const resolved = config[key];
    return {
      key,
      label: LABELS[key],
      currentValue: String(resolved.value),
      sourceHint: SOURCE_HINTS[resolved.source],
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
 * Special cases:
 *   - autoCommit: "true" → "--auto-commit", "false" → "--no-auto-commit"
 *   - All other keys: "--<flag-name>=<value>"
 */
export function selectionsToFlags(
  selections: Partial<Record<WizardConfigKey, string>>,
): string[] {
  const flags: string[] = [];

  for (const key of WIZARD_KEYS) {
    const value = selections[key];
    if (value === undefined) continue;

    if (key === "autoCommit") {
      flags.push(value === "true" ? "--auto-commit" : "--no-auto-commit");
    } else {
      flags.push(`--${FLAG_NAMES[key]}=${value}`);
    }
  }

  return flags;
}
