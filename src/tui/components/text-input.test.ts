/**
 * Tests for the text input component.
 *
 * Tests the pure helper functions exported from text-input.tsx:
 * - insertChar()
 * - deleteBack()
 * - deleteForward()
 * - moveCursorLeft()
 * - moveCursorRight()
 * - buildCursorDisplay()
 *
 * Also tests the TextInput component mounts and unmounts without error
 * in various configurations.
 *
 * Pure unit tests for helpers — no filesystem, no subprocess, no mocking.
 */

import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink";
import {
  insertChar,
  deleteBack,
  deleteForward,
  moveCursorLeft,
  moveCursorRight,
  buildCursorDisplay,
  TextInput,
} from "./text-input.tsx";

// ---------------------------------------------------------------------------
// insertChar
// ---------------------------------------------------------------------------

describe("insertChar", () => {
  it("inserts at the end of a string", () => {
    expect(insertChar("abc", 3, "d")).toEqual({ text: "abcd", cursor: 4 });
  });

  it("inserts at the beginning of a string", () => {
    expect(insertChar("abc", 0, "x")).toEqual({ text: "xabc", cursor: 1 });
  });

  it("inserts in the middle of a string", () => {
    expect(insertChar("abc", 1, "x")).toEqual({ text: "axbc", cursor: 2 });
  });

  it("inserts into an empty string", () => {
    expect(insertChar("", 0, "a")).toEqual({ text: "a", cursor: 1 });
  });

  it("clamps cursor to string length when past end", () => {
    expect(insertChar("abc", 10, "d")).toEqual({ text: "abcd", cursor: 4 });
  });

  it("clamps negative cursor to 0", () => {
    expect(insertChar("abc", -5, "x")).toEqual({ text: "xabc", cursor: 1 });
  });

  it("inserts multi-character input", () => {
    expect(insertChar("ab", 1, "xy")).toEqual({ text: "axyb", cursor: 3 });
  });
});

// ---------------------------------------------------------------------------
// deleteBack
// ---------------------------------------------------------------------------

describe("deleteBack", () => {
  it("deletes character before cursor", () => {
    expect(deleteBack("abc", 2)).toEqual({ text: "ac", cursor: 1 });
  });

  it("deletes last character when cursor is at end", () => {
    expect(deleteBack("abc", 3)).toEqual({ text: "ab", cursor: 2 });
  });

  it("deletes first character when cursor is at 1", () => {
    expect(deleteBack("abc", 1)).toEqual({ text: "bc", cursor: 0 });
  });

  it("does nothing when cursor is at 0", () => {
    expect(deleteBack("abc", 0)).toEqual({ text: "abc", cursor: 0 });
  });

  it("handles empty string", () => {
    expect(deleteBack("", 0)).toEqual({ text: "", cursor: 0 });
  });

  it("handles single character", () => {
    expect(deleteBack("a", 1)).toEqual({ text: "", cursor: 0 });
  });

  it("clamps cursor past end", () => {
    expect(deleteBack("abc", 10)).toEqual({ text: "ab", cursor: 2 });
  });

  it("clamps negative cursor to 0 and does nothing", () => {
    expect(deleteBack("abc", -5)).toEqual({ text: "abc", cursor: 0 });
  });
});

// ---------------------------------------------------------------------------
// deleteForward
// ---------------------------------------------------------------------------

describe("deleteForward", () => {
  it("deletes character at cursor position", () => {
    expect(deleteForward("abc", 1)).toEqual({ text: "ac", cursor: 1 });
  });

  it("deletes first character", () => {
    expect(deleteForward("abc", 0)).toEqual({ text: "bc", cursor: 0 });
  });

  it("deletes last character", () => {
    expect(deleteForward("abc", 2)).toEqual({ text: "ab", cursor: 2 });
  });

  it("does nothing when cursor is at end", () => {
    expect(deleteForward("abc", 3)).toEqual({ text: "abc", cursor: 3 });
  });

  it("handles empty string", () => {
    expect(deleteForward("", 0)).toEqual({ text: "", cursor: 0 });
  });

  it("handles single character at start", () => {
    expect(deleteForward("a", 0)).toEqual({ text: "", cursor: 0 });
  });

  it("clamps cursor past end", () => {
    expect(deleteForward("abc", 10)).toEqual({ text: "abc", cursor: 3 });
  });

  it("clamps negative cursor to 0 and deletes first char", () => {
    expect(deleteForward("abc", -5)).toEqual({ text: "bc", cursor: 0 });
  });
});

// ---------------------------------------------------------------------------
// moveCursorLeft
// ---------------------------------------------------------------------------

describe("moveCursorLeft", () => {
  it("moves cursor left by one", () => {
    expect(moveCursorLeft(3)).toBe(2);
  });

  it("clamps at 0", () => {
    expect(moveCursorLeft(0)).toBe(0);
  });

  it("clamps negative values to 0", () => {
    expect(moveCursorLeft(-1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// moveCursorRight
// ---------------------------------------------------------------------------

describe("moveCursorRight", () => {
  it("moves cursor right by one", () => {
    expect(moveCursorRight(2, 5)).toBe(3);
  });

  it("clamps at text length", () => {
    expect(moveCursorRight(5, 5)).toBe(5);
  });

  it("clamps beyond text length", () => {
    expect(moveCursorRight(10, 5)).toBe(5);
  });

  it("moves from 0", () => {
    expect(moveCursorRight(0, 3)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildCursorDisplay
// ---------------------------------------------------------------------------

describe("buildCursorDisplay", () => {
  it("builds display with cursor in middle of text", () => {
    expect(buildCursorDisplay("hello", 2)).toEqual({
      before: "he",
      cursorChar: "l",
      after: "lo",
    });
  });

  it("builds display with cursor at start", () => {
    expect(buildCursorDisplay("hello", 0)).toEqual({
      before: "",
      cursorChar: "h",
      after: "ello",
    });
  });

  it("builds display with cursor at end (shows space)", () => {
    expect(buildCursorDisplay("hello", 5)).toEqual({
      before: "hello",
      cursorChar: " ",
      after: "",
    });
  });

  it("builds display for empty string", () => {
    expect(buildCursorDisplay("", 0)).toEqual({
      before: "",
      cursorChar: " ",
      after: "",
    });
  });

  it("builds display with cursor at last character", () => {
    expect(buildCursorDisplay("abc", 2)).toEqual({
      before: "ab",
      cursorChar: "c",
      after: "",
    });
  });

  it("clamps cursor past end", () => {
    expect(buildCursorDisplay("abc", 10)).toEqual({
      before: "abc",
      cursorChar: " ",
      after: "",
    });
  });

  it("clamps negative cursor to 0", () => {
    expect(buildCursorDisplay("abc", -1)).toEqual({
      before: "",
      cursorChar: "a",
      after: "bc",
    });
  });
});

// ---------------------------------------------------------------------------
// TextInput component — mount/unmount tests
// ---------------------------------------------------------------------------

describe("TextInput", () => {
  it("mounts and unmounts without error", () => {
    const instance = render(
      React.createElement(TextInput, {
        label: "Name",
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with initial value without error", () => {
    const instance = render(
      React.createElement(TextInput, {
        label: "Agent command",
        initialValue: "claude -p",
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with placeholder without error", () => {
    const instance = render(
      React.createElement(TextInput, {
        label: "Branch",
        placeholder: "Enter branch name...",
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with validation function without error", () => {
    const instance = render(
      React.createElement(TextInput, {
        label: "Max stuck",
        initialValue: "3",
        validate: (v: string) =>
          /^\d+$/.test(v) ? undefined : "Must be a number",
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with isActive=false without error", () => {
    const instance = render(
      React.createElement(TextInput, {
        label: "Name",
        isActive: false,
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with all props without error", () => {
    const instance = render(
      React.createElement(TextInput, {
        label: "Timeout",
        initialValue: "300",
        placeholder: "seconds",
        validate: (v: string) =>
          /^\d+$/.test(v) ? undefined : "Must be a number",
        onSubmit: () => {},
        onCancel: () => {},
        isActive: true,
      }),
    );
    instance.unmount();
  });

  it("mounts with empty initial value without error", () => {
    const instance = render(
      React.createElement(TextInput, {
        label: "Command",
        initialValue: "",
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });
});
