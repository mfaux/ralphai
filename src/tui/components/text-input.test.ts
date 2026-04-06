/**
 * Tests for the text-input component's editing logic.
 *
 * Tests the exported pure helper functions `insertChar`, `deleteBack`,
 * `deleteForward`, `moveCursor`, `textInputKeyHandler`, and
 * `textInputReducer` which drive text editing, cursor movement,
 * and key-to-action mapping.
 *
 * Component-level rendering tests (Ink render output, useInput integration)
 * are deferred until `ink-testing-library` is added as a dependency.
 */

import { describe, it, expect } from "bun:test";
import type { Key } from "ink";
import {
  insertChar,
  deleteBack,
  deleteForward,
  moveCursor,
  textInputKeyHandler,
  textInputReducer,
} from "./text-input.tsx";
import type {
  TextInputState,
  TextInputAction,
  ValidationResult,
  Validator,
} from "./text-input.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a full Ink Key object with all booleans false, then apply overrides. */
function makeKey(overrides?: Partial<Key>): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

/** Shorthand for creating a TextInputState. */
function state(value: string, cursor?: number): TextInputState {
  return { value, cursor: cursor ?? value.length };
}

// ---------------------------------------------------------------------------
// insertChar
// ---------------------------------------------------------------------------

describe("insertChar", () => {
  it("inserts at the end of an empty string", () => {
    expect(insertChar("", 0, "a")).toEqual({ value: "a", cursor: 1 });
  });

  it("inserts at the end of a non-empty string", () => {
    expect(insertChar("abc", 3, "d")).toEqual({ value: "abcd", cursor: 4 });
  });

  it("inserts at the beginning", () => {
    expect(insertChar("abc", 0, "x")).toEqual({ value: "xabc", cursor: 1 });
  });

  it("inserts in the middle", () => {
    expect(insertChar("abc", 1, "x")).toEqual({ value: "axbc", cursor: 2 });
  });

  it("inserts multiple characters (e.g. paste)", () => {
    expect(insertChar("abc", 1, "xy")).toEqual({ value: "axybc", cursor: 3 });
  });
});

// ---------------------------------------------------------------------------
// deleteBack
// ---------------------------------------------------------------------------

describe("deleteBack", () => {
  it("removes the character before the cursor", () => {
    expect(deleteBack("abc", 3)).toEqual({ value: "ab", cursor: 2 });
  });

  it("removes from the middle", () => {
    expect(deleteBack("abc", 2)).toEqual({ value: "ac", cursor: 1 });
  });

  it("removes the first character when cursor is at 1", () => {
    expect(deleteBack("abc", 1)).toEqual({ value: "bc", cursor: 0 });
  });

  it("is a no-op when cursor is at 0", () => {
    expect(deleteBack("abc", 0)).toEqual({ value: "abc", cursor: 0 });
  });

  it("handles empty string", () => {
    expect(deleteBack("", 0)).toEqual({ value: "", cursor: 0 });
  });

  it("handles single character", () => {
    expect(deleteBack("a", 1)).toEqual({ value: "", cursor: 0 });
  });
});

// ---------------------------------------------------------------------------
// deleteForward
// ---------------------------------------------------------------------------

describe("deleteForward", () => {
  it("removes the character at the cursor", () => {
    expect(deleteForward("abc", 0)).toEqual({ value: "bc", cursor: 0 });
  });

  it("removes from the middle", () => {
    expect(deleteForward("abc", 1)).toEqual({ value: "ac", cursor: 1 });
  });

  it("removes the last character", () => {
    expect(deleteForward("abc", 2)).toEqual({ value: "ab", cursor: 2 });
  });

  it("is a no-op when cursor is at end", () => {
    expect(deleteForward("abc", 3)).toEqual({ value: "abc", cursor: 3 });
  });

  it("handles empty string", () => {
    expect(deleteForward("", 0)).toEqual({ value: "", cursor: 0 });
  });

  it("handles single character", () => {
    expect(deleteForward("a", 0)).toEqual({ value: "", cursor: 0 });
  });
});

// ---------------------------------------------------------------------------
// moveCursor
// ---------------------------------------------------------------------------

describe("moveCursor", () => {
  it("moves right within bounds", () => {
    expect(moveCursor("abc", 0, 1)).toBe(1);
    expect(moveCursor("abc", 1, 1)).toBe(2);
    expect(moveCursor("abc", 2, 1)).toBe(3);
  });

  it("moves left within bounds", () => {
    expect(moveCursor("abc", 3, -1)).toBe(2);
    expect(moveCursor("abc", 2, -1)).toBe(1);
    expect(moveCursor("abc", 1, -1)).toBe(0);
  });

  it("clamps at the right boundary", () => {
    expect(moveCursor("abc", 3, 1)).toBe(3);
  });

  it("clamps at the left boundary", () => {
    expect(moveCursor("abc", 0, -1)).toBe(0);
  });

  it("handles empty string", () => {
    expect(moveCursor("", 0, 1)).toBe(0);
    expect(moveCursor("", 0, -1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// textInputKeyHandler — character input
// ---------------------------------------------------------------------------

describe("textInputKeyHandler — character input", () => {
  it("maps a printable character to insert action", () => {
    expect(textInputKeyHandler("a", makeKey())).toEqual({
      type: "insert",
      char: "a",
    });
  });

  it("maps space to insert action", () => {
    expect(textInputKeyHandler(" ", makeKey())).toEqual({
      type: "insert",
      char: " ",
    });
  });

  it("maps numbers to insert action", () => {
    expect(textInputKeyHandler("5", makeKey())).toEqual({
      type: "insert",
      char: "5",
    });
  });

  it("ignores empty input with no special key", () => {
    expect(textInputKeyHandler("", makeKey())).toBeNull();
  });

  it("ignores ctrl+key combinations (not a/e)", () => {
    expect(textInputKeyHandler("c", makeKey({ ctrl: true }))).toBeNull();
  });

  it("ignores meta+key combinations", () => {
    expect(textInputKeyHandler("a", makeKey({ meta: true }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// textInputKeyHandler — navigation keys
// ---------------------------------------------------------------------------

describe("textInputKeyHandler — navigation keys", () => {
  it("maps Enter to submit", () => {
    expect(textInputKeyHandler("", makeKey({ return: true }))).toEqual({
      type: "submit",
    });
  });

  it("maps Escape to cancel", () => {
    expect(textInputKeyHandler("", makeKey({ escape: true }))).toEqual({
      type: "cancel",
    });
  });

  it("maps Backspace to delete-back", () => {
    expect(textInputKeyHandler("", makeKey({ backspace: true }))).toEqual({
      type: "delete-back",
    });
  });

  it("maps Delete to delete-back", () => {
    expect(textInputKeyHandler("", makeKey({ delete: true }))).toEqual({
      type: "delete-back",
    });
  });

  it("maps left arrow to move left", () => {
    expect(textInputKeyHandler("", makeKey({ leftArrow: true }))).toEqual({
      type: "move",
      direction: -1,
    });
  });

  it("maps right arrow to move right", () => {
    expect(textInputKeyHandler("", makeKey({ rightArrow: true }))).toEqual({
      type: "move",
      direction: 1,
    });
  });

  it("maps Ctrl+A to move-to-start", () => {
    expect(textInputKeyHandler("a", makeKey({ ctrl: true }))).toEqual({
      type: "move-to-start",
    });
  });

  it("maps Ctrl+E to move-to-end", () => {
    expect(textInputKeyHandler("e", makeKey({ ctrl: true }))).toEqual({
      type: "move-to-end",
    });
  });

  it("returns null for up arrow (not handled)", () => {
    expect(textInputKeyHandler("", makeKey({ upArrow: true }))).toBeNull();
  });

  it("returns null for down arrow (not handled)", () => {
    expect(textInputKeyHandler("", makeKey({ downArrow: true }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// textInputReducer — insert
// ---------------------------------------------------------------------------

describe("textInputReducer — insert", () => {
  it("inserts a character at cursor position", () => {
    const s = state("hllo", 1);
    const result = textInputReducer(s, { type: "insert", char: "e" });
    expect(result).toEqual({ value: "hello", cursor: 2 });
  });

  it("inserts at the end", () => {
    const s = state("abc");
    const result = textInputReducer(s, { type: "insert", char: "d" });
    expect(result).toEqual({ value: "abcd", cursor: 4 });
  });

  it("inserts at the beginning", () => {
    const s = state("abc", 0);
    const result = textInputReducer(s, { type: "insert", char: "z" });
    expect(result).toEqual({ value: "zabc", cursor: 1 });
  });
});

// ---------------------------------------------------------------------------
// textInputReducer — delete
// ---------------------------------------------------------------------------

describe("textInputReducer — delete", () => {
  it("deletes back from end", () => {
    const s = state("abc");
    const result = textInputReducer(s, { type: "delete-back" });
    expect(result).toEqual({ value: "ab", cursor: 2 });
  });

  it("deletes back from middle", () => {
    const s = state("abc", 2);
    const result = textInputReducer(s, { type: "delete-back" });
    expect(result).toEqual({ value: "ac", cursor: 1 });
  });

  it("deletes forward from beginning", () => {
    const s = state("abc", 0);
    const result = textInputReducer(s, { type: "delete-forward" });
    expect(result).toEqual({ value: "bc", cursor: 0 });
  });

  it("deletes forward from middle", () => {
    const s = state("abc", 1);
    const result = textInputReducer(s, { type: "delete-forward" });
    expect(result).toEqual({ value: "ac", cursor: 1 });
  });
});

// ---------------------------------------------------------------------------
// textInputReducer — move
// ---------------------------------------------------------------------------

describe("textInputReducer — move", () => {
  it("moves cursor left", () => {
    const s = state("abc", 2);
    const result = textInputReducer(s, { type: "move", direction: -1 });
    expect(result).toEqual({ value: "abc", cursor: 1 });
  });

  it("moves cursor right", () => {
    const s = state("abc", 1);
    const result = textInputReducer(s, { type: "move", direction: 1 });
    expect(result).toEqual({ value: "abc", cursor: 2 });
  });

  it("moves to start", () => {
    const s = state("abc", 2);
    const result = textInputReducer(s, { type: "move-to-start" });
    expect(result).toEqual({ value: "abc", cursor: 0 });
  });

  it("moves to end", () => {
    const s = state("abc", 1);
    const result = textInputReducer(s, { type: "move-to-end" });
    expect(result).toEqual({ value: "abc", cursor: 3 });
  });
});

// ---------------------------------------------------------------------------
// textInputReducer — side-effect actions (state unchanged)
// ---------------------------------------------------------------------------

describe("textInputReducer — side-effect actions", () => {
  it("returns state unchanged for submit", () => {
    const s = state("abc");
    const result = textInputReducer(s, { type: "submit" });
    expect(result).toEqual(s);
  });

  it("returns state unchanged for cancel", () => {
    const s = state("abc");
    const result = textInputReducer(s, { type: "cancel" });
    expect(result).toEqual(s);
  });
});

// ---------------------------------------------------------------------------
// textInputReducer — simulated editing sequences
// ---------------------------------------------------------------------------

describe("textInputReducer — simulated editing sequences", () => {
  it("types a word character by character", () => {
    let s: TextInputState = state("");
    for (const ch of "hello") {
      s = textInputReducer(s, { type: "insert", char: ch });
    }
    expect(s).toEqual({ value: "hello", cursor: 5 });
  });

  it("types, backspaces, and retypes", () => {
    let s: TextInputState = state("");
    // Type "helo"
    for (const ch of "helo") {
      s = textInputReducer(s, { type: "insert", char: ch });
    }
    expect(s.value).toBe("helo");

    // Backspace twice
    s = textInputReducer(s, { type: "delete-back" });
    s = textInputReducer(s, { type: "delete-back" });
    expect(s).toEqual({ value: "he", cursor: 2 });

    // Retype "llo"
    for (const ch of "llo") {
      s = textInputReducer(s, { type: "insert", char: ch });
    }
    expect(s).toEqual({ value: "hello", cursor: 5 });
  });

  it("navigates and inserts in the middle", () => {
    let s: TextInputState = state("hllo", 4);

    // Move left three times to position 1
    s = textInputReducer(s, { type: "move", direction: -1 });
    s = textInputReducer(s, { type: "move", direction: -1 });
    s = textInputReducer(s, { type: "move", direction: -1 });
    expect(s.cursor).toBe(1);

    // Insert 'e'
    s = textInputReducer(s, { type: "insert", char: "e" });
    expect(s).toEqual({ value: "hello", cursor: 2 });
  });

  it("Ctrl+A then Ctrl+E traverses full range", () => {
    const s = state("hello world", 5);

    const atStart = textInputReducer(s, { type: "move-to-start" });
    expect(atStart.cursor).toBe(0);

    const atEnd = textInputReducer(atStart, { type: "move-to-end" });
    expect(atEnd.cursor).toBe(11);
  });
});
