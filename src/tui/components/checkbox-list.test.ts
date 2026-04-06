/**
 * Tests for the checkbox-list component's selection logic.
 *
 * Tests the exported pure helper functions `toggleItem`, `toggleAll`,
 * `checkboxKeyHandler`, and `checkboxReducer` which drive multi-select
 * toggling, keyboard mapping, and state transitions.
 *
 * Component-level rendering tests (Ink render output, useInput integration)
 * are deferred until `ink-testing-library` is added as a dependency.
 */

import { describe, it, expect } from "bun:test";
import type { Key } from "ink";
import type { ListItem } from "./selectable-list.tsx";
import {
  toggleItem,
  toggleAll,
  checkboxKeyHandler,
  checkboxReducer,
} from "./checkbox-list.tsx";
import type { CheckboxState, CheckboxAction } from "./checkbox-list.tsx";

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

/** Create a simple enabled item. */
function item(value: string, disabled = false): ListItem {
  return { value, label: value, disabled };
}

/** Create a list of N enabled items. */
function enabledItems(count: number): ListItem[] {
  return Array.from({ length: count }, (_, i) => item(`item-${i}`));
}

/** Shorthand for creating a CheckboxState. */
function state(cursor: number, selected: string[] = []): CheckboxState {
  return { cursor, selected: new Set(selected) };
}

// ---------------------------------------------------------------------------
// toggleItem
// ---------------------------------------------------------------------------

describe("toggleItem", () => {
  it("adds a value to an empty set", () => {
    const result = toggleItem(new Set(), "a");
    expect(result.has("a")).toBe(true);
    expect(result.size).toBe(1);
  });

  it("adds a value to a non-empty set", () => {
    const result = toggleItem(new Set(["a"]), "b");
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("removes a value that is already in the set", () => {
    const result = toggleItem(new Set(["a", "b"]), "a");
    expect(result.has("a")).toBe(false);
    expect(result.has("b")).toBe(true);
    expect(result.size).toBe(1);
  });

  it("removes the last value from the set", () => {
    const result = toggleItem(new Set(["a"]), "a");
    expect(result.has("a")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("does not mutate the original set", () => {
    const original = new Set(["a", "b"]);
    const result = toggleItem(original, "c");
    expect(original.size).toBe(2);
    expect(result.size).toBe(3);
  });

  it("toggle on then off returns to original state", () => {
    const original = new Set(["a"]);
    const added = toggleItem(original, "b");
    const removed = toggleItem(added, "b");
    expect(removed.size).toBe(1);
    expect(removed.has("a")).toBe(true);
    expect(removed.has("b")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggleAll
// ---------------------------------------------------------------------------

describe("toggleAll", () => {
  it("selects all enabled items when none are selected", () => {
    const items = enabledItems(3);
    const result = toggleAll(items, new Set());
    expect(result.size).toBe(3);
    expect(result.has("item-0")).toBe(true);
    expect(result.has("item-1")).toBe(true);
    expect(result.has("item-2")).toBe(true);
  });

  it("selects all enabled items when some are selected", () => {
    const items = enabledItems(3);
    const result = toggleAll(items, new Set(["item-0"]));
    expect(result.size).toBe(3);
  });

  it("deselects all when all enabled items are already selected", () => {
    const items = enabledItems(3);
    const result = toggleAll(items, new Set(["item-0", "item-1", "item-2"]));
    expect(result.size).toBe(0);
  });

  it("ignores disabled items when selecting all", () => {
    const items = [item("a"), item("b", true), item("c")];
    const result = toggleAll(items, new Set());
    expect(result.size).toBe(2);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(false);
    expect(result.has("c")).toBe(true);
  });

  it("only checks enabled items when determining if all are selected", () => {
    // All enabled items selected, disabled item "b" not selected
    const items = [item("a"), item("b", true), item("c")];
    const result = toggleAll(items, new Set(["a", "c"]));
    // All enabled are selected → deselect all enabled
    expect(result.size).toBe(0);
  });

  it("handles all items disabled", () => {
    const items = [item("a", true), item("b", true)];
    // No enabled items → all 0 enabled are "selected" → deselects (no-op)
    const result = toggleAll(items, new Set());
    expect(result.size).toBe(0);
  });

  it("handles empty item list", () => {
    const result = toggleAll([], new Set());
    expect(result.size).toBe(0);
  });

  it("does not mutate the original set", () => {
    const items = enabledItems(3);
    const original = new Set(["item-0"]);
    toggleAll(items, original);
    expect(original.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkboxKeyHandler — navigation keys
// ---------------------------------------------------------------------------

describe("checkboxKeyHandler — navigation keys", () => {
  it("maps down arrow to move down", () => {
    expect(checkboxKeyHandler("", makeKey({ downArrow: true }))).toEqual({
      type: "move",
      direction: 1,
    });
  });

  it("maps up arrow to move up", () => {
    expect(checkboxKeyHandler("", makeKey({ upArrow: true }))).toEqual({
      type: "move",
      direction: -1,
    });
  });

  it("maps Enter to confirm", () => {
    expect(checkboxKeyHandler("", makeKey({ return: true }))).toEqual({
      type: "confirm",
    });
  });

  it("maps Escape to cancel", () => {
    expect(checkboxKeyHandler("", makeKey({ escape: true }))).toEqual({
      type: "cancel",
    });
  });
});

// ---------------------------------------------------------------------------
// checkboxKeyHandler — toggle keys
// ---------------------------------------------------------------------------

describe("checkboxKeyHandler — toggle keys", () => {
  it("maps Space to toggle", () => {
    expect(checkboxKeyHandler(" ", makeKey())).toEqual({
      type: "toggle",
    });
  });

  it("maps 'a' to toggle-all", () => {
    expect(checkboxKeyHandler("a", makeKey())).toEqual({
      type: "toggle-all",
    });
  });

  it("ignores Space with ctrl modifier", () => {
    expect(checkboxKeyHandler(" ", makeKey({ ctrl: true }))).toBeNull();
  });

  it("ignores Space with meta modifier", () => {
    expect(checkboxKeyHandler(" ", makeKey({ meta: true }))).toBeNull();
  });

  it("ignores 'a' with ctrl modifier", () => {
    expect(checkboxKeyHandler("a", makeKey({ ctrl: true }))).toBeNull();
  });

  it("ignores 'a' with meta modifier", () => {
    expect(checkboxKeyHandler("a", makeKey({ meta: true }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkboxKeyHandler — unhandled keys
// ---------------------------------------------------------------------------

describe("checkboxKeyHandler — unhandled keys", () => {
  it("returns null for left arrow", () => {
    expect(checkboxKeyHandler("", makeKey({ leftArrow: true }))).toBeNull();
  });

  it("returns null for right arrow", () => {
    expect(checkboxKeyHandler("", makeKey({ rightArrow: true }))).toBeNull();
  });

  it("returns null for printable character other than Space or 'a'", () => {
    expect(checkboxKeyHandler("b", makeKey())).toBeNull();
  });

  it("returns null for empty input with no special key", () => {
    expect(checkboxKeyHandler("", makeKey())).toBeNull();
  });

  it("returns null for tab", () => {
    expect(checkboxKeyHandler("", makeKey({ tab: true }))).toBeNull();
  });

  it("returns null for backspace", () => {
    expect(checkboxKeyHandler("", makeKey({ backspace: true }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkboxReducer — move
// ---------------------------------------------------------------------------

describe("checkboxReducer — move", () => {
  it("moves cursor down", () => {
    const items = enabledItems(5);
    const s = state(0);
    const result = checkboxReducer(s, { type: "move", direction: 1 }, items);
    expect(result.cursor).toBe(1);
  });

  it("moves cursor up", () => {
    const items = enabledItems(5);
    const s = state(3);
    const result = checkboxReducer(s, { type: "move", direction: -1 }, items);
    expect(result.cursor).toBe(2);
  });

  it("wraps cursor from last to first", () => {
    const items = enabledItems(3);
    const s = state(2);
    const result = checkboxReducer(s, { type: "move", direction: 1 }, items);
    expect(result.cursor).toBe(0);
  });

  it("wraps cursor from first to last", () => {
    const items = enabledItems(3);
    const s = state(0);
    const result = checkboxReducer(s, { type: "move", direction: -1 }, items);
    expect(result.cursor).toBe(2);
  });

  it("skips disabled items going down", () => {
    const items = [item("a"), item("b", true), item("c")];
    const s = state(0);
    const result = checkboxReducer(s, { type: "move", direction: 1 }, items);
    expect(result.cursor).toBe(2);
  });

  it("skips disabled items going up", () => {
    const items = [item("a"), item("b", true), item("c")];
    const s = state(2);
    const result = checkboxReducer(s, { type: "move", direction: -1 }, items);
    expect(result.cursor).toBe(0);
  });

  it("preserves selected set when moving", () => {
    const items = enabledItems(3);
    const s = state(0, ["item-0", "item-2"]);
    const result = checkboxReducer(s, { type: "move", direction: 1 }, items);
    expect(result.cursor).toBe(1);
    expect(result.selected).toEqual(s.selected);
  });

  it("stays put when no enabled item found in direction", () => {
    // Only one enabled item
    const items = [item("a"), item("b", true), item("c", true)];
    const s = state(0);
    const result = checkboxReducer(s, { type: "move", direction: 1 }, items);
    // findNextEnabled from 1 forward, only 'a' at 0 is enabled, wraps to 0
    expect(result.cursor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkboxReducer — toggle
// ---------------------------------------------------------------------------

describe("checkboxReducer — toggle", () => {
  it("selects an unselected item at cursor", () => {
    const items = enabledItems(3);
    const s = state(1);
    const result = checkboxReducer(s, { type: "toggle" }, items);
    expect(result.selected.has("item-1")).toBe(true);
    expect(result.selected.size).toBe(1);
  });

  it("deselects a selected item at cursor", () => {
    const items = enabledItems(3);
    const s = state(1, ["item-1"]);
    const result = checkboxReducer(s, { type: "toggle" }, items);
    expect(result.selected.has("item-1")).toBe(false);
    expect(result.selected.size).toBe(0);
  });

  it("does not toggle a disabled item", () => {
    const items = [item("a"), item("b", true), item("c")];
    // Cursor on disabled item (shouldn't normally happen, but defensive)
    const s = state(1);
    const result = checkboxReducer(s, { type: "toggle" }, items);
    expect(result.selected.size).toBe(0);
    expect(result).toBe(s); // same reference
  });

  it("preserves cursor when toggling", () => {
    const items = enabledItems(3);
    const s = state(2);
    const result = checkboxReducer(s, { type: "toggle" }, items);
    expect(result.cursor).toBe(2);
  });

  it("preserves other selections when toggling", () => {
    const items = enabledItems(3);
    const s = state(1, ["item-0"]);
    const result = checkboxReducer(s, { type: "toggle" }, items);
    expect(result.selected.has("item-0")).toBe(true);
    expect(result.selected.has("item-1")).toBe(true);
  });

  it("handles toggle when cursor is out of bounds", () => {
    const items = enabledItems(3);
    const s = state(5);
    const result = checkboxReducer(s, { type: "toggle" }, items);
    expect(result).toBe(s); // same reference, no change
  });
});

// ---------------------------------------------------------------------------
// checkboxReducer — toggle-all
// ---------------------------------------------------------------------------

describe("checkboxReducer — toggle-all", () => {
  it("selects all when none are selected", () => {
    const items = enabledItems(3);
    const s = state(0);
    const result = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(result.selected.size).toBe(3);
  });

  it("selects all when some are selected", () => {
    const items = enabledItems(3);
    const s = state(0, ["item-0"]);
    const result = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(result.selected.size).toBe(3);
  });

  it("deselects all when all are selected", () => {
    const items = enabledItems(3);
    const s = state(0, ["item-0", "item-1", "item-2"]);
    const result = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(result.selected.size).toBe(0);
  });

  it("preserves cursor position", () => {
    const items = enabledItems(3);
    const s = state(2);
    const result = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(result.cursor).toBe(2);
  });

  it("only toggles enabled items", () => {
    const items = [item("a"), item("b", true), item("c")];
    const s = state(0);
    const result = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(result.selected.has("a")).toBe(true);
    expect(result.selected.has("b")).toBe(false);
    expect(result.selected.has("c")).toBe(true);
    expect(result.selected.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// checkboxReducer — side-effect actions (state unchanged)
// ---------------------------------------------------------------------------

describe("checkboxReducer — side-effect actions", () => {
  it("returns state unchanged for confirm", () => {
    const items = enabledItems(3);
    const s = state(1, ["item-0"]);
    const result = checkboxReducer(s, { type: "confirm" }, items);
    expect(result).toEqual(s);
  });

  it("returns state unchanged for cancel", () => {
    const items = enabledItems(3);
    const s = state(1, ["item-0"]);
    const result = checkboxReducer(s, { type: "cancel" }, items);
    expect(result).toEqual(s);
  });
});

// ---------------------------------------------------------------------------
// checkboxReducer — simulated interaction sequences
// ---------------------------------------------------------------------------

describe("checkboxReducer — simulated interaction sequences", () => {
  it("navigates down and toggles each item", () => {
    const items = enabledItems(3);
    let s: CheckboxState = state(0);

    // Toggle first item
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.selected.has("item-0")).toBe(true);

    // Move down, toggle second
    s = checkboxReducer(s, { type: "move", direction: 1 }, items);
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.cursor).toBe(1);
    expect(s.selected.has("item-1")).toBe(true);

    // Move down, toggle third
    s = checkboxReducer(s, { type: "move", direction: 1 }, items);
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.cursor).toBe(2);
    expect(s.selected.size).toBe(3);
  });

  it("toggles all on, then untoggle one, then toggle-all to re-select", () => {
    const items = enabledItems(4);
    let s: CheckboxState = state(0);

    // Select all
    s = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(s.selected.size).toBe(4);

    // Move to item-2 and deselect it
    s = checkboxReducer(s, { type: "move", direction: 1 }, items);
    s = checkboxReducer(s, { type: "move", direction: 1 }, items);
    expect(s.cursor).toBe(2);
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.selected.has("item-2")).toBe(false);
    expect(s.selected.size).toBe(3);

    // Toggle-all again should re-select all (since not all enabled are selected)
    s = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(s.selected.size).toBe(4);
  });

  it("navigates with disabled items and selects only enabled ones", () => {
    const items = [
      item("a"),
      item("b", true),
      item("c"),
      item("d", true),
      item("e"),
    ];
    let s: CheckboxState = state(0);

    // Toggle a
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.selected.has("a")).toBe(true);

    // Move down → skips disabled b, lands on c
    s = checkboxReducer(s, { type: "move", direction: 1 }, items);
    expect(s.cursor).toBe(2);

    // Toggle c
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.selected.has("c")).toBe(true);

    // Move down → skips disabled d, lands on e
    s = checkboxReducer(s, { type: "move", direction: 1 }, items);
    expect(s.cursor).toBe(4);

    // Toggle e
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.selected.size).toBe(3);
    expect(s.selected.has("a")).toBe(true);
    expect(s.selected.has("c")).toBe(true);
    expect(s.selected.has("e")).toBe(true);
  });

  it("toggle-all then toggle-all is idempotent round-trip", () => {
    const items = enabledItems(5);
    let s: CheckboxState = state(0);

    // Select all
    s = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(s.selected.size).toBe(5);

    // Deselect all
    s = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(s.selected.size).toBe(0);

    // Select all again
    s = checkboxReducer(s, { type: "toggle-all" }, items);
    expect(s.selected.size).toBe(5);
  });

  it("wrapping navigation with toggles", () => {
    const items = enabledItems(3);
    let s: CheckboxState = state(2);

    // Toggle last item
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.selected.has("item-2")).toBe(true);

    // Move down wraps to first
    s = checkboxReducer(s, { type: "move", direction: 1 }, items);
    expect(s.cursor).toBe(0);

    // Toggle first item
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.selected.has("item-0")).toBe(true);
    expect(s.selected.size).toBe(2);

    // Move up wraps to last
    s = checkboxReducer(s, { type: "move", direction: -1 }, items);
    expect(s.cursor).toBe(2);

    // Untoggle last
    s = checkboxReducer(s, { type: "toggle" }, items);
    expect(s.selected.has("item-2")).toBe(false);
    expect(s.selected.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkboxKeyHandler + checkboxReducer — integrated key sequence
// ---------------------------------------------------------------------------

describe("checkbox — integrated key-to-state sequences", () => {
  it("Space toggles, down moves, Enter is side-effect", () => {
    const items = enabledItems(3);
    let s: CheckboxState = state(0);

    // Press Space
    const spaceAction = checkboxKeyHandler(" ", makeKey());
    expect(spaceAction).toEqual({ type: "toggle" });
    s = checkboxReducer(s, spaceAction!, items);
    expect(s.selected.has("item-0")).toBe(true);

    // Press down arrow
    const downAction = checkboxKeyHandler("", makeKey({ downArrow: true }));
    expect(downAction).toEqual({ type: "move", direction: 1 });
    s = checkboxReducer(s, downAction!, items);
    expect(s.cursor).toBe(1);

    // Press Space again
    s = checkboxReducer(s, checkboxKeyHandler(" ", makeKey())!, items);
    expect(s.selected.has("item-1")).toBe(true);
    expect(s.selected.size).toBe(2);

    // Press Enter (confirm) — state unchanged
    const enterAction = checkboxKeyHandler("", makeKey({ return: true }));
    expect(enterAction).toEqual({ type: "confirm" });
    s = checkboxReducer(s, enterAction!, items);
    expect(s.selected.size).toBe(2);
    expect(s.cursor).toBe(1);
  });

  it("'a' key selects all, then 'a' again deselects all", () => {
    const items = enabledItems(4);
    let s: CheckboxState = state(0);

    // Press 'a'
    const aAction = checkboxKeyHandler("a", makeKey());
    expect(aAction).toEqual({ type: "toggle-all" });
    s = checkboxReducer(s, aAction!, items);
    expect(s.selected.size).toBe(4);

    // Press 'a' again
    s = checkboxReducer(s, aAction!, items);
    expect(s.selected.size).toBe(0);
  });

  it("Esc produces cancel action, state unchanged", () => {
    const items = enabledItems(3);
    const s = state(1, ["item-0"]);
    const escAction = checkboxKeyHandler("", makeKey({ escape: true }));
    expect(escAction).toEqual({ type: "cancel" });
    const result = checkboxReducer(s, escAction!, items);
    expect(result).toEqual(s);
  });
});
