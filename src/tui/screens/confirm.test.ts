/**
 * Tests for the confirm screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/confirm.tsx`:
 * - `buildConfirmLines` — builds display lines from ConfirmData
 * - `confirmKeyHandler` — maps key input to a ConfirmIntent
 */

import { describe, it, expect } from "bun:test";
import type { Key } from "ink";
import type { ConfirmData, PrdContext } from "./confirm.tsx";
import { buildConfirmLines, confirmKeyHandler } from "./confirm.tsx";

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
