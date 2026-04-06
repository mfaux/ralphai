/**
 * Tests for the selectable-list component's navigation logic.
 *
 * Tests the exported pure helper functions `findNextEnabled` and
 * `computeViewport` which drive cursor movement, disabled-item skipping,
 * boundary wrapping, and viewport scrolling.
 *
 * Component-level rendering tests (Ink render output, useInput integration)
 * are deferred until `ink-testing-library` is added as a dependency.
 */

import { describe, it, expect } from "bun:test";
import type { ListItem } from "./selectable-list.tsx";
import { findNextEnabled, computeViewport } from "./selectable-list.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a simple enabled item. */
function item(value: string, disabled = false): ListItem {
  return { value, label: value, disabled };
}

/** Create a list of N enabled items. */
function enabledItems(count: number): ListItem[] {
  return Array.from({ length: count }, (_, i) => item(`item-${i}`));
}

// ---------------------------------------------------------------------------
// findNextEnabled — basic cursor movement
// ---------------------------------------------------------------------------

describe("findNextEnabled — cursor movement", () => {
  it("returns the start index when it is enabled", () => {
    const items = enabledItems(5);
    expect(findNextEnabled(items, 2, 1)).toBe(2);
  });

  it("returns 0 for direction=1 starting at 0 with all enabled", () => {
    const items = enabledItems(3);
    expect(findNextEnabled(items, 0, 1)).toBe(0);
  });

  it("returns the last index for direction=-1 starting at last", () => {
    const items = enabledItems(4);
    expect(findNextEnabled(items, 3, -1)).toBe(3);
  });

  it("returns -1 for an empty list", () => {
    expect(findNextEnabled([], 0, 1)).toBe(-1);
    expect(findNextEnabled([], 0, -1)).toBe(-1);
  });

  it("returns the single item index for a list with one enabled item", () => {
    const items = [item("only")];
    expect(findNextEnabled(items, 0, 1)).toBe(0);
    expect(findNextEnabled(items, 0, -1)).toBe(0);
  });

  it("moves forward through sequential enabled items", () => {
    const items = enabledItems(5);
    // Simulating pressing down from index 0: next search starts at 1
    expect(findNextEnabled(items, 1, 1)).toBe(1);
    expect(findNextEnabled(items, 2, 1)).toBe(2);
    expect(findNextEnabled(items, 3, 1)).toBe(3);
    expect(findNextEnabled(items, 4, 1)).toBe(4);
  });

  it("moves backward through sequential enabled items", () => {
    const items = enabledItems(5);
    // Simulating pressing up from index 4: next search starts at 3
    expect(findNextEnabled(items, 3, -1)).toBe(3);
    expect(findNextEnabled(items, 2, -1)).toBe(2);
    expect(findNextEnabled(items, 1, -1)).toBe(1);
    expect(findNextEnabled(items, 0, -1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findNextEnabled — disabled-item skipping
// ---------------------------------------------------------------------------

describe("findNextEnabled — disabled-item skipping", () => {
  it("skips a single disabled item going forward", () => {
    const items = [item("a"), item("b", true), item("c")];
    // From index 0, pressing down: search starts at 1, skips disabled b, lands on c
    expect(findNextEnabled(items, 1, 1)).toBe(2);
  });

  it("skips a single disabled item going backward", () => {
    const items = [item("a"), item("b", true), item("c")];
    // From index 2, pressing up: search starts at 1, skips disabled b, lands on a
    expect(findNextEnabled(items, 1, -1)).toBe(0);
  });

  it("skips multiple consecutive disabled items going forward", () => {
    const items = [
      item("a"),
      item("b", true),
      item("c", true),
      item("d", true),
      item("e"),
    ];
    expect(findNextEnabled(items, 1, 1)).toBe(4);
  });

  it("skips multiple consecutive disabled items going backward", () => {
    const items = [
      item("a"),
      item("b", true),
      item("c", true),
      item("d", true),
      item("e"),
    ];
    expect(findNextEnabled(items, 3, -1)).toBe(0);
  });

  it("returns -1 when all items are disabled", () => {
    const items = [item("a", true), item("b", true), item("c", true)];
    expect(findNextEnabled(items, 0, 1)).toBe(-1);
    expect(findNextEnabled(items, 0, -1)).toBe(-1);
    expect(findNextEnabled(items, 2, 1)).toBe(-1);
    expect(findNextEnabled(items, 1, -1)).toBe(-1);
  });

  it("finds the only enabled item among disabled ones", () => {
    const items = [item("a", true), item("b"), item("c", true)];
    expect(findNextEnabled(items, 0, 1)).toBe(1);
    expect(findNextEnabled(items, 2, -1)).toBe(1);
  });

  it("skips disabled items at the beginning when searching forward from 0", () => {
    const items = [item("a", true), item("b", true), item("c")];
    expect(findNextEnabled(items, 0, 1)).toBe(2);
  });

  it("skips disabled items at the end when searching backward from last", () => {
    const items = [item("a"), item("b", true), item("c", true)];
    expect(findNextEnabled(items, 2, -1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findNextEnabled — boundary wrap
// ---------------------------------------------------------------------------

describe("findNextEnabled — boundary wrap", () => {
  it("wraps forward from last to first enabled item", () => {
    const items = enabledItems(4);
    // From index 3 (last), pressing down: search starts at 4 (out of bounds)
    // Should wrap to 0
    expect(findNextEnabled(items, 4, 1)).toBe(0);
  });

  it("wraps backward from first to last enabled item", () => {
    const items = enabledItems(4);
    // From index 0, pressing up: search starts at -1
    // Should wrap to 3
    expect(findNextEnabled(items, -1, -1)).toBe(3);
  });

  it("wraps forward, skipping disabled items at the start", () => {
    const items = [item("a", true), item("b"), item("c"), item("d")];
    // Wrapping from end: search starts at 4 (beyond last)
    // Items at index 0 is disabled, so should land on index 1
    expect(findNextEnabled(items, 4, 1)).toBe(1);
  });

  it("wraps backward, skipping disabled items at the end", () => {
    const items = [item("a"), item("b"), item("c", true), item("d", true)];
    // Wrapping from start: search starts at -1
    // Items at index 3 and 2 are disabled, so should land on index 1
    expect(findNextEnabled(items, -1, -1)).toBe(1);
  });

  it("wraps through entirely disabled region to find enabled item", () => {
    // Only item-1 is enabled, everything else disabled
    const items = [
      item("a", true),
      item("b"),
      item("c", true),
      item("d", true),
      item("e", true),
    ];
    // Starting from index 2 going forward: 2,3,4 all disabled, wraps to 0 (disabled), lands on 1
    expect(findNextEnabled(items, 2, 1)).toBe(1);
    // Starting from index 0 going backward: 0 disabled, wraps to 4,3,2 all disabled, lands on 1
    expect(findNextEnabled(items, 0, -1)).toBe(1);
  });

  it("handles wrap with negative modulo correctly", () => {
    const items = enabledItems(3);
    // Large negative start index
    expect(findNextEnabled(items, -5, -1)).toBe(1);
    // Large positive start index
    expect(findNextEnabled(items, 10, 1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findNextEnabled — simulated arrow key sequences
// ---------------------------------------------------------------------------

describe("findNextEnabled — simulated navigation sequences", () => {
  it("simulates full down-arrow traversal with wrap", () => {
    const items = enabledItems(3);
    // Start at 0, repeatedly press down
    let cursor = findNextEnabled(items, 0, 1); // initial: 0
    expect(cursor).toBe(0);
    cursor = findNextEnabled(items, cursor + 1, 1); // down: 1
    expect(cursor).toBe(1);
    cursor = findNextEnabled(items, cursor + 1, 1); // down: 2
    expect(cursor).toBe(2);
    cursor = findNextEnabled(items, cursor + 1, 1); // down: wraps to 0
    expect(cursor).toBe(0);
  });

  it("simulates full up-arrow traversal with wrap", () => {
    const items = enabledItems(3);
    let cursor = findNextEnabled(items, 2, -1); // start at last
    expect(cursor).toBe(2);
    cursor = findNextEnabled(items, cursor - 1, -1); // up: 1
    expect(cursor).toBe(1);
    cursor = findNextEnabled(items, cursor - 1, -1); // up: 0
    expect(cursor).toBe(0);
    cursor = findNextEnabled(items, cursor - 1, -1); // up: wraps to 2
    expect(cursor).toBe(2);
  });

  it("simulates navigation through mixed enabled/disabled items", () => {
    const items = [
      item("a"),
      item("b", true),
      item("c"),
      item("d", true),
      item("e"),
    ];
    // Initial cursor at 0
    let cursor = findNextEnabled(items, 0, 1);
    expect(cursor).toBe(0);

    // Down: skip disabled b, land on c
    cursor = findNextEnabled(items, cursor + 1, 1);
    expect(cursor).toBe(2);

    // Down: skip disabled d, land on e
    cursor = findNextEnabled(items, cursor + 1, 1);
    expect(cursor).toBe(4);

    // Down: wrap, skip disabled b, land on a... wait: wraps to 0 (enabled)
    cursor = findNextEnabled(items, cursor + 1, 1);
    expect(cursor).toBe(0);

    // Now go up from 0: wrap to 4 (e, enabled)
    cursor = findNextEnabled(items, cursor - 1, -1);
    expect(cursor).toBe(4);

    // Up from 4: skip disabled d, land on c
    cursor = findNextEnabled(items, cursor - 1, -1);
    expect(cursor).toBe(2);

    // Up from 2: skip disabled b, land on a
    cursor = findNextEnabled(items, cursor - 1, -1);
    expect(cursor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeViewport — basic behavior
// ---------------------------------------------------------------------------

describe("computeViewport — basic behavior", () => {
  it("returns full range when height >= totalItems", () => {
    expect(computeViewport(5, 0, 10)).toEqual({ start: 0, end: 5 });
    expect(computeViewport(5, 2, 5)).toEqual({ start: 0, end: 5 });
    expect(computeViewport(3, 1, 100)).toEqual({ start: 0, end: 3 });
  });

  it("returns full range when height equals totalItems", () => {
    expect(computeViewport(5, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(computeViewport(5, 4, 5)).toEqual({ start: 0, end: 5 });
  });

  it("viewport size never exceeds totalItems", () => {
    const vp = computeViewport(3, 0, 10);
    expect(vp.end - vp.start).toBe(3);
  });

  it("viewport size equals height when totalItems > height", () => {
    const vp = computeViewport(20, 10, 5);
    expect(vp.end - vp.start).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeViewport — cursor tracking
// ---------------------------------------------------------------------------

describe("computeViewport — cursor tracking", () => {
  it("keeps cursor visible within the viewport", () => {
    for (let cursor = 0; cursor < 20; cursor++) {
      const vp = computeViewport(20, cursor, 5);
      expect(cursor).toBeGreaterThanOrEqual(vp.start);
      expect(cursor).toBeLessThan(vp.end);
    }
  });

  it("centers cursor in viewport when possible", () => {
    // With 20 items and viewport of 5, cursor at 10 should be roughly centered
    const vp = computeViewport(20, 10, 5);
    expect(vp.start).toBe(8); // 10 - floor(5/2) = 8
    expect(vp.end).toBe(13);
  });

  it("clamps viewport start to 0 when cursor is near the beginning", () => {
    const vp = computeViewport(20, 1, 5);
    expect(vp.start).toBe(0);
    expect(vp.end).toBe(5);
  });

  it("clamps viewport end to totalItems when cursor is near the end", () => {
    const vp = computeViewport(20, 19, 5);
    expect(vp.end).toBe(20);
    expect(vp.start).toBe(15);
  });

  it("handles cursor at first position", () => {
    const vp = computeViewport(20, 0, 5);
    expect(vp.start).toBe(0);
    expect(vp.end).toBe(5);
  });

  it("handles cursor at last position", () => {
    const vp = computeViewport(20, 19, 5);
    expect(vp.start).toBe(15);
    expect(vp.end).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// computeViewport — scrolling scenarios
// ---------------------------------------------------------------------------

describe("computeViewport — scrolling scenarios", () => {
  it("scrolls down as cursor moves past center", () => {
    // Simulating scrolling through a 10-item list with viewport of 3
    const vp0 = computeViewport(10, 0, 3);
    expect(vp0).toEqual({ start: 0, end: 3 });

    const vp1 = computeViewport(10, 1, 3);
    expect(vp1).toEqual({ start: 0, end: 3 });

    const vp2 = computeViewport(10, 2, 3);
    expect(vp2).toEqual({ start: 1, end: 4 });

    const vp5 = computeViewport(10, 5, 3);
    expect(vp5).toEqual({ start: 4, end: 7 });
  });

  it("stops scrolling at the bottom edge", () => {
    const vp8 = computeViewport(10, 8, 3);
    expect(vp8).toEqual({ start: 7, end: 10 });

    const vp9 = computeViewport(10, 9, 3);
    expect(vp9).toEqual({ start: 7, end: 10 });
  });

  it("handles viewport of 1 (each item fills the viewport)", () => {
    for (let i = 0; i < 5; i++) {
      const vp = computeViewport(5, i, 1);
      expect(vp).toEqual({ start: i, end: i + 1 });
    }
  });

  it("handles viewport of 2 with various cursor positions", () => {
    // 6 items, viewport of 2
    expect(computeViewport(6, 0, 2)).toEqual({ start: 0, end: 2 });
    expect(computeViewport(6, 1, 2)).toEqual({ start: 0, end: 2 });
    expect(computeViewport(6, 3, 2)).toEqual({ start: 2, end: 4 });
    expect(computeViewport(6, 5, 2)).toEqual({ start: 4, end: 6 });
  });
});

// ---------------------------------------------------------------------------
// computeViewport — edge cases
// ---------------------------------------------------------------------------

describe("computeViewport — edge cases", () => {
  it("handles single item list", () => {
    expect(computeViewport(1, 0, 5)).toEqual({ start: 0, end: 1 });
    expect(computeViewport(1, 0, 1)).toEqual({ start: 0, end: 1 });
  });

  it("handles totalItems of 2 with viewport of 1", () => {
    expect(computeViewport(2, 0, 1)).toEqual({ start: 0, end: 1 });
    expect(computeViewport(2, 1, 1)).toEqual({ start: 1, end: 2 });
  });

  it("viewport start is never negative", () => {
    const vp = computeViewport(100, 0, 5);
    expect(vp.start).toBeGreaterThanOrEqual(0);
  });

  it("viewport end never exceeds totalItems", () => {
    const vp = computeViewport(10, 9, 5);
    expect(vp.end).toBeLessThanOrEqual(10);
  });

  it("maintains invariant: end - start == min(height, totalItems)", () => {
    const cases = [
      { total: 20, cursor: 5, height: 5 },
      { total: 3, cursor: 1, height: 10 },
      { total: 1, cursor: 0, height: 1 },
      { total: 100, cursor: 99, height: 7 },
      { total: 50, cursor: 0, height: 3 },
    ];
    for (const { total, cursor, height } of cases) {
      const vp = computeViewport(total, cursor, height);
      expect(vp.end - vp.start).toBe(Math.min(height, total));
    }
  });
});
