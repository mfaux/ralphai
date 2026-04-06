/**
 * Tests for the confirm screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/confirm.tsx`:
 * - `buildConfirmLines` — builds display lines from ConfirmData
 * - `confirmKeyHandler` — maps key input to a ConfirmIntent
 * - `resolveConfirmIntent` — maps a ConfirmIntent to a DispatchResult
 */

import { describe, it, expect } from "bun:test";
import type { Key } from "ink";
import type { ConfirmData, PrdContext } from "./confirm.tsx";
import {
  buildConfirmLines,
  confirmKeyHandler,
  resolveConfirmIntent,
} from "./confirm.tsx";
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

function makePrdContext(overrides?: Partial<PrdContext>): PrdContext {
  return {
    prdTitle: "Auth Redesign",
    position: "1 of 3 remaining",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildConfirmLines
// ---------------------------------------------------------------------------

describe("buildConfirmLines", () => {
  it("returns target, agent, branch, and feedback lines for basic data", () => {
    const data = makeData();
    const lines = buildConfirmLines(data);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({ label: "Target", value: "feat-login.md" });
    expect(lines[1]).toEqual({ label: "Agent", value: "claude-code" });
    expect(lines[2]).toEqual({
      label: "Branch",
      value: "ralphai/feat-login",
    });
    expect(lines[3]).toEqual({
      label: "Feedback",
      value: "bun run build && bun run test",
    });
  });

  it("includes PRD context lines when prdContext is provided", () => {
    const data = makeData({ prdContext: makePrdContext() });
    const lines = buildConfirmLines(data);

    expect(lines).toHaveLength(6);
    expect(lines[0]).toEqual({ label: "Target", value: "feat-login.md" });
    expect(lines[1]).toEqual({ label: "PRD", value: "Auth Redesign" });
    expect(lines[2]).toEqual({
      label: "Position",
      value: "1 of 3 remaining",
    });
    expect(lines[3]).toEqual({ label: "Agent", value: "claude-code" });
    expect(lines[4]).toEqual({
      label: "Branch",
      value: "ralphai/feat-login",
    });
    expect(lines[5]).toEqual({
      label: "Feedback",
      value: "bun run build && bun run test",
    });
  });

  it("omits PRD lines when prdContext is undefined", () => {
    const data = makeData({ prdContext: undefined });
    const lines = buildConfirmLines(data);

    const labels = lines.map((l) => l.label);
    expect(labels).not.toContain("PRD");
    expect(labels).not.toContain("Position");
  });

  it("omits agent line when agentCommand is empty", () => {
    const data = makeData({ agentCommand: "" });
    const lines = buildConfirmLines(data);

    const labels = lines.map((l) => l.label);
    expect(labels).not.toContain("Agent");
  });

  it("omits feedback line when feedbackCommands is empty", () => {
    const data = makeData({ feedbackCommands: "" });
    const lines = buildConfirmLines(data);

    const labels = lines.map((l) => l.label);
    expect(labels).not.toContain("Feedback");
  });

  it("always includes target and branch", () => {
    const data = makeData({
      agentCommand: "",
      feedbackCommands: "",
      prdContext: undefined,
    });
    const lines = buildConfirmLines(data);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.label).toBe("Target");
    expect(lines[1]!.label).toBe("Branch");
  });

  it("shows issue title for GitHub issue targets", () => {
    const data = makeData({
      title: "#42 Fix login bug",
      branch: "fix/fix-login-bug",
      runArgs: ["run", "42"],
    });
    const lines = buildConfirmLines(data);

    expect(lines[0]).toEqual({ label: "Target", value: "#42 Fix login bug" });
  });

  it("handles PRD context with custom position", () => {
    const data = makeData({
      prdContext: makePrdContext({
        prdTitle: "Feature Revamp",
        position: "3 of 5 remaining",
      }),
    });
    const lines = buildConfirmLines(data);

    expect(lines[1]).toEqual({ label: "PRD", value: "Feature Revamp" });
    expect(lines[2]).toEqual({
      label: "Position",
      value: "3 of 5 remaining",
    });
  });
});

// ---------------------------------------------------------------------------
// confirmKeyHandler
// ---------------------------------------------------------------------------

describe("confirmKeyHandler", () => {
  it("returns 'confirm' for Enter key", () => {
    expect(confirmKeyHandler("", makeKey({ return: true }))).toBe("confirm");
  });

  it("returns 'back' for Escape key", () => {
    expect(confirmKeyHandler("", makeKey({ escape: true }))).toBe("back");
  });

  it("returns 'options' for 'o' key", () => {
    expect(confirmKeyHandler("o", makeKey())).toBe("options");
  });

  it("returns null for unrecognized keys", () => {
    expect(confirmKeyHandler("x", makeKey())).toBeNull();
    expect(confirmKeyHandler("a", makeKey())).toBeNull();
    expect(confirmKeyHandler("", makeKey())).toBeNull();
  });

  it("returns null for arrow keys", () => {
    expect(confirmKeyHandler("", makeKey({ upArrow: true }))).toBeNull();
    expect(confirmKeyHandler("", makeKey({ downArrow: true }))).toBeNull();
  });

  it("returns 'confirm' even when Enter coincides with other flags", () => {
    // Enter should take priority in key detection
    expect(confirmKeyHandler("", makeKey({ return: true, ctrl: true }))).toBe(
      "confirm",
    );
  });

  it("returns 'back' for Escape even with input characters", () => {
    expect(confirmKeyHandler("o", makeKey({ escape: true }))).toBe("back");
  });
});

// ---------------------------------------------------------------------------
// resolveConfirmIntent
// ---------------------------------------------------------------------------

describe("resolveConfirmIntent", () => {
  describe("confirm intent", () => {
    it("returns exit-to-runner with the data's runArgs", () => {
      const data = makeData({ runArgs: ["run", "--plan", "my-plan.md"] });
      const result = resolveConfirmIntent("confirm", data, { type: "menu" });
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["run", "--plan", "my-plan.md"],
      });
    });

    it("returns exit-to-runner for issue targets", () => {
      const data = makeData({ runArgs: ["run", "42"] });
      const result = resolveConfirmIntent("confirm", data, { type: "menu" });
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["run", "42"],
      });
    });

    it("returns exit-to-runner with bare run args", () => {
      const data = makeData({ runArgs: ["run"] });
      const result = resolveConfirmIntent("confirm", data, { type: "menu" });
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["run"],
      });
    });
  });

  describe("back intent", () => {
    it("navigates to menu when backScreen is menu", () => {
      const data = makeData();
      const result = resolveConfirmIntent("back", data, { type: "menu" });
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "menu" },
      });
    });

    it("navigates to issue-picker when backScreen is issue-picker", () => {
      const data = makeData();
      const backScreen: Screen = { type: "issue-picker" };
      const result = resolveConfirmIntent("back", data, backScreen);
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "issue-picker" },
      });
    });

    it("navigates to backlog-picker when backScreen is backlog-picker", () => {
      const data = makeData();
      const backScreen: Screen = { type: "backlog-picker" };
      const result = resolveConfirmIntent("back", data, backScreen);
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "backlog-picker" },
      });
    });

    it("preserves the exact backScreen reference", () => {
      const data = makeData();
      const backScreen: Screen = { type: "issue-picker" };
      const result = resolveConfirmIntent("back", data, backScreen);
      if (result.type === "navigate") {
        expect(result.screen).toBe(backScreen);
      }
    });
  });

  describe("options intent", () => {
    it("navigates to options screen with confirm data pre-populated", () => {
      const data = makeData();
      const backScreen: Screen = { type: "menu" };
      const result = resolveConfirmIntent("options", data, backScreen);
      expect(result.type).toBe("navigate");
      if (result.type === "navigate") {
        expect(result.screen.type).toBe("options");
        if (result.screen.type === "options") {
          expect(result.screen.data).toBe(data);
        }
      }
    });

    it("sets backScreen of options to the confirm screen itself", () => {
      const data = makeData();
      const backScreen: Screen = { type: "issue-picker" };
      const result = resolveConfirmIntent("options", data, backScreen);
      if (result.type === "navigate" && result.screen.type === "options") {
        const optionsBack = result.screen.backScreen;
        expect(optionsBack?.type).toBe("confirm");
        if (optionsBack?.type === "confirm") {
          expect(optionsBack.data).toBe(data);
          expect(optionsBack.backScreen).toBe(backScreen);
        }
      }
    });
  });

  describe("end-to-end: key press → intent → dispatch", () => {
    it("Esc key → back intent → navigate to backlog-picker", () => {
      const key = makeKey({ escape: true });
      const intent = confirmKeyHandler("", key);
      expect(intent).toBe("back");

      const data = makeData();
      const backScreen: Screen = { type: "backlog-picker" };
      const result = resolveConfirmIntent(intent!, data, backScreen);
      expect(result).toEqual({
        type: "navigate",
        screen: { type: "backlog-picker" },
      });
    });

    it("Enter key → confirm intent → exit-to-runner", () => {
      const key = makeKey({ return: true });
      const intent = confirmKeyHandler("", key);
      expect(intent).toBe("confirm");

      const data = makeData({ runArgs: ["run", "42"] });
      const result = resolveConfirmIntent(intent!, data, { type: "menu" });
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["run", "42"],
      });
    });

    it("o key → options intent → navigate to options screen", () => {
      const key = makeKey();
      const intent = confirmKeyHandler("o", key);
      expect(intent).toBe("options");

      const data = makeData();
      const backScreen: Screen = { type: "menu" };
      const result = resolveConfirmIntent(intent!, data, backScreen);
      expect(result.type).toBe("navigate");
      if (result.type === "navigate") {
        expect(result.screen.type).toBe("options");
      }
    });
  });
});
