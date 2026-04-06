/**
 * Tests for `src/tui/app.tsx` — screen router pure helpers.
 *
 * Tests the `handleAction` function which maps raw action strings to
 * dispatch results. Component rendering tests are deferred until
 * `ink-testing-library` is available.
 */

import { describe, it, expect } from "bun:test";
import { handleAction } from "./app.tsx";
import type { ActionType } from "./types.ts";
import { ACTION_TYPES } from "./types.ts";

// ---------------------------------------------------------------------------
// handleAction
// ---------------------------------------------------------------------------

describe("handleAction", () => {
  it("returns null for unknown action strings", () => {
    expect(handleAction("unknown-action")).toBeNull();
    expect(handleAction("")).toBeNull();
    expect(handleAction("__group__START")).toBeNull();
  });

  it("returns null for dropped action values", () => {
    // These were in the old interactive menu but removed from the TUI
    expect(handleAction("recent-activity")).toBeNull();
    expect(handleAction("view-config")).toBeNull();
    expect(handleAction("edit-config")).toBeNull();
  });

  it("returns a DispatchResult for every known ActionType", () => {
    for (const action of ACTION_TYPES) {
      const result = handleAction(action);
      expect(result).not.toBeNull();
      expect(["stay", "exit", "navigate", "exit-to-runner"]).toContain(
        result!.type,
      );
    }
  });

  describe("exit actions", () => {
    it("quit returns exit", () => {
      const result = handleAction("quit");
      expect(result).toEqual({ type: "exit" });
    });
  });

  describe("runner actions", () => {
    it("run-next returns exit-to-runner", () => {
      const result = handleAction("run-next");
      expect(result).toEqual({ type: "exit-to-runner", args: ["run"] });
    });
  });

  describe("stay actions", () => {
    const stayActions: ActionType[] = [
      "resume-stalled",
      "pick-from-backlog",
      "pick-from-github",
      "run-with-options",
      "stop-running",
      "reset-plan",
      "view-status",
      "doctor",
      "clean",
      "settings",
    ];

    for (const action of stayActions) {
      it(`${action} returns stay`, () => {
        const result = handleAction(action);
        expect(result).toEqual({ type: "stay" });
      });
    }
  });

  describe("consistency with menu items", () => {
    it("handles all 12 action types", () => {
      let count = 0;
      for (const action of ACTION_TYPES) {
        const result = handleAction(action);
        if (result) count++;
      }
      expect(count).toBe(12);
    });
  });
});
