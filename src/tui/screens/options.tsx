/**
 * Run-with-options wizard screen.
 *
 * Multi-step wizard flow:
 * 1. "selecting" — checkbox list of configurable options from
 *    `buildWizardOptions(config)`, showing current values and sources.
 *    User toggles which options to modify, then presses Enter.
 * 2. "editing" — per-option prompts. Text options use `TextInput`,
 *    select options use `SelectableList`. After each prompt, advances
 *    to the next selected option.
 * 3. On completion — converts selections to CLI flags via
 *    `selectionsToFlags()`, merges with original `runArgs`, and
 *    dispatches `exit-to-runner`.
 *
 * Esc at any step cancels the wizard and returns to `backScreen`.
 *
 * Pure helpers are exported for unit testing:
 * - `buildCheckboxItems` — maps WizardOptions to ListItems with hints
 * - `wizardKeyHandler` — maps key input on the selecting step to an intent
 * - `resolveWizardResult` — maps wizard completion to a DispatchResult
 * - `mergeWizardFlags` — merges wizard flags into existing runArgs
 * - `buildEditingLabel` — builds the label for the editing step
 */

import { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";

import type { ConfirmData } from "./confirm.tsx";
import type { DispatchResult, Screen } from "../types.ts";
import {
  buildWizardOptions,
  selectionsToFlags,
  type WizardConfigKey,
  type WizardOption,
} from "../../interactive/wizard-options.ts";
import type { ResolvedConfig } from "../../config.ts";
import { CheckboxList } from "../components/checkbox-list.tsx";
import type { ListItem } from "../components/checkbox-list.tsx";
import { TextInput } from "../components/text-input.tsx";
import type { ValidationResult, Validator } from "../components/text-input.tsx";
import { SelectableList } from "../components/selectable-list.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Wizard step discriminated union. */
export type WizardStep =
  | { type: "selecting" }
  | { type: "editing"; optionIndex: number };

/** Internal wizard state. */
export interface WizardState {
  /** Current wizard step. */
  step: WizardStep;
  /** Wizard options (computed once from config). */
  options: readonly WizardOption[];
  /** Keys the user selected in the checkbox step. */
  selectedKeys: readonly WizardConfigKey[];
  /** Values the user has entered for selected keys. */
  values: Partial<Record<WizardConfigKey, string>>;
}

/** Possible user intents from the options screen (fallback keys). */
export type OptionsIntent = "confirm" | "back";

export interface OptionsScreenProps {
  /** Pre-populated run data (carried from the confirm screen). */
  data: ConfirmData;
  /** Called when the user confirms or navigates back. */
  onResult: (result: DispatchResult) => void;
  /**
   * Screen to navigate back to on Esc.
   * Typically the confirm screen that opened this wizard.
   * @default { type: "menu" }
   */
  backScreen?: Screen;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
  /**
   * Resolved configuration. When provided, the wizard shows
   * configurable options. When absent, falls back to a simple
   * confirm/back screen (placeholder behavior).
   */
  resolvedConfig?: ResolvedConfig;
  /**
   * Injected wizard options builder for testing. When provided,
   * used instead of calling `buildWizardOptions(config)`.
   */
  buildOptions?: (config: ResolvedConfig) => WizardOption[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Map a key press to a user intent on the options screen.
 *
 * Only applies when no sub-component is handling keys (e.g. the
 * fallback placeholder mode when no config is available).
 *
 * - Enter -> confirm (launch the run with current args)
 * - Esc -> back (return to previous screen)
 *
 * Returns `null` for unrecognized keys.
 */
export function optionsKeyHandler(
  _input: string,
  key: Key,
): OptionsIntent | null {
  if (key.return) return "confirm";
  if (key.escape) return "back";
  return null;
}

/**
 * Map an options-screen intent to a `DispatchResult`.
 *
 * - `confirm` -> exit TUI, hand off CLI args to the runner
 * - `back` -> navigate to `backScreen`
 *
 * Pure function -- exported for testing.
 */
export function resolveOptionsIntent(
  intent: OptionsIntent,
  data: Pick<ConfirmData, "runArgs">,
  backScreen: Screen,
): DispatchResult {
  switch (intent) {
    case "confirm":
      return { type: "exit-to-runner", args: data.runArgs };
    case "back":
      return { type: "navigate", screen: backScreen };
  }
}

/**
 * Build ListItem array from wizard options for the checkbox list.
 *
 * Each item's `hint` shows `currentValue (sourceHint)`.
 */
export function buildCheckboxItems(
  options: readonly WizardOption[],
): ListItem[] {
  return options.map((opt) => ({
    value: opt.key,
    label: opt.label,
    hint: `${opt.currentValue} (${opt.sourceHint})`,
  }));
}

/**
 * Merge wizard-produced flags into the original runArgs.
 *
 * Wizard flags are prepended before other args (after "run" if present),
 * matching the behavior of the clack-based wizard in run-wizard.ts.
 */
export function mergeWizardFlags(
  runArgs: readonly string[],
  wizardFlags: readonly string[],
): string[] {
  if (wizardFlags.length === 0) return [...runArgs];
  // Insert wizard flags right after "run" (or at the start if no "run")
  const args = [...runArgs];
  const runIdx = args.indexOf("run");
  const insertIdx = runIdx !== -1 ? runIdx + 1 : 0;
  args.splice(insertIdx, 0, ...wizardFlags);
  return args;
}

/**
 * Build the final DispatchResult when the wizard completes.
 *
 * Converts the user's value selections to CLI flags, merges them
 * with the original runArgs, and returns an `exit-to-runner` result.
 */
export function resolveWizardResult(
  values: Partial<Record<WizardConfigKey, string>>,
  runArgs: readonly string[],
): DispatchResult {
  const flags = selectionsToFlags(values);
  const mergedArgs = mergeWizardFlags(runArgs, flags);
  return { type: "exit-to-runner", args: mergedArgs };
}

/**
 * Build the label for the editing step.
 *
 * Shows the option label, the step number (1-indexed), and total.
 */
export function buildEditingLabel(
  option: WizardOption,
  index: number,
  total: number,
): string {
  return `${option.label} (${index + 1}/${total})`;
}

/**
 * Adapt a wizard option's validate function to a TextInput Validator.
 *
 * The wizard-options module uses `(value: string) => string | undefined`
 * where `undefined` means valid. TextInput uses `Validator` which
 * returns `{ valid: true }` or `{ valid: false, message }`.
 */
export function adaptValidator(
  wizardValidate?: (value: string) => string | undefined,
): Validator | undefined {
  if (!wizardValidate) return undefined;
  return (value: string): ValidationResult => {
    const error = wizardValidate(value);
    if (error === undefined) return { valid: true };
    return { valid: false, message: error };
  };
}

/**
 * Build SelectableList items from a select-type wizard option's choices.
 */
export function buildSelectItems(choices: readonly string[]): ListItem[] {
  return choices.map((choice) => ({
    value: choice,
    label: choice,
  }));
}

// ---------------------------------------------------------------------------
// OptionsScreen component
// ---------------------------------------------------------------------------

export function OptionsScreen({
  data,
  onResult,
  backScreen = { type: "menu" },
  isActive = true,
  resolvedConfig,
  buildOptions = buildWizardOptions,
}: OptionsScreenProps) {
  // Build wizard options from config (memoized)
  const wizardOptions = useMemo(
    () => (resolvedConfig ? buildOptions(resolvedConfig) : []),
    [resolvedConfig, buildOptions],
  );

  const checkboxItems = useMemo(
    () => buildCheckboxItems(wizardOptions),
    [wizardOptions],
  );

  // Wizard state
  const [step, setStep] = useState<WizardStep>({ type: "selecting" });
  const [selectedKeys, setSelectedKeys] = useState<WizardConfigKey[]>([]);
  const [values, setValues] = useState<
    Partial<Record<WizardConfigKey, string>>
  >({});

  // --- Fallback: no config → placeholder mode ---
  const handleFallbackInput = useCallback(
    (_input: string, key: Key) => {
      const intent = optionsKeyHandler(_input, key);
      if (!intent) return;
      onResult(resolveOptionsIntent(intent, data, backScreen));
    },
    [data, backScreen, onResult],
  );

  useInput(handleFallbackInput, {
    isActive: isActive && !resolvedConfig,
  });

  // --- Navigation helpers ---

  const goBack = useCallback(() => {
    onResult({ type: "navigate", screen: backScreen });
  }, [onResult, backScreen]);

  // --- Step 1: checkbox selection ---

  const handleCheckboxConfirm = useCallback(
    (selected: string[]) => {
      const keys = selected as WizardConfigKey[];
      if (keys.length === 0) {
        // No options selected — confirm with current args (no changes)
        onResult({ type: "exit-to-runner", args: data.runArgs });
        return;
      }
      setSelectedKeys(keys);
      setStep({ type: "editing", optionIndex: 0 });
    },
    [data.runArgs, onResult],
  );

  const handleCheckboxCancel = useCallback(() => {
    goBack();
  }, [goBack]);

  // --- Step 2: per-option editing ---

  const optionsByKey = useMemo(() => {
    const map = new Map<string, WizardOption>();
    for (const opt of wizardOptions) {
      map.set(opt.key, opt);
    }
    return map;
  }, [wizardOptions]);

  const advanceOrFinish = useCallback(
    (key: WizardConfigKey, value: string) => {
      const nextValues = { ...values, [key]: value };
      setValues(nextValues);

      if (step.type !== "editing") return;

      const nextIdx = step.optionIndex + 1;
      if (nextIdx < selectedKeys.length) {
        setStep({ type: "editing", optionIndex: nextIdx });
      } else {
        // All options edited — resolve and dispatch
        onResult(resolveWizardResult(nextValues, data.runArgs));
      }
    },
    [values, step, selectedKeys, data.runArgs, onResult],
  );

  const handleEditCancel = useCallback(() => {
    if (step.type === "editing" && step.optionIndex > 0) {
      // Go back to previous option
      setStep({ type: "editing", optionIndex: step.optionIndex - 1 });
    } else {
      // Go back to selection step
      setStep({ type: "selecting" });
    }
  }, [step]);

  // --- Render ---

  // Fallback placeholder when no config is available
  if (!resolvedConfig) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Box marginBottom={1}>
          <Text bold>Run with options</Text>
        </Box>

        <Box>
          <Text dimColor>Target </Text>
          <Text>{data.title}</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor italic>
            Options wizard coming soon. Press Enter to run with defaults, or Esc
            to go back.
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>enter confirm esc back</Text>
        </Box>
      </Box>
    );
  }

  // Step 1: selecting which options to modify
  if (step.type === "selecting") {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Box marginBottom={1}>
          <Text bold>Run with options</Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Target </Text>
          <Text>{data.title}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text>Which options would you like to change?</Text>
        </Box>

        <CheckboxList
          items={checkboxItems}
          onConfirm={handleCheckboxConfirm}
          onCancel={handleCheckboxCancel}
          isActive={isActive}
        />
      </Box>
    );
  }

  // Step 2: editing individual options
  if (step.type === "editing") {
    const currentKey = selectedKeys[step.optionIndex];
    if (!currentKey) {
      // Safety: should not happen, but handle gracefully
      onResult(resolveWizardResult(values, data.runArgs));
      return null;
    }

    const currentOption = optionsByKey.get(currentKey);
    if (!currentOption) {
      // Safety fallback
      onResult(resolveWizardResult(values, data.runArgs));
      return null;
    }

    const label = buildEditingLabel(
      currentOption,
      step.optionIndex,
      selectedKeys.length,
    );

    if (currentOption.prompt.kind === "select") {
      const selectItems = buildSelectItems(currentOption.prompt.choices);
      return (
        <Box flexDirection="column" paddingLeft={1}>
          <Box marginBottom={1}>
            <Text bold>Run with options</Text>
          </Box>

          <Box marginBottom={1}>
            <Text>{label}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text dimColor>
              Current: {currentOption.currentValue} ({currentOption.sourceHint})
            </Text>
          </Box>

          <SelectableList
            items={selectItems}
            onSelect={(value) => advanceOrFinish(currentKey, value)}
            onBack={handleEditCancel}
            isActive={isActive}
          />
        </Box>
      );
    }

    // Text prompt
    const validator = adaptValidator(currentOption.prompt.validate);
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Box marginBottom={1}>
          <Text bold>Run with options</Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>
            Current: {currentOption.currentValue} ({currentOption.sourceHint})
          </Text>
        </Box>

        <TextInput
          label={label}
          defaultValue={currentOption.currentValue}
          validate={validator}
          onSubmit={(value) => advanceOrFinish(currentKey, value)}
          onCancel={handleEditCancel}
          isActive={isActive}
        />
      </Box>
    );
  }

  // Unreachable, but TypeScript needs it
  return null;
}
