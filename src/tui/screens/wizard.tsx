/**
 * Run-with-options wizard screen for the TUI.
 *
 * Multi-step flow:
 * 1. Target chooser (if no pre-selected target): auto-detect, backlog, GitHub
 * 2. Checkbox list of configurable options from buildWizardOptions()
 * 3. Per-option prompts: text-input for string/number, selectable-list for enum
 * 4. Final: convert selections to flags via selectionsToFlags(), call onDone
 *
 * Esc at any step cancels the wizard and calls onCancel.
 *
 * The wizard does NOT exit the TUI itself — it delegates the TUI exit to
 * the parent via the `onDone(flags)` callback.
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text } from "ink";

import {
  buildWizardOptions,
  selectionsToFlags,
  type WizardOption,
  type WizardConfigKey,
} from "../../interactive/wizard-options.ts";
import type { ResolvedConfig } from "../../config.ts";
import {
  SelectableList,
  type ListItem,
} from "../components/selectable-list.tsx";
import { CheckboxList } from "../components/checkbox-list.tsx";
import { TextInput } from "../components/text-input.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Target source for the wizard.
 *
 * When `preSelectedTarget` is provided, the target step is skipped.
 * When absent, step 1 shows a target chooser.
 */
export interface TargetChoice {
  /** Display label for the target. */
  label: string;
  /** CLI args to pass for this target (e.g., ["--plan", "foo.md"]). */
  args: string[];
}

/** Props for the WizardScreen component. */
export interface WizardScreenProps {
  /** Resolved config to build wizard options from. */
  config: ResolvedConfig;
  /** Pre-selected target — skips step 1 if provided. */
  preSelectedTarget?: TargetChoice;
  /**
   * Target choices for step 1 (when no pre-selected target).
   * Each item corresponds to a selectable-list entry.
   */
  targetChoices?: TargetChoice[];
  /** Called when the wizard completes with the final run flags. */
  onDone: (flags: string[]) => void;
  /** Called when the user cancels (Esc at any step). */
  onCancel: () => void;
  /** Whether this component is actively receiving input. */
  isActive?: boolean;
}

/** Wizard step state. */
export type WizardStep =
  | { tag: "target" }
  | { tag: "options"; targetArgs: string[] }
  | {
      tag: "prompts";
      targetArgs: string[];
      selectedKeys: WizardConfigKey[];
      promptIndex: number;
      selections: Partial<Record<WizardConfigKey, string>>;
    }
  | {
      tag: "done";
      targetArgs: string[];
      selections: Partial<Record<WizardConfigKey, string>>;
    };

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build checkbox items from wizard options.
 *
 * Each checkbox item shows the option label with the current value and
 * source as a hint.
 */
export function buildCheckboxItems(
  options: WizardOption[],
): { value: string; label: string; hint: string }[] {
  return options.map((opt) => ({
    value: opt.key,
    label: opt.label,
    hint: `(${opt.currentValue}, ${opt.sourceHint})`,
  }));
}

/**
 * Build selectable-list items for the target chooser.
 */
export function buildTargetListItems(choices: TargetChoice[]): ListItem[] {
  return choices.map((choice, i) => ({
    value: String(i),
    label: choice.label,
  }));
}

/**
 * Get the prompt label for a wizard option at a given index.
 *
 * Returns a string like "Agent command (1/3):" to indicate progress
 * through the prompt sequence.
 */
export function buildPromptLabel(
  option: WizardOption,
  index: number,
  total: number,
): string {
  return `${option.label} (${index + 1}/${total})`;
}

/**
 * Build the summary text for the wizard completion.
 *
 * Returns a human-readable string describing the flags that will be applied.
 */
export function buildWizardSummary(flags: string[]): string {
  if (flags.length === 0) {
    return "No changes — proceeding with current config.";
  }
  return `Applying: ${flags.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WizardScreen({
  config,
  preSelectedTarget,
  targetChoices = [],
  onDone,
  onCancel,
  isActive = true,
}: WizardScreenProps): React.ReactNode {
  const options = useMemo(() => buildWizardOptions(config), [config]);

  const initialStep = useMemo<WizardStep>(() => {
    if (preSelectedTarget) {
      return { tag: "options", targetArgs: preSelectedTarget.args };
    }
    return { tag: "target" };
  }, [preSelectedTarget]);

  const [step, setStep] = useState<WizardStep>(initialStep);

  // ------ Step 1: Target chooser ------

  const targetItems = useMemo(
    () => buildTargetListItems(targetChoices),
    [targetChoices],
  );

  const handleTargetSelect = useCallback(
    (value: string) => {
      const idx = parseInt(value, 10);
      const choice = targetChoices[idx];
      if (choice) {
        setStep({ tag: "options", targetArgs: choice.args });
      }
    },
    [targetChoices],
  );

  // ------ Step 2: Option selection ------

  const checkboxItems = useMemo(() => buildCheckboxItems(options), [options]);

  const handleOptionsConfirm = useCallback(
    (selectedValues: string[]) => {
      if (step.tag !== "options") return;

      const selectedKeys = selectedValues as WizardConfigKey[];
      if (selectedKeys.length === 0) {
        // No options selected — skip prompts, finish with empty flags
        setStep({ tag: "done", targetArgs: step.targetArgs, selections: {} });
        return;
      }

      setStep({
        tag: "prompts",
        targetArgs: step.targetArgs,
        selectedKeys,
        promptIndex: 0,
        selections: {},
      });
    },
    [step],
  );

  // ------ Step 3: Per-option prompts ------

  const handlePromptSubmit = useCallback(
    (value: string) => {
      if (step.tag !== "prompts") return;

      const currentKey = step.selectedKeys[step.promptIndex]!;
      const newSelections = { ...step.selections, [currentKey]: value };

      if (step.promptIndex + 1 >= step.selectedKeys.length) {
        // All prompts done
        setStep({
          tag: "done",
          targetArgs: step.targetArgs,
          selections: newSelections,
        });
      } else {
        setStep({
          ...step,
          promptIndex: step.promptIndex + 1,
          selections: newSelections,
        });
      }
    },
    [step],
  );

  const handlePromptCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  // ------ Step 4: Done — compute flags and call onDone ------

  // When we reach "done", compute flags and notify parent immediately.
  // Use a ref-like pattern to avoid double-calling in strict mode.
  const doneHandled = React.useRef(false);
  React.useEffect(() => {
    if (step.tag === "done" && !doneHandled.current) {
      doneHandled.current = true;
      const flags = selectionsToFlags(step.selections);
      onDone([...flags, ...step.targetArgs]);
    }
  }, [step, onDone]);

  // ------ Render ------

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Run with options</Text>

      {/* Step 1: Target chooser */}
      {step.tag === "target" && (
        <>
          <Box marginTop={1}>
            <Text>Select a target:</Text>
          </Box>
          <Box marginTop={1}>
            <SelectableList
              items={targetItems}
              onSelect={handleTargetSelect}
              onBack={onCancel}
              isActive={isActive}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter to select {"\u00b7"} Esc to cancel</Text>
          </Box>
        </>
      )}

      {/* Step 2: Option checkbox list */}
      {step.tag === "options" && (
        <>
          <Box marginTop={1}>
            <Text>Which options would you like to change?</Text>
          </Box>
          <Box marginTop={1}>
            <CheckboxList
              items={checkboxItems}
              onConfirm={handleOptionsConfirm}
              onCancel={onCancel}
              isActive={isActive}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Space to toggle {"\u00b7"} a to toggle all {"\u00b7"} Enter to
              confirm {"\u00b7"} Esc to cancel
            </Text>
          </Box>
        </>
      )}

      {/* Step 3: Per-option prompts */}
      {step.tag === "prompts" &&
        (() => {
          const currentKey = step.selectedKeys[step.promptIndex]!;
          const currentOption = options.find((o) => o.key === currentKey)!;
          const label = buildPromptLabel(
            currentOption,
            step.promptIndex,
            step.selectedKeys.length,
          );

          if (currentOption.prompt.kind === "select") {
            const selectItems: ListItem[] = currentOption.prompt.choices.map(
              (choice) => ({
                value: choice,
                label: choice,
              }),
            );
            const initialIdx = selectItems.findIndex(
              (item) => item.value === currentOption.currentValue,
            );

            return (
              <>
                <Box marginTop={1}>
                  <Text>{label}</Text>
                </Box>
                <Box marginTop={1}>
                  <SelectableList
                    key={`select-${currentKey}`}
                    items={selectItems}
                    onSelect={handlePromptSubmit}
                    onBack={handlePromptCancel}
                    isActive={isActive}
                    initialIndex={initialIdx >= 0 ? initialIdx : undefined}
                  />
                </Box>
                <Box marginTop={1}>
                  <Text dimColor>Enter to select {"\u00b7"} Esc to cancel</Text>
                </Box>
              </>
            );
          }

          // Text prompt
          return (
            <>
              <Box marginTop={1}>
                <TextInput
                  key={`text-${currentKey}`}
                  label={label}
                  initialValue={currentOption.currentValue}
                  validate={
                    currentOption.prompt.kind === "text"
                      ? currentOption.prompt.validate
                      : undefined
                  }
                  onSubmit={handlePromptSubmit}
                  onCancel={handlePromptCancel}
                  isActive={isActive}
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter to confirm {"\u00b7"} Esc to cancel</Text>
              </Box>
            </>
          );
        })()}

      {/* Step 4: Done — brief flash before onDone fires */}
      {step.tag === "done" && (
        <Box marginTop={1}>
          <Text dimColor>
            {buildWizardSummary(selectionsToFlags(step.selections))}
          </Text>
        </Box>
      )}
    </Box>
  );
}
