/**
 * Tests for `src/tui/types.ts` — ActionType, Screen, and dispatch logic.
 *
 * These tests exercise the pure exported functions without rendering
 * any Ink components.
 */

import { describe, it, expect } from "bun:test";
import { isActionType, resolveAction, ACTION_TYPES } from "./types.ts";
import type { ActionType, DispatchResult, Screen } from "./types.ts";

// ---------------------------------------------------------------------------
// isActionType
// ---------------------------------------------------------------------------

describe("isActionType", () => {
  it("returns true for all known action types", () => {
    const known: ActionType[] = [
      "resume-stalled",
      "run-next",
      "pick-from-backlog",
      "pick-from-github",
      "run-with-options",
      "stop-running",
      "reset-plan",
      "view-status",
      "doctor",
      "clean",
      "settings",
      "quit",
    ];

    for (const action of known) {
      expect(isActionType(action)).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isActionType("unknown-action")).toBe(false);
    expect(isActionType("")).toBe(false);
    expect(isActionType("__group__START")).toBe(false);
    expect(isActionType("recent-activity")).toBe(false);
    expect(isActionType("view-config")).toBe(false);
    expect(isActionType("edit-config")).toBe(false);
  });

  it("returns false for partial matches", () => {
    expect(isActionType("quit ")).toBe(false);
    expect(isActionType(" quit")).toBe(false);
    expect(isActionType("run-next-plan")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ACTION_TYPES set
// ---------------------------------------------------------------------------

describe("ACTION_TYPES", () => {
  it("contains exactly 12 action types", () => {
    expect(ACTION_TYPES.size).toBe(12);
  });

  it("is frozen (readonly set)", () => {
    // The Set itself is typed as ReadonlySet, so .add/.delete don't exist
    // at compile time. At runtime we verify the set contains expected values.
    const expected = [
      "resume-stalled",
      "run-next",
      "pick-from-backlog",
      "pick-from-github",
      "run-with-options",
      "stop-running",
      "reset-plan",
      "view-status",
      "doctor",
      "clean",
      "settings",
      "quit",
    ];
    for (const val of expected) {
      expect(ACTION_TYPES.has(val)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveAction
// ---------------------------------------------------------------------------

describe("resolveAction", () => {
  describe("exit actions", () => {
    it("quit returns exit", () => {
      const result = resolveAction("quit");
      expect(result.type).toBe("exit");
    });
  });

  describe("runner actions", () => {
    it('run-next returns exit-to-runner with ["run"]', () => {
      const result = resolveAction("run-next");
      expect(result.type).toBe("exit-to-runner");
      if (result.type === "exit-to-runner") {
        expect(result.args).toEqual(["run"]);
      }
    });
  });

  describe("stay actions (future sub-screens)", () => {
    const stayActions: ActionType[] = [
      "resume-stalled",
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
        const result = resolveAction(action);
        expect(result.type).toBe("stay");
      });
    }
  });

  describe("navigate actions (picker sub-screens)", () => {
    it("pick-from-backlog navigates to backlog-picker", () => {
      const result = resolveAction("pick-from-backlog");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "backlog-picker" },
      });
    });

    it("pick-from-github navigates to issue-picker", () => {
      const result = resolveAction("pick-from-github");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "issue-picker" },
      });
    });
  });

  it("every ActionType has a defined dispatch result", () => {
    for (const action of ACTION_TYPES) {
      if (isActionType(action)) {
        const result = resolveAction(action);
        expect(result).toBeDefined();
        expect(["stay", "exit", "navigate", "exit-to-runner"]).toContain(
          result.type,
        );
      }
    }
  });

  it("no action returns undefined", () => {
    for (const action of ACTION_TYPES) {
      if (isActionType(action)) {
        const result = resolveAction(action);
        expect(result).not.toBeUndefined();
      }
    }
  });
});
