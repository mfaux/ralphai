/**
 * Tests for the options screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/options.tsx`:
 * - `optionsKeyHandler` — maps key input to an OptionsIntent
 * - `resolveOptionsIntent` — maps an OptionsIntent to a DispatchResult
 */

import { describe, it, expect } from "bun:test";
import type { Key } from "ink";
import type { ConfirmData } from "./confirm.tsx";
import { optionsKeyHandler, resolveOptionsIntent } from "./options.tsx";
import type { Screen } from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeData(overrides?: Partial<ConfirmData>): ConfirmData {
  return {
    title: "feat-login.md",
    agentCommand: "claude-code",
    branch: "ralphai/feat-login",
    feedbackCommands: "bun run build && bun run test",
    runArgs: ["run", "--plan", "feat-login.md"],
    ...overrides,
  };
}

function makeKey(overrides?: Partial<Key>): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// optionsKeyHandler
// ---------------------------------------------------------------------------

describe("optionsKeyHandler", () => {
  it("returns 'confirm' for Enter key", () => {
    expect(optionsKeyHandler("", makeKey({ return: true }))).toBe("confirm");
  });

  it("returns 'back' for Escape key", () => {
    expect(optionsKeyHandler("", makeKey({ escape: true }))).toBe("back");
  });

  it("returns null for unrecognized keys", () => {
    expect(optionsKeyHandler("o", makeKey())).toBeNull();
    expect(optionsKeyHandler("x", makeKey())).toBeNull();
    expect(optionsKeyHandler("a", makeKey())).toBeNull();
    expect(optionsKeyHandler("", makeKey())).toBeNull();
  });

  it("returns null for arrow keys", () => {
    expect(optionsKeyHandler("", makeKey({ upArrow: true }))).toBeNull();
    expect(optionsKeyHandler("", makeKey({ downArrow: true }))).toBeNull();
  });

  it("returns 'confirm' when Enter coincides with other flags", () => {
    expect(optionsKeyHandler("", makeKey({ return: true, ctrl: true }))).toBe(
      "confirm",
    );
  });

  it("returns 'back' for Escape even with input characters", () => {
    expect(optionsKeyHandler("o", makeKey({ escape: true }))).toBe("back");
  });
});

// ---------------------------------------------------------------------------
// resolveOptionsIntent
// ---------------------------------------------------------------------------

describe("resolveOptionsIntent", () => {
  describe("confirm intent", () => {
    it("returns exit-to-runner with the data's runArgs", () => {
      const data = makeData({ runArgs: ["run", "--plan", "my-plan.md"] });
      const result = resolveOptionsIntent("confirm", data, { type: "menu" });
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["run", "--plan", "my-plan.md"],
      });
    });

    it("returns exit-to-runner for issue targets", () => {
      const data = makeData({ runArgs: ["run", "42"] });
      const result = resolveOptionsIntent("confirm", data, { type: "menu" });
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["run", "42"],
      });
    });
  });

  describe("back intent", () => {
    it("navigates to backScreen when it is the confirm screen", () => {
      const data = makeData();
      const confirmData = makeData();
      const backScreen: Screen = { type: "confirm", data: confirmData };
      const result = resolveOptionsIntent("back", data, backScreen);
      expect(result).toEqual({
        type: "navigate",
        screen: backScreen,
      });
    });

    it("navigates to menu when backScreen is menu", () => {
      const data = makeData();
      const result = resolveOptionsIntent("back", data, { type: "menu" });
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "menu" },
      });
    });

    it("preserves the exact backScreen reference", () => {
      const data = makeData();
      const backScreen: Screen = { type: "confirm", data: makeData() };
      const result = resolveOptionsIntent("back", data, backScreen);
      if (result.type === "navigate") {
        expect(result.screen).toBe(backScreen);
      }
    });
  });

  describe("end-to-end: key press → intent → dispatch", () => {
    it("Enter key → confirm intent → exit-to-runner", () => {
      const key = makeKey({ return: true });
      const intent = optionsKeyHandler("", key);
      expect(intent).toBe("confirm");

      const data = makeData({ runArgs: ["run", "42"] });
      const result = resolveOptionsIntent(intent!, data, { type: "menu" });
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["run", "42"],
      });
    });

    it("Esc key → back intent → navigate to confirm screen", () => {
      const key = makeKey({ escape: true });
      const intent = optionsKeyHandler("", key);
      expect(intent).toBe("back");

      const data = makeData();
      const confirmData = makeData();
      const backScreen: Screen = {
        type: "confirm",
        data: confirmData,
        backScreen: { type: "issue-picker" },
      };
      const result = resolveOptionsIntent(intent!, data, backScreen);
      expect(result).toEqual({
        type: "navigate",
        screen: backScreen,
      });
    });
  });
});
