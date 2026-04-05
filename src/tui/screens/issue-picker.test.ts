/**
 * Tests for the issue picker screen.
 *
 * Tests the pure `pickListToListItems()` transformation function that
 * converts `PickListItem[]` output from `buildGithubPickList()` into
 * `ListItem[]` for the `SelectableList` component.
 *
 * Pure unit tests — no filesystem, no subprocess, no mocking needed.
 */

import { describe, it, expect } from "bun:test";
import { pickListToListItems } from "./issue-picker.tsx";
import type { PickListItem } from "../../interactive/github-issues.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePickItem(
  value: string,
  label: string,
  hint?: string,
): PickListItem {
  return { value, label, hint };
}

// ---------------------------------------------------------------------------
// pickListToListItems
// ---------------------------------------------------------------------------

describe("pickListToListItems", () => {
  it("returns empty array for empty input", () => {
    expect(pickListToListItems([])).toEqual([]);
  });

  it("excludes __back__ items", () => {
    const pickList: PickListItem[] = [
      makePickItem("14", "#14 Fix dashboard bug"),
      makePickItem("__back__", "Back"),
    ];
    const items = pickListToListItems(pickList);
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("14");
  });

  it("marks __ctx__ items as disabled", () => {
    const pickList: PickListItem[] = [
      makePickItem("10", "#10 Auth Redesign [PRD]", "3 remaining"),
      makePickItem("__ctx__:11", "  \u251C #11 Add login  (next up)"),
      makePickItem("__ctx__:12", "  \u251C #12 Add signup"),
      makePickItem("__ctx__:13", "  \u2514 #13 Add password reset"),
      makePickItem("14", "#14 Fix dashboard bug"),
      makePickItem("__back__", "Back"),
    ];
    const items = pickListToListItems(pickList);

    expect(items).toHaveLength(5);

    // PRD parent is selectable
    expect(items[0]!.value).toBe("10");
    expect(items[0]!.disabled).toBe(false);
    expect(items[0]!.hint).toBe("3 remaining");

    // Sub-issue context rows are disabled
    expect(items[1]!.value).toBe("__ctx__:11");
    expect(items[1]!.disabled).toBe(true);
    expect(items[2]!.value).toBe("__ctx__:12");
    expect(items[2]!.disabled).toBe(true);
    expect(items[3]!.value).toBe("__ctx__:13");
    expect(items[3]!.disabled).toBe(true);

    // Regular issue is selectable
    expect(items[4]!.value).toBe("14");
    expect(items[4]!.disabled).toBe(false);
  });

  it("preserves labels and hints", () => {
    const pickList: PickListItem[] = [
      makePickItem("10", "#10 Auth Redesign [PRD]", "2 remaining"),
      makePickItem("__ctx__:11", "  \u251C #11 Add login  (next up)"),
      makePickItem("__ctx__:12", "  \u2514 #12 Add signup"),
      makePickItem("__back__", "Back"),
    ];
    const items = pickListToListItems(pickList);

    expect(items[0]!.label).toBe("#10 Auth Redesign [PRD]");
    expect(items[0]!.hint).toBe("2 remaining");
    expect(items[1]!.label).toContain("\u251C #11 Add login");
    expect(items[2]!.label).toContain("\u2514 #12 Add signup");
  });

  it("handles regular issues without hints", () => {
    const pickList: PickListItem[] = [
      makePickItem("14", "#14 Fix dashboard bug"),
      makePickItem("20", "#20 Add search"),
      makePickItem("__back__", "Back"),
    ];
    const items = pickListToListItems(pickList);

    expect(items).toHaveLength(2);
    expect(items[0]!.hint).toBeUndefined();
    expect(items[1]!.hint).toBeUndefined();
  });

  it("handles PRD with no sub-issues", () => {
    const pickList: PickListItem[] = [
      makePickItem("10", "#10 Empty PRD [PRD]", "no sub-issues"),
      makePickItem("__back__", "Back"),
    ];
    const items = pickListToListItems(pickList);

    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("10");
    expect(items[0]!.disabled).toBe(false);
    expect(items[0]!.hint).toBe("no sub-issues");
  });

  it("works with buildGithubPickList output shape", () => {
    // Simulate the actual output from buildGithubPickList
    const pickList: PickListItem[] = [
      { value: "5", label: "#5 PRD A [PRD]", hint: "1 remaining" },
      { value: "__ctx__:6", label: "  \u2514 #6 Sub task A  (next up)" },
      { value: "10", label: "#10 PRD B [PRD]", hint: "2 remaining" },
      { value: "__ctx__:11", label: "  \u251C #11 Sub task B  (next up)" },
      { value: "__ctx__:12", label: "  \u2514 #12 Sub task C" },
      { value: "15", label: "#15 Bug fix" },
      { value: "20", label: "#20 Feature request" },
      { value: "__back__", label: "Back" },
    ];
    const items = pickListToListItems(pickList);

    expect(items).toHaveLength(7); // 8 - 1 (__back__)

    const selectable = items.filter((i) => !i.disabled);
    expect(selectable).toHaveLength(4); // 2 PRDs + 2 regular issues
    expect(selectable.map((i) => i.value)).toEqual(["5", "10", "15", "20"]);

    const disabled = items.filter((i) => i.disabled);
    expect(disabled).toHaveLength(3); // 3 sub-issue context rows
    expect(disabled.map((i) => i.value)).toEqual([
      "__ctx__:6",
      "__ctx__:11",
      "__ctx__:12",
    ]);
  });
});
