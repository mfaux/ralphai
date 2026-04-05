/**
 * Tests for the checkbox list component.
 *
 * Tests the pure helper functions exported from checkbox-list.tsx:
 * - toggleChecked()
 * - toggleAll()
 * - getOrderedSelections()
 * - checkboxIndicator()
 *
 * Also tests the CheckboxList component mounts and unmounts without error
 * in various configurations.
 *
 * Pure unit tests for helpers — no filesystem, no subprocess, no mocking.
 */

import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink";
import {
  toggleChecked,
  toggleAll,
  getOrderedSelections,
  checkboxIndicator,
  CheckboxList,
} from "./checkbox-list.tsx";

// ---------------------------------------------------------------------------
// toggleChecked
// ---------------------------------------------------------------------------

describe("toggleChecked", () => {
  it("adds a value that is not in the set", () => {
    const result = toggleChecked(new Set(["a"]), "b");
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("removes a value that is already in the set", () => {
    const result = toggleChecked(new Set(["a", "b"]), "a");
    expect(result).toEqual(new Set(["b"]));
  });

  it("adds a value to an empty set", () => {
    const result = toggleChecked(new Set(), "x");
    expect(result).toEqual(new Set(["x"]));
  });

  it("removes the last value leaving an empty set", () => {
    const result = toggleChecked(new Set(["x"]), "x");
    expect(result).toEqual(new Set());
  });

  it("returns a new Set instance (does not mutate original)", () => {
    const original = new Set(["a", "b"]);
    const result = toggleChecked(original, "c");
    expect(result).not.toBe(original);
    expect(original.size).toBe(2);
    expect(result.size).toBe(3);
  });

  it("handles toggling the same value twice (round-trip)", () => {
    const initial = new Set(["a"]);
    const after = toggleChecked(initial, "b");
    const roundTrip = toggleChecked(after, "b");
    expect(roundTrip).toEqual(new Set(["a"]));
  });
});

// ---------------------------------------------------------------------------
// toggleAll
// ---------------------------------------------------------------------------

describe("toggleAll", () => {
  const items = [
    { value: "a", disabled: false },
    { value: "b", disabled: false },
    { value: "c", disabled: false },
  ];

  it("checks all enabled items when none are checked", () => {
    const result = toggleAll(items, new Set());
    expect(result).toEqual(new Set(["a", "b", "c"]));
  });

  it("checks all enabled items when some are checked", () => {
    const result = toggleAll(items, new Set(["a"]));
    expect(result).toEqual(new Set(["a", "b", "c"]));
  });

  it("unchecks all enabled items when all are checked", () => {
    const result = toggleAll(items, new Set(["a", "b", "c"]));
    expect(result).toEqual(new Set());
  });

  it("skips disabled items when checking all", () => {
    const mixedItems = [
      { value: "a", disabled: false },
      { value: "b", disabled: true },
      { value: "c", disabled: false },
    ];
    const result = toggleAll(mixedItems, new Set());
    expect(result).toEqual(new Set(["a", "c"]));
  });

  it("preserves checked disabled items when unchecking all enabled", () => {
    const mixedItems = [
      { value: "a", disabled: false },
      { value: "b", disabled: true },
      { value: "c", disabled: false },
    ];
    // "b" is disabled but checked; "a" and "c" are enabled and checked
    const result = toggleAll(mixedItems, new Set(["a", "b", "c"]));
    // Only enabled items (a, c) are unchecked; disabled "b" stays
    expect(result).toEqual(new Set(["b"]));
  });

  it("handles empty items list", () => {
    const result = toggleAll([], new Set());
    expect(result).toEqual(new Set());
  });

  it("handles all disabled items", () => {
    const allDisabled = [
      { value: "a", disabled: true },
      { value: "b", disabled: true },
    ];
    const result = toggleAll(allDisabled, new Set());
    expect(result).toEqual(new Set());
  });

  it("considers items without disabled property as enabled", () => {
    const noDisabledProp = [{ value: "a" }, { value: "b" }];
    const result = toggleAll(noDisabledProp, new Set());
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("returns a new Set instance (does not mutate original)", () => {
    const original = new Set(["a"]);
    const result = toggleAll(items, original);
    expect(result).not.toBe(original);
    expect(original.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getOrderedSelections
// ---------------------------------------------------------------------------

describe("getOrderedSelections", () => {
  const items = [{ value: "c" }, { value: "a" }, { value: "b" }];

  it("returns checked values in item order", () => {
    const result = getOrderedSelections(items, new Set(["b", "c"]));
    expect(result).toEqual(["c", "b"]);
  });

  it("returns all values when all are checked", () => {
    const result = getOrderedSelections(items, new Set(["a", "b", "c"]));
    expect(result).toEqual(["c", "a", "b"]);
  });

  it("returns empty array when nothing is checked", () => {
    const result = getOrderedSelections(items, new Set());
    expect(result).toEqual([]);
  });

  it("ignores checked values not in items", () => {
    const result = getOrderedSelections(items, new Set(["a", "z"]));
    expect(result).toEqual(["a"]);
  });

  it("returns single-element array for one checked item", () => {
    const result = getOrderedSelections(items, new Set(["a"]));
    expect(result).toEqual(["a"]);
  });

  it("handles empty items list", () => {
    const result = getOrderedSelections([], new Set(["a"]));
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// checkboxIndicator
// ---------------------------------------------------------------------------

describe("checkboxIndicator", () => {
  it("returns checked indicator for true", () => {
    expect(checkboxIndicator(true)).toBe("[✓]");
  });

  it("returns unchecked indicator for false", () => {
    expect(checkboxIndicator(false)).toBe("[ ]");
  });
});

// ---------------------------------------------------------------------------
// CheckboxList component — mount/unmount tests
// ---------------------------------------------------------------------------

describe("CheckboxList", () => {
  const sampleItems = [
    { value: "opt-a", label: "Option A" },
    { value: "opt-b", label: "Option B" },
    { value: "opt-c", label: "Option C" },
  ];

  it("mounts and unmounts without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: sampleItems,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with initial checked values without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: sampleItems,
        initialChecked: ["opt-a", "opt-c"],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with empty items without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: [],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with disabled items without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: [
          { value: "a", label: "Enabled" },
          { value: "b", label: "Disabled", disabled: true },
          { value: "c", label: "Also enabled" },
        ],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with hints without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: [
          { value: "a", label: "Option A", hint: "(recommended)" },
          { value: "b", label: "Option B", hint: "(advanced)" },
        ],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with viewportHeight without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: sampleItems,
        viewportHeight: 2,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with isActive=false without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: sampleItems,
        isActive: false,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with initialIndex without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: sampleItems,
        initialIndex: 2,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });

  it("mounts with all props without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: [
          { value: "a", label: "A", hint: "(default)", disabled: false },
          { value: "b", label: "B", hint: "(custom)", disabled: true },
          { value: "c", label: "C" },
        ],
        initialChecked: ["a"],
        onConfirm: () => {},
        onCancel: () => {},
        viewportHeight: 5,
        isActive: true,
        initialIndex: 0,
      }),
    );
    instance.unmount();
  });

  it("mounts with only required props (no callbacks) without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: sampleItems,
      }),
    );
    instance.unmount();
  });

  it("mounts with all items disabled without error", () => {
    const instance = render(
      React.createElement(CheckboxList, {
        items: [
          { value: "a", label: "A", disabled: true },
          { value: "b", label: "B", disabled: true },
        ],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    instance.unmount();
  });
});
