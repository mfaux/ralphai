/**
 * Text input component for the TUI.
 *
 * Provides a single-line text input with:
 * - Visible cursor indicator
 * - Character insertion and deletion (backspace/delete)
 * - Enter to confirm the current value
 * - Esc to cancel
 * - Optional validation with inline error feedback
 * - Placeholder text when the input is empty
 *
 * This is a pure input component. It does not know about wizard steps
 * or option keys — the parent screen composes those concerns on top.
 *
 * Pure helpers are exported for unit testing:
 * - `insertChar` — inserts a character at the cursor position
 * - `deleteBack` — removes the character before the cursor (backspace)
 * - `deleteForward` — removes the character at the cursor (delete)
 * - `moveCursor` — moves the cursor left/right within bounds
 * - `textInputKeyHandler` — maps key input to a TextInputAction
 * - `textInputReducer` — reduces an action into the next state
 */

import { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Validation result: either valid or an error message. */
export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string };

/** Validation function for the input value. */
export type Validator = (value: string) => ValidationResult;

/** Internal state of the text input. */
export interface TextInputState {
  /** Current text value. */
  value: string;
  /** Cursor position (0 = before first char, value.length = after last char). */
  cursor: number;
}

/** Props for the TextInput component. */
export interface TextInputProps {
  /** Label displayed above the input. */
  label: string;
  /** Called when the user presses Enter with a valid value. */
  onSubmit: (value: string) => void;
  /** Called when the user presses Esc. */
  onCancel?: () => void;
  /** Initial value. @default "" */
  defaultValue?: string;
  /** Placeholder shown when the input is empty. */
  placeholder?: string;
  /** Validation function. Called on every keystroke and on submit. */
  validate?: Validator;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Actions the text input can process. */
export type TextInputAction =
  | { type: "insert"; char: string }
  | { type: "delete-back" }
  | { type: "delete-forward" }
  | { type: "move"; direction: -1 | 1 }
  | { type: "move-to-start" }
  | { type: "move-to-end" }
  | { type: "submit" }
  | { type: "cancel" };

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Insert a character at the given cursor position.
 * Returns the new value and cursor position.
 */
export function insertChar(
  value: string,
  cursor: number,
  char: string,
): TextInputState {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  return {
    value: before + char + after,
    cursor: cursor + char.length,
  };
}

/**
 * Delete the character before the cursor (backspace).
 * Returns the new value and cursor position. No-op if cursor is at 0.
 */
export function deleteBack(value: string, cursor: number): TextInputState {
  if (cursor <= 0) return { value, cursor };
  const before = value.slice(0, cursor - 1);
  const after = value.slice(cursor);
  return { value: before + after, cursor: cursor - 1 };
}

/**
 * Delete the character at the cursor position (forward delete).
 * Returns the new value and cursor position. No-op if cursor is at end.
 */
export function deleteForward(value: string, cursor: number): TextInputState {
  if (cursor >= value.length) return { value, cursor };
  const before = value.slice(0, cursor);
  const after = value.slice(cursor + 1);
  return { value: before + after, cursor };
}

/**
 * Move the cursor left (-1) or right (+1), clamped to [0, value.length].
 */
export function moveCursor(
  value: string,
  cursor: number,
  direction: -1 | 1,
): number {
  return Math.max(0, Math.min(value.length, cursor + direction));
}

/**
 * Map a key press to a TextInputAction.
 *
 * Returns `null` for keys that are not handled (e.g. arrow up/down,
 * which the parent may use for other navigation).
 */
export function textInputKeyHandler(
  input: string,
  key: Key,
): TextInputAction | null {
  if (key.return) return { type: "submit" };
  if (key.escape) return { type: "cancel" };
  if (key.backspace || key.delete) return { type: "delete-back" };
  if (key.leftArrow) return { type: "move", direction: -1 };
  if (key.rightArrow) return { type: "move", direction: 1 };

  // Ctrl+A → move to start, Ctrl+E → move to end (common terminal shortcuts)
  if (key.ctrl && input === "a") return { type: "move-to-start" };
  if (key.ctrl && input === "e") return { type: "move-to-end" };

  // Printable character input
  if (input && !key.ctrl && !key.meta) {
    return { type: "insert", char: input };
  }

  return null;
}

/**
 * Apply a TextInputAction to the current state.
 *
 * Pure reducer — returns the next state without mutating the input.
 * `submit` and `cancel` are not handled here (they produce side effects
 * in the component via callbacks).
 */
export function textInputReducer(
  state: TextInputState,
  action: TextInputAction,
): TextInputState {
  switch (action.type) {
    case "insert":
      return insertChar(state.value, state.cursor, action.char);
    case "delete-back":
      return deleteBack(state.value, state.cursor);
    case "delete-forward":
      return deleteForward(state.value, state.cursor);
    case "move":
      return {
        value: state.value,
        cursor: moveCursor(state.value, state.cursor, action.direction),
      };
    case "move-to-start":
      return { value: state.value, cursor: 0 };
    case "move-to-end":
      return { value: state.value, cursor: state.value.length };
    case "submit":
    case "cancel":
      // Side-effect actions — state unchanged; component handles callbacks
      return state;
  }
}

// ---------------------------------------------------------------------------
// TextInput component
// ---------------------------------------------------------------------------

export function TextInput({
  label,
  onSubmit,
  onCancel,
  defaultValue = "",
  placeholder,
  validate,
  isActive = true,
}: TextInputProps) {
  const [state, setState] = useState<TextInputState>({
    value: defaultValue,
    cursor: defaultValue.length,
  });
  const [showError, setShowError] = useState(false);

  const validationResult = useMemo<ValidationResult>(
    () => (validate ? validate(state.value) : { valid: true }),
    [validate, state.value],
  );

  const handleInput = useCallback(
    (input: string, key: Key) => {
      const action = textInputKeyHandler(input, key);
      if (!action) return;

      if (action.type === "submit") {
        if (validate) {
          const result = validate(state.value);
          if (!result.valid) {
            setShowError(true);
            return;
          }
        }
        onSubmit(state.value);
        return;
      }

      if (action.type === "cancel") {
        onCancel?.();
        return;
      }

      // Apply the reducer for text-editing actions
      setState((prev) => textInputReducer(prev, action));
      // Clear error display on any edit
      setShowError(false);
    },
    [state.value, onSubmit, onCancel, validate],
  );

  useInput(handleInput, { isActive });

  // Build the display string with cursor indicator
  const displayValue = state.value || "";
  const beforeCursor = displayValue.slice(0, state.cursor);
  const cursorChar = displayValue[state.cursor] ?? " ";
  const afterCursor = displayValue.slice(state.cursor + 1);

  const isEmpty = displayValue.length === 0;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{label}</Text>
      </Box>

      <Box>
        <Text dimColor>{"❯ "}</Text>
        {isEmpty && placeholder && !isActive ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <>
            <Text>{beforeCursor}</Text>
            <Text inverse>{cursorChar}</Text>
            <Text>{afterCursor}</Text>
          </>
        )}
      </Box>

      {showError && !validationResult.valid ? (
        <Box>
          <Text color="red">
            {"  ✗ "}
            {validationResult.message}
          </Text>
        </Box>
      ) : null}

      <Box marginTop={0}>
        <Text dimColor>enter confirm esc cancel</Text>
      </Box>
    </Box>
  );
}
