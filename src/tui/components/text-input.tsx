/**
 * Text input component for the TUI.
 *
 * Renders a single-line text input with cursor, inline validation feedback,
 * and keyboard handling:
 * - Printable characters insert at the cursor position
 * - Backspace/Delete to remove characters
 * - Left/Right arrows to move the cursor within the text
 * - Home/Ctrl+A to move cursor to start, End/Ctrl+E to move cursor to end
 * - Enter to submit (runs validation first — blocks submit on error)
 * - Esc to cancel
 *
 * The component displays a prompt label, the current text with a visible
 * cursor indicator, and an optional validation error message below.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for the TextInput component. */
export interface TextInputProps {
  /** Prompt label shown before the input (e.g., "Agent command"). */
  label: string;
  /** Initial value to populate the input with. */
  initialValue?: string;
  /** Placeholder text shown when the input is empty. */
  placeholder?: string;
  /**
   * Validation function. Receives the current value and returns an error
   * message string if invalid, or `undefined` if valid.
   */
  validate?: (value: string) => string | undefined;
  /** Called when the user presses Enter and validation passes. */
  onSubmit?: (value: string) => void;
  /** Called when the user presses Escape to cancel. */
  onCancel?: () => void;
  /** Whether this component is actively receiving input. Defaults to true. */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Insert a character at a given cursor position in a string.
 *
 * Returns the new string and the updated cursor position.
 */
export function insertChar(
  text: string,
  cursor: number,
  char: string,
): { text: string; cursor: number } {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  return {
    text: text.slice(0, clamped) + char + text.slice(clamped),
    cursor: clamped + char.length,
  };
}

/**
 * Delete the character before the cursor (backspace behavior).
 *
 * Returns the new string and updated cursor position. If the cursor is
 * at the start (position 0), the string and cursor are returned unchanged.
 */
export function deleteBack(
  text: string,
  cursor: number,
): { text: string; cursor: number } {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  if (clamped === 0) return { text, cursor: 0 };
  return {
    text: text.slice(0, clamped - 1) + text.slice(clamped),
    cursor: clamped - 1,
  };
}

/**
 * Delete the character at the cursor position (forward-delete behavior).
 *
 * Returns the new string and the same cursor position. If the cursor is
 * at the end, the string is returned unchanged.
 */
export function deleteForward(
  text: string,
  cursor: number,
): { text: string; cursor: number } {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  if (clamped >= text.length) return { text, cursor: clamped };
  return {
    text: text.slice(0, clamped) + text.slice(clamped + 1),
    cursor: clamped,
  };
}

/**
 * Move the cursor left by one position, clamped to 0.
 */
export function moveCursorLeft(cursor: number): number {
  return Math.max(0, cursor - 1);
}

/**
 * Move the cursor right by one position, clamped to the text length.
 */
export function moveCursorRight(cursor: number, textLength: number): number {
  return Math.min(textLength, cursor + 1);
}

/**
 * Build the display text with a visible cursor indicator.
 *
 * Returns an object with three parts: the text before the cursor,
 * the character at the cursor (or a space if at the end), and
 * the text after the cursor. The caller renders the cursor character
 * with inverse styling.
 */
export function buildCursorDisplay(
  text: string,
  cursor: number,
): { before: string; cursorChar: string; after: string } {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  return {
    before: text.slice(0, clamped),
    cursorChar: clamped < text.length ? text[clamped]! : " ",
    after: clamped < text.length ? text.slice(clamped + 1) : "",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TextInput({
  label,
  initialValue = "",
  placeholder,
  validate,
  onSubmit,
  onCancel,
  isActive = true,
}: TextInputProps): React.ReactNode {
  const [text, setText] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = useCallback(() => {
    if (validate) {
      const err = validate(text);
      if (err) {
        setError(err);
        return;
      }
    }
    setError(undefined);
    onSubmit?.(text);
  }, [text, validate, onSubmit]);

  useInput(
    (input, key) => {
      // Enter → submit with validation
      if (key.return) {
        handleSubmit();
        return;
      }

      // Escape → cancel
      if (key.escape) {
        onCancel?.();
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        const result = deleteBack(text, cursor);
        setText(result.text);
        setCursor(result.cursor);
        setError(undefined);
        return;
      }

      // Left arrow
      if (key.leftArrow) {
        setCursor((c) => moveCursorLeft(c));
        return;
      }

      // Right arrow
      if (key.rightArrow) {
        setCursor((c) => moveCursorRight(c, text.length));
        return;
      }

      // Home / Ctrl+A → move cursor to start
      if (input === "a" && key.ctrl) {
        setCursor(0);
        return;
      }

      // End / Ctrl+E → move cursor to end
      if (input === "e" && key.ctrl) {
        setCursor(text.length);
        return;
      }

      // Ctrl+D → forward delete
      if (input === "d" && key.ctrl) {
        const result = deleteForward(text, cursor);
        setText(result.text);
        setCursor(result.cursor);
        setError(undefined);
        return;
      }

      // Ctrl+K → delete from cursor to end
      if (input === "k" && key.ctrl) {
        setText(text.slice(0, cursor));
        setError(undefined);
        return;
      }

      // Ctrl+U → delete from start to cursor
      if (input === "u" && key.ctrl) {
        setText(text.slice(cursor));
        setCursor(0);
        setError(undefined);
        return;
      }

      // Printable character → insert at cursor
      if (input && !key.ctrl && !key.meta) {
        const result = insertChar(text, cursor, input);
        setText(result.text);
        setCursor(result.cursor);
        setError(undefined);
      }
    },
    { isActive },
  );

  const showPlaceholder = text.length === 0 && placeholder && !isActive;
  const display = buildCursorDisplay(text, cursor);

  return (
    <Box flexDirection="column">
      {/* Label + input line */}
      <Box>
        <Text bold>{label}: </Text>
        {showPlaceholder ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <Text>
            {display.before}
            {isActive ? (
              <Text inverse>{display.cursorChar}</Text>
            ) : (
              <Text>
                {display.cursorChar === " " ? "" : display.cursorChar}
              </Text>
            )}
            {display.after}
          </Text>
        )}
      </Box>

      {/* Validation error */}
      {error && (
        <Box>
          <Text color="red"> {error}</Text>
        </Box>
      )}
    </Box>
  );
}
