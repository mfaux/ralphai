/**
 * Tests for `src/tui/app.tsx` — screen router pure helpers.
 *
 * Tests the `handleAction` function which maps raw action strings to
 * dispatch results. Component rendering tests are deferred until
 * `ink-testing-library` is available.
 */

import { describe, it, expect } from "bun:test";
import { handleAction } from "./app.tsx";
import { ACTION_TYPES, toConfirmNav, toOptionsNav } from "./types.ts";
import type { RunConfig } from "./types.ts";

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
    it("run-next returns exit-to-runner (intercepted by App via toConfirmNav)", () => {
      const result = handleAction("run-next");
      expect(result).toEqual({ type: "exit-to-runner", args: ["run"] });

      // The App component wraps this through toConfirmNav, producing
      // a navigate-to-confirm result. Verify the full flow:
      const config: RunConfig = {
        agentCommand: "claude-code",
        feedbackCommands: "bun test",
      };
      const confirmed = toConfirmNav(result!, config, { type: "menu" });
      expect(confirmed.type).toBe("navigate");
      if (confirmed.type === "navigate") {
        expect(confirmed.screen.type).toBe("confirm");
        if (confirmed.screen.type === "confirm") {
          expect(confirmed.screen.backScreen?.type).toBe("menu");
        }
      }
    });
  });

  describe("navigate actions", () => {
    it("pick-from-backlog navigates to backlog-picker", () => {
      const result = handleAction("pick-from-backlog");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "backlog-picker" },
      });
    });

    it("pick-from-github navigates to issue-picker", () => {
      const result = handleAction("pick-from-github");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "issue-picker" },
      });
    });

    it("stop-running navigates to stop screen", () => {
      const result = handleAction("stop-running");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "stop" },
      });
    });

    it("reset-plan navigates to reset screen", () => {
      const result = handleAction("reset-plan");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "reset" },
      });
    });

    it("view-status navigates to status screen", () => {
      const result = handleAction("view-status");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "status" },
      });
    });

    it("doctor navigates to doctor screen", () => {
      const result = handleAction("doctor");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "doctor" },
      });
    });

    it("clean navigates to clean screen", () => {
      const result = handleAction("clean");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "clean" },
      });
    });

    it("resume-stalled navigates to resume-stalled screen", () => {
      const result = handleAction("resume-stalled");
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "resume-stalled" },
      });
    });
  });

  describe("settings action", () => {
    it('settings returns exit-to-runner with ["init", "--force"] (dispatched directly, no confirm screen)', () => {
      const result = handleAction("settings");
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["init", "--force"],
      });

      // Unlike run actions, settings dispatches directly — it does NOT
      // go through toConfirmNav. The App component has a special case
      // for "settings" that calls dispatch(result) directly so the
      // TUI exits and `ralphai init --force` runs in the terminal.
    });
  });

  describe("options action", () => {
    it("run-with-options returns exit-to-runner (intercepted by App via toOptionsNav)", () => {
      const result = handleAction("run-with-options");
      expect(result).toEqual({ type: "exit-to-runner", args: ["run"] });

      // The App component wraps this through toOptionsNav, producing
      // a navigate-to-options result. Verify the full flow:
      const config: RunConfig = {
        agentCommand: "claude-code",
        feedbackCommands: "bun test",
      };
      const optioned = toOptionsNav(result!, config, { type: "menu" });
      expect(optioned.type).toBe("navigate");
      if (optioned.type === "navigate") {
        expect(optioned.screen.type).toBe("options");
        if (optioned.screen.type === "options") {
          expect(optioned.screen.backScreen?.type).toBe("menu");
          expect(optioned.screen.data.runArgs).toEqual(["run"]);
        }
      }
    });
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
