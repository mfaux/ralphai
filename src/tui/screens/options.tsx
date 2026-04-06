/**
 * Placeholder run-with-options wizard screen.
 *
 * This screen will eventually let the user customise agent, branch,
 * feedback commands, and other run parameters before confirming.
 * For now it shows a placeholder message and supports:
 * - Esc → return to confirmation screen (or `backScreen`)
 * - Enter → confirm run with current args (same as confirm screen)
 *
 * Pure helpers are exported for unit testing:
 * - `optionsKeyHandler` — maps key input to an OptionsIntent
 * - `resolveOptionsIntent` — maps an OptionsIntent to a DispatchResult
 */

import { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";

import type { ConfirmData } from "./confirm.tsx";
import type { DispatchResult, Screen } from "../types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Possible user intents from the options screen. */
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
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Map a key press to a user intent on the options screen.
 *
 * - Enter → confirm (launch the run with current args)
 * - Esc → back (return to previous screen)
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
 * - `confirm` → exit TUI, hand off CLI args to the runner
 * - `back` → navigate to `backScreen`
 *
 * Pure function — exported for testing.
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

// ---------------------------------------------------------------------------
// OptionsScreen component
// ---------------------------------------------------------------------------

export function OptionsScreen({
  data,
  onResult,
  backScreen = { type: "menu" },
  isActive = true,
}: OptionsScreenProps) {
  const handleInput = useCallback(
    (_input: string, key: Key) => {
      const intent = optionsKeyHandler(_input, key);
      if (!intent) return;
      onResult(resolveOptionsIntent(intent, data, backScreen));
    },
    [data, backScreen, onResult],
  );

  useInput(handleInput, { isActive });

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
