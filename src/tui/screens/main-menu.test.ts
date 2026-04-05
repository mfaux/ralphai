/**
 * Tests for the main menu screen.
 *
 * Tests pure helper functions: menuItemsToListItems, buildHotkeyMap.
 * Pure unit tests — no filesystem, no subprocess.
 */

import { describe, it, expect } from "bun:test";
import type { MenuItem } from "../menu-items.ts";
import { menuItemsToListItems, buildHotkeyMap } from "./main-menu.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides?: Partial<MenuItem>): MenuItem {
  return {
    value: "test-item",
    label: "Test Item",
    group: "START",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// menuItemsToListItems
// ---------------------------------------------------------------------------

describe("menuItemsToListItems", () => {
  it("adds group header and separator between groups", () => {
    const items: MenuItem[] = [
      makeItem({ value: "a", label: "Item A", group: "START" }),
      makeItem({ value: "b", label: "Item B", group: "MANAGE" }),
    ];

    const listItems = menuItemsToListItems(items);

    // Should have: START header, Item A, separator, MANAGE header, Item B
    expect(listItems).toHaveLength(5);
    expect(listItems[0]!.value).toBe("__header__:START");
    expect(listItems[0]!.disabled).toBe(true);
    expect(listItems[1]!.value).toBe("a");
    expect(listItems[2]!.value).toBe("__sep__:MANAGE");
    expect(listItems[2]!.disabled).toBe(true);
    expect(listItems[3]!.value).toBe("__header__:MANAGE");
    expect(listItems[4]!.value).toBe("b");
  });

  it("indents item labels with two spaces", () => {
    const items: MenuItem[] = [makeItem({ value: "a", label: "Run next" })];

    const listItems = menuItemsToListItems(items);
    const itemEntry = listItems.find((i) => i.value === "a");
    expect(itemEntry!.label).toBe("  Run next");
  });

  it("combines hint and hotkey in the hint field", () => {
    const items: MenuItem[] = [
      makeItem({
        value: "a",
        label: "Run next",
        hint: "my-plan.md",
        hotkey: "n",
      }),
    ];

    const listItems = menuItemsToListItems(items);
    const itemEntry = listItems.find((i) => i.value === "a");
    expect(itemEntry!.hint).toBe("my-plan.md  [n]");
  });

  it("shows only hotkey when no hint", () => {
    const items: MenuItem[] = [
      makeItem({ value: "a", label: "Quit", hotkey: "q" }),
    ];

    const listItems = menuItemsToListItems(items);
    const itemEntry = listItems.find((i) => i.value === "a");
    expect(itemEntry!.hint).toBe("[q]");
  });

  it("shows only hint when no hotkey", () => {
    const items: MenuItem[] = [
      makeItem({ value: "a", label: "Settings", hint: "view or edit config" }),
    ];

    const listItems = menuItemsToListItems(items);
    const itemEntry = listItems.find((i) => i.value === "a");
    expect(itemEntry!.hint).toBe("view or edit config");
  });

  it("marks disabled items as disabled in output", () => {
    const items: MenuItem[] = [
      makeItem({ value: "a", label: "Disabled", disabled: true }),
    ];

    const listItems = menuItemsToListItems(items);
    const itemEntry = listItems.find((i) => i.value === "a");
    expect(itemEntry!.disabled).toBe(true);
  });

  it("does not add separator before first group", () => {
    const items: MenuItem[] = [makeItem({ value: "a", group: "START" })];

    const listItems = menuItemsToListItems(items);
    // Should have: header, item — no separator before first group
    expect(listItems).toHaveLength(2);
    expect(listItems[0]!.value).toBe("__header__:START");
  });

  it("handles empty input", () => {
    expect(menuItemsToListItems([])).toEqual([]);
  });

  it("handles multiple items in same group", () => {
    const items: MenuItem[] = [
      makeItem({ value: "a", label: "A", group: "START" }),
      makeItem({ value: "b", label: "B", group: "START" }),
    ];

    const listItems = menuItemsToListItems(items);
    // header + 2 items, no extra separators
    expect(listItems).toHaveLength(3);
    expect(listItems[0]!.value).toBe("__header__:START");
    expect(listItems[1]!.value).toBe("a");
    expect(listItems[2]!.value).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// buildHotkeyMap
// ---------------------------------------------------------------------------

describe("buildHotkeyMap", () => {
  it("maps hotkeys to item values", () => {
    const items: MenuItem[] = [
      makeItem({ value: "run-next", hotkey: "n" }),
      makeItem({ value: "quit", hotkey: "q" }),
    ];

    const map = buildHotkeyMap(items);
    expect(map.get("n")).toBe("run-next");
    expect(map.get("q")).toBe("quit");
  });

  it("excludes disabled items", () => {
    const items: MenuItem[] = [
      makeItem({ value: "disabled", hotkey: "d", disabled: true }),
      makeItem({ value: "enabled", hotkey: "e" }),
    ];

    const map = buildHotkeyMap(items);
    expect(map.has("d")).toBe(false);
    expect(map.get("e")).toBe("enabled");
  });

  it("excludes items without hotkeys", () => {
    const items: MenuItem[] = [
      makeItem({ value: "no-hotkey" }),
      makeItem({ value: "has-hotkey", hotkey: "h" }),
    ];

    const map = buildHotkeyMap(items);
    expect(map.size).toBe(1);
    expect(map.get("h")).toBe("has-hotkey");
  });

  it("returns empty map for empty input", () => {
    const map = buildHotkeyMap([]);
    expect(map.size).toBe(0);
  });
});
