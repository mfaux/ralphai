/**
 * Tests for the split-layout component's pure layout helpers.
 *
 * Tests the exported pure functions from `src/tui/components/split-layout.tsx`:
 * - `shouldSplit` — threshold check for split vs single-pane mode
 * - `computePaneWidths` — left/right width allocation
 *
 * Component-level rendering tests (verifying Ink output and resize
 * reactivity) are deferred until `ink-testing-library` is available.
 */

import { describe, it, expect } from "bun:test";
import {
  shouldSplit,
  computePaneWidths,
  SPLIT_THRESHOLD,
  SEPARATOR_WIDTH,
  LEFT_PANE_RATIO,
} from "./split-layout.tsx";

// ---------------------------------------------------------------------------
// shouldSplit — threshold detection
// ---------------------------------------------------------------------------

describe("shouldSplit", () => {
  it("returns false when terminal width is below the threshold", () => {
    expect(shouldSplit(80)).toBe(false);
    expect(shouldSplit(100)).toBe(false);
    expect(shouldSplit(119)).toBe(false);
  });

  it("returns true when terminal width equals the threshold", () => {
    expect(shouldSplit(SPLIT_THRESHOLD)).toBe(true);
    expect(shouldSplit(120)).toBe(true);
  });

  it("returns true when terminal width exceeds the threshold", () => {
    expect(shouldSplit(121)).toBe(true);
    expect(shouldSplit(200)).toBe(true);
    expect(shouldSplit(400)).toBe(true);
  });

  it("returns false for very small terminal widths", () => {
    expect(shouldSplit(1)).toBe(false);
    expect(shouldSplit(20)).toBe(false);
  });

  it("threshold constant is 120", () => {
    expect(SPLIT_THRESHOLD).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// computePaneWidths — returns null below threshold
// ---------------------------------------------------------------------------

describe("computePaneWidths — below threshold", () => {
  it("returns null for narrow terminals", () => {
    expect(computePaneWidths(80)).toBeNull();
    expect(computePaneWidths(100)).toBeNull();
    expect(computePaneWidths(119)).toBeNull();
  });

  it("returns null for very small terminals", () => {
    expect(computePaneWidths(1)).toBeNull();
    expect(computePaneWidths(20)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computePaneWidths — width allocation above threshold
// ---------------------------------------------------------------------------

describe("computePaneWidths — width allocation", () => {
  it("returns non-null for terminals at the threshold", () => {
    const result = computePaneWidths(120);
    expect(result).not.toBeNull();
  });

  it("allocates left pane using LEFT_PANE_RATIO of available width", () => {
    const result = computePaneWidths(120)!;
    const available = 120 - SEPARATOR_WIDTH;
    const expectedLeft = Math.floor(available * LEFT_PANE_RATIO);
    expect(result.left).toBe(expectedLeft);
  });

  it("allocates right pane as the remainder after left + separator", () => {
    const result = computePaneWidths(120)!;
    const available = 120 - SEPARATOR_WIDTH;
    const expectedLeft = Math.floor(available * LEFT_PANE_RATIO);
    expect(result.right).toBe(available - expectedLeft);
  });

  it("left + right + separator equals terminal width", () => {
    for (const width of [120, 150, 200, 300]) {
      const result = computePaneWidths(width)!;
      expect(result.left + result.right + SEPARATOR_WIDTH).toBe(width);
    }
  });

  it("left pane is narrower than right pane (40/60 ratio)", () => {
    const result = computePaneWidths(200)!;
    expect(result.left).toBeLessThan(result.right);
  });

  it("both panes have at least 1 column", () => {
    // Even at the exact threshold, both panes should have positive width
    const result = computePaneWidths(SPLIT_THRESHOLD)!;
    expect(result.left).toBeGreaterThanOrEqual(1);
    expect(result.right).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// computePaneWidths — various terminal widths
// ---------------------------------------------------------------------------

describe("computePaneWidths — various widths", () => {
  it("handles 120-column terminal", () => {
    const result = computePaneWidths(120)!;
    // available = 120 - 3 = 117
    // left = floor(117 * 0.4) = floor(46.8) = 46
    // right = 117 - 46 = 71
    expect(result.left).toBe(46);
    expect(result.right).toBe(71);
  });

  it("handles 160-column terminal", () => {
    const result = computePaneWidths(160)!;
    // available = 160 - 3 = 157
    // left = floor(157 * 0.4) = floor(62.8) = 62
    // right = 157 - 62 = 95
    expect(result.left).toBe(62);
    expect(result.right).toBe(95);
  });

  it("handles 200-column terminal", () => {
    const result = computePaneWidths(200)!;
    // available = 200 - 3 = 197
    // left = floor(197 * 0.4) = floor(78.8) = 78
    // right = 197 - 78 = 119
    expect(result.left).toBe(78);
    expect(result.right).toBe(119);
  });

  it("handles very wide terminal (400 columns)", () => {
    const result = computePaneWidths(400)!;
    // available = 400 - 3 = 397
    // left = floor(397 * 0.4) = floor(158.8) = 158
    // right = 397 - 158 = 239
    expect(result.left).toBe(158);
    expect(result.right).toBe(239);
    expect(result.left + result.right + SEPARATOR_WIDTH).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// computePaneWidths — threshold boundary
// ---------------------------------------------------------------------------

describe("computePaneWidths — threshold boundary", () => {
  it("returns null at 119 columns (just below threshold)", () => {
    expect(computePaneWidths(119)).toBeNull();
  });

  it("returns widths at 120 columns (exactly at threshold)", () => {
    expect(computePaneWidths(120)).not.toBeNull();
  });

  it("returns widths at 121 columns (just above threshold)", () => {
    const result = computePaneWidths(121)!;
    expect(result.left).toBeGreaterThanOrEqual(1);
    expect(result.right).toBeGreaterThanOrEqual(1);
  });

  it("simulates crossing threshold: narrow → wide → narrow", () => {
    // Start narrow
    expect(computePaneWidths(100)).toBeNull();

    // Resize to wide
    const wide = computePaneWidths(150)!;
    expect(wide.left).toBeGreaterThanOrEqual(1);
    expect(wide.right).toBeGreaterThanOrEqual(1);

    // Resize back to narrow
    expect(computePaneWidths(100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("layout constants", () => {
  it("SEPARATOR_WIDTH is 3 (padding + character + padding)", () => {
    expect(SEPARATOR_WIDTH).toBe(3);
  });

  it("LEFT_PANE_RATIO is 0.4 (40% for menu)", () => {
    expect(LEFT_PANE_RATIO).toBe(0.4);
  });
});
