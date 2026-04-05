/**
 * Tests for the plan picker screen.
 *
 * Tests the pure helper function planPickerToListItems and the
 * PlanPickerScreen component rendering. Pure unit tests — no
 * filesystem, no subprocess.
 */

import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink";
import {
  planPickerToListItems,
  PlanPickerScreen,
  type PlanPickerItem,
} from "./plan-picker.tsx";

// ---------------------------------------------------------------------------
// planPickerToListItems
// ---------------------------------------------------------------------------

describe("planPickerToListItems", () => {
  it("converts plans to list items preserving fields", () => {
    const plans: PlanPickerItem[] = [
      { value: "plan-a.md", label: "plan-a.md", hint: "scope: auth" },
      { value: "plan-b.md", label: "plan-b.md" },
    ];

    const items = planPickerToListItems(plans);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      value: "plan-a.md",
      label: "plan-a.md",
      hint: "scope: auth",
    });
    expect(items[1]).toEqual({
      value: "plan-b.md",
      label: "plan-b.md",
      hint: undefined,
    });
  });

  it("returns empty array for empty input", () => {
    expect(planPickerToListItems([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PlanPickerScreen component
// ---------------------------------------------------------------------------

describe("PlanPickerScreen", () => {
  it("renders with plans without error", () => {
    const plans: PlanPickerItem[] = [
      { value: "a.md", label: "a.md" },
      { value: "b.md", label: "b.md", hint: "scope: api" },
    ];

    const instance = render(
      React.createElement(PlanPickerScreen, {
        title: "Pick a plan to run:",
        plans,
        onSelect: () => {},
        onBack: () => {},
      }),
    );

    instance.unmount();
  });

  it("renders empty state without error", () => {
    const instance = render(
      React.createElement(PlanPickerScreen, {
        title: "Pick a plan:",
        plans: [],
        onSelect: () => {},
        onBack: () => {},
      }),
    );

    instance.unmount();
  });
});
