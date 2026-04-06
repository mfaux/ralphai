/**
 * Tests for the split-layout component's pure layout helpers.
 *
 * Tests the exported pure functions from `src/tui/components/split-layout.tsx`:
 * - `shouldSplit` — threshold check for split vs single-pane mode
 *
 * Component-level rendering tests (verifying Ink output and resize
 * reactivity) are deferred until `ink-testing-library` is available.
 */

import { describe, it, expect } from "bun:test";
import {
  shouldSplit,
  SPLIT_THRESHOLD,
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
