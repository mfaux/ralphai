/**
 * Run confirmation screen for the TUI.
 *
 * Displays the plan/issue title, PRD context (if applicable), agent
 * command, branch name, and feedback commands. The user can:
 * - Press Enter to confirm and launch the agent run
 * - Press Esc to go back to the previous screen
 * - Press `o` to open the run-with-options wizard (pre-populated)
 *
 * Data is passed in as props — the caller is responsible for computing
 * branch names, resolving config values, and gathering PRD context.
 *
 * Pure helpers are exported for unit testing:
 * - `buildConfirmLines` — builds the display lines from ConfirmData
 * - `confirmKeyHandler` — maps key input to a ConfirmIntent
 * - `resolveConfirmIntent` — maps a ConfirmIntent to a DispatchResult
 */

import { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";

import type { DispatchResult, Screen } from "../types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** PRD context shown when the plan is a sub-issue of a PRD. */
export interface PrdContext {
  /** Parent PRD title (e.g. "Auth Redesign"). */
  prdTitle: string;
  /** Position string (e.g. "1 of 3 remaining"). */
  position: string;
}

/** All data the confirmation screen needs to display. */
export interface ConfirmData {
  /** Plan filename or issue title. */
  title: string;
  /** Agent command that will be run. */
  agentCommand: string;
  /** Branch name for the run. */
  branch: string;
  /** Feedback commands (semicolon or newline separated). */
  feedbackCommands: string;
  /** Sandbox mode with source label (e.g. "none (default)"). */
  sandbox?: string;
  /** PRD context, if the plan is a sub-issue of a PRD. */
  prdContext?: PrdContext;
  /** The CLI args that will be passed to the runner on confirm. */
  runArgs: string[];
}

export interface ConfirmScreenProps {
  /** Data to display on the confirmation screen. */
  data: ConfirmData;
  /** Called when the user confirms, cancels, or requests options. */
  onResult: (result: DispatchResult) => void;
  /** Screen to navigate back to on Esc. @default { type: "menu" } */
  backScreen?: Screen;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** A single line of the confirmation display. */
export interface ConfirmLine {
  label: string;
  value: string;
}

/**
 * Build the display lines for the confirmation screen.
 *
 * Returns an ordered array of label/value pairs. PRD context lines are
 * included only when `prdContext` is provided. Empty values are omitted.
 */
export function buildConfirmLines(data: ConfirmData): ConfirmLine[] {
  const lines: ConfirmLine[] = [];

  lines.push({ label: "Target", value: data.title });

  if (data.prdContext) {
    lines.push({ label: "PRD", value: data.prdContext.prdTitle });
    lines.push({ label: "Position", value: data.prdContext.position });
  }

  if (data.agentCommand) {
    lines.push({ label: "Agent", value: data.agentCommand });
  }

  lines.push({ label: "Branch", value: data.branch });

  if (data.feedbackCommands) {
    lines.push({ label: "Feedback", value: data.feedbackCommands });
  }

  if (data.sandbox) {
    lines.push({ label: "Sandbox", value: data.sandbox });
  }

  return lines;
}

/**
 * Possible user intents from the confirmation screen.
 */
export type ConfirmIntent = "confirm" | "back" | "options";

/**
 * Map a key press to a user intent.
 *
 * - Enter → confirm (launch the run)
 * - Esc → back (return to previous screen)
 * - `o` → options (open run-with-options wizard)
 *
 * Returns `null` for unrecognized keys.
 */
export function confirmKeyHandler(
  input: string,
  key: Key,
): ConfirmIntent | null {
  if (key.return) return "confirm";
  if (key.escape) return "back";
  if (input === "o") return "options";
  return null;
}

/**
 * Map a confirm-screen intent to a `DispatchResult`.
 *
 * - `confirm` → exit TUI, hand off CLI args to the runner
 * - `back` → navigate to `backScreen` (previous screen)
 * - `options` → navigate to the run-with-options wizard, pre-populated
 *   with the current confirm data. The wizard's back screen is set to
 *   the confirm screen so Esc returns here.
 *
 * Pure function — exported for testing.
 */
export function resolveConfirmIntent(
  intent: ConfirmIntent,
  data: Pick<ConfirmData, "runArgs">,
  backScreen: Screen,
): DispatchResult {
  switch (intent) {
    case "confirm":
      return { type: "exit-to-runner", args: data.runArgs };
    case "back":
      return { type: "navigate", screen: backScreen };
    case "options":
      return {
        type: "navigate",
        screen: {
          type: "options",
          data: data as ConfirmData,
          backScreen: {
            type: "confirm",
            data: data as ConfirmData,
            backScreen,
          },
        },
      };
  }
}

// ---------------------------------------------------------------------------
// ConfirmScreen component
// ---------------------------------------------------------------------------

export function ConfirmScreen({
  data,
  onResult,
  backScreen = { type: "menu" },
  isActive = true,
}: ConfirmScreenProps) {
  const lines = buildConfirmLines(data);

  const handleInput = useCallback(
    (input: string, key: Key) => {
      const intent = confirmKeyHandler(input, key);
      if (!intent) return;
      onResult(resolveConfirmIntent(intent, data, backScreen));
    },
    [data, backScreen, onResult],
  );

  useInput(handleInput, { isActive });

  // Compute max label width for alignment
  const maxLabel = lines.reduce(
    (max, line) => Math.max(max, line.label.length),
    0,
  );

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box marginBottom={1}>
        <Text bold>Confirm run</Text>
      </Box>

      {lines.map((line) => (
        <Box key={line.label}>
          <Text dimColor>{line.label.padEnd(maxLabel)} </Text>
          <Text>{line.value}</Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>enter confirm esc back o options</Text>
      </Box>
    </Box>
  );
}
