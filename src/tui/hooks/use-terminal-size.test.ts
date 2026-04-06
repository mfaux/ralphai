/**
 * Tests for the use-terminal-size hook.
 *
 * Like the other hook tests in this directory, we test the exported
 * pure `sizeReducer` state machine that drives the hook. This covers:
 *   - Reducer replaces dimensions on resize action
 *   - Reducer handles various dimension values
 *
 * Component-level rendering tests (verifying SIGWINCH subscription
 * and cleanup) are deferred until `ink-testing-library` is available.
 */

import { describe, it, expect } from "bun:test";
import {
  sizeReducer,
  type TerminalSize,
  type SizeAction,
} from "./use-terminal-size.ts";

// ---------------------------------------------------------------------------
// sizeReducer
// ---------------------------------------------------------------------------

describe("sizeReducer", () => {
  // -----------------------------------------------------------------------
  // resize action
  // -----------------------------------------------------------------------

  describe("resize action", () => {
    it("updates dimensions from initial size", () => {
      const initial: TerminalSize = { width: 80, height: 24 };
      const action: SizeAction = { type: "resize", width: 120, height: 40 };

      const next = sizeReducer(initial, action);
      expect(next.width).toBe(120);
      expect(next.height).toBe(40);
    });

    it("replaces previous dimensions entirely", () => {
      const current: TerminalSize = { width: 200, height: 50 };
      const action: SizeAction = { type: "resize", width: 80, height: 24 };

      const next = sizeReducer(current, action);
      expect(next.width).toBe(80);
      expect(next.height).toBe(24);
    });

    it("returns a new object (immutable)", () => {
      const current: TerminalSize = { width: 80, height: 24 };
      const action: SizeAction = { type: "resize", width: 80, height: 24 };

      const next = sizeReducer(current, action);
      expect(next).toEqual(current);
      expect(next).not.toBe(current); // new reference
    });

    it("handles very small terminal sizes", () => {
      const current: TerminalSize = { width: 80, height: 24 };
      const action: SizeAction = { type: "resize", width: 20, height: 5 };

      const next = sizeReducer(current, action);
      expect(next.width).toBe(20);
      expect(next.height).toBe(5);
    });

    it("handles very large terminal sizes", () => {
      const current: TerminalSize = { width: 80, height: 24 };
      const action: SizeAction = { type: "resize", width: 400, height: 100 };

      const next = sizeReducer(current, action);
      expect(next.width).toBe(400);
      expect(next.height).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // Full lifecycle
  // -----------------------------------------------------------------------

  describe("full lifecycle", () => {
    it("handles multiple sequential resizes", () => {
      let s: TerminalSize = { width: 80, height: 24 };

      // First resize — expand width
      s = sizeReducer(s, { type: "resize", width: 120, height: 24 });
      expect(s).toEqual({ width: 120, height: 24 });

      // Second resize — expand both
      s = sizeReducer(s, { type: "resize", width: 200, height: 50 });
      expect(s).toEqual({ width: 200, height: 50 });

      // Third resize — shrink back
      s = sizeReducer(s, { type: "resize", width: 80, height: 24 });
      expect(s).toEqual({ width: 80, height: 24 });
    });

    it("handles resize crossing the 120-column threshold both ways", () => {
      // Start below threshold
      let s: TerminalSize = { width: 100, height: 30 };
      expect(s.width).toBeLessThan(120);

      // Resize above threshold
      s = sizeReducer(s, { type: "resize", width: 150, height: 30 });
      expect(s.width).toBeGreaterThanOrEqual(120);

      // Resize back below threshold
      s = sizeReducer(s, { type: "resize", width: 100, height: 30 });
      expect(s.width).toBeLessThan(120);
    });
  });
});
