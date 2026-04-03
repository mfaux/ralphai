/**
 * Interactive run wizard — `ralphai run --wizard`.
 *
 * Orchestrates a clack-based interactive flow that lets the user override
 * config options before a run. Uses the pure data layer from wizard-options.ts
 * for option metadata and flag conversion.
 *
 * Returns an array of synthetic CLI flag strings (or empty if the user selects
 * nothing or cancels).
 */

import * as clack from "@clack/prompts";
import type { ResolvedConfig } from "../config.ts";
import {
  buildWizardOptions,
  selectionsToFlags,
  type WizardConfigKey,
  type WizardOption,
} from "./wizard-options.ts";

/**
 * Run the interactive config wizard.
 *
 * Shows a multiselect of all wizard-eligible config options (with current
 * values and sources), then prompts for each selected option using the
 * appropriate input type.
 *
 * @returns Synthetic CLI flag strings to prepend to runArgs, or an empty
 *   array if the user selects nothing. Returns `null` if the user cancels
 *   (Ctrl+C).
 */
export async function runConfigWizard(
  config: ResolvedConfig,
): Promise<string[] | null> {
  const options = buildWizardOptions(config);

  clack.intro("Configure run options");

  // --- Step 1: multi-select which options to override ---
  const selected = await clack.multiselect<WizardConfigKey>({
    message: "Which options would you like to change?",
    options: options.map((opt) => ({
      value: opt.key,
      label: opt.label,
      hint: `${opt.currentValue} (${opt.sourceHint})`,
    })),
    required: false,
  });

  if (clack.isCancel(selected)) {
    clack.cancel("Wizard cancelled.");
    return null;
  }

  // Nothing selected — proceed with current config
  if (selected.length === 0) {
    clack.outro("No changes — proceeding with current config.");
    return [];
  }

  // --- Step 2: prompt for each selected option ---
  const selections: Partial<Record<WizardConfigKey, string>> = {};
  const optionsByKey = new Map(options.map((o) => [o.key, o]));

  for (const key of selected) {
    const opt = optionsByKey.get(key)!;
    const result = await promptForOption(opt);

    if (result === null) {
      // User cancelled during an individual prompt
      clack.cancel("Wizard cancelled.");
      return null;
    }

    selections[key] = result;
  }

  const flags = selectionsToFlags(selections);

  clack.outro(
    flags.length > 0
      ? `Applying: ${flags.join(" ")}`
      : "No changes — proceeding with current config.",
  );

  return flags;
}

/**
 * Prompt for a single wizard option using the appropriate input type.
 *
 * @returns The new value as a string, or `null` if the user cancels.
 */
async function promptForOption(opt: WizardOption): Promise<string | null> {
  if (opt.prompt.kind === "select") {
    const result = await clack.select({
      message: opt.label,
      options: opt.prompt.choices.map((choice) => ({
        value: choice,
        label: choice,
      })),
      initialValue: opt.currentValue,
    });

    if (clack.isCancel(result)) return null;
    return result;
  }

  // Text prompt (with optional validation)
  const result = await clack.text({
    message: opt.label,
    initialValue: opt.currentValue,
    validate: opt.prompt.validate,
  });

  if (clack.isCancel(result)) return null;
  return result;
}
