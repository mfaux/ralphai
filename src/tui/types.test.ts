/**
 * Tests for `src/tui/types.ts` — ActionType, Screen, and dispatch logic.
 *
 * These tests exercise the pure exported functions without rendering
 * any Ink components.
 */

import { describe, it, expect } from "bun:test";
import {
  isActionType,
  resolveAction,
  ACTION_TYPES,
  titleFromRunArgs,
  branchFromRunArgs,
  buildConfirmDataFromArgs,
  toConfirmNav,
} from "./types.ts";
import type { ActionType, DispatchResult, Screen, RunConfig } from "./types.ts";
import type { ConfirmData } from "./screens/confirm.tsx";

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

// ---------------------------------------------------------------------------
// Screen union: confirm variant
// ---------------------------------------------------------------------------

describe("Screen confirm variant", () => {
  const sampleData: ConfirmData = {
    title: "test-plan.md",
    agentCommand: "claude",
    branch: "feat/test",
    feedbackCommands: "bun test",
    runArgs: ["run"],
  };

  it("can be used in a navigate DispatchResult", () => {
    const result: DispatchResult = {
      type: "navigate",
      screen: { type: "confirm", data: sampleData },
    };
    expect(result.type).toBe("navigate");
    if (result.type === "navigate") {
      expect(result.screen.type).toBe("confirm");
    }
  });

  it("carries ConfirmData in the screen object", () => {
    const screen: Screen = { type: "confirm", data: sampleData };
    if (screen.type === "confirm") {
      expect(screen.data.title).toBe("test-plan.md");
      expect(screen.data.runArgs).toEqual(["run"]);
    }
  });

  it("supports optional backScreen for navigation", () => {
    const screen: Screen = {
      type: "confirm",
      data: sampleData,
      backScreen: { type: "backlog-picker" },
    };
    if (screen.type === "confirm") {
      expect(screen.backScreen?.type).toBe("backlog-picker");
    }
  });

  it("backScreen defaults to undefined", () => {
    const screen: Screen = { type: "confirm", data: sampleData };
    if (screen.type === "confirm") {
      expect(screen.backScreen).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Screen union: options variant
// ---------------------------------------------------------------------------

describe("Screen options variant", () => {
  const sampleData: ConfirmData = {
    title: "test-plan.md",
    agentCommand: "claude",
    branch: "feat/test",
    feedbackCommands: "bun test",
    runArgs: ["run"],
  };

  it("can be used in a navigate DispatchResult", () => {
    const result: DispatchResult = {
      type: "navigate",
      screen: { type: "options", data: sampleData },
    };
    expect(result.type).toBe("navigate");
    if (result.type === "navigate") {
      expect(result.screen.type).toBe("options");
    }
  });

  it("carries ConfirmData in the screen object", () => {
    const screen: Screen = { type: "options", data: sampleData };
    if (screen.type === "options") {
      expect(screen.data.title).toBe("test-plan.md");
      expect(screen.data.runArgs).toEqual(["run"]);
    }
  });

  it("supports optional backScreen for navigation back to confirm", () => {
    const screen: Screen = {
      type: "options",
      data: sampleData,
      backScreen: { type: "confirm", data: sampleData },
    };
    if (screen.type === "options") {
      expect(screen.backScreen?.type).toBe("confirm");
    }
  });

  it("backScreen defaults to undefined", () => {
    const screen: Screen = { type: "options", data: sampleData };
    if (screen.type === "options") {
      expect(screen.backScreen).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// titleFromRunArgs
// ---------------------------------------------------------------------------

describe("titleFromRunArgs", () => {
  it('returns "Auto-detect (next plan)" for bare ["run"]', () => {
    expect(titleFromRunArgs(["run"])).toBe("Auto-detect (next plan)");
  });

  it('returns "Issue #N" for ["run", "42"]', () => {
    expect(titleFromRunArgs(["run", "42"])).toBe("Issue #42");
  });

  it('returns plan filename for ["run", "--plan", "feat-login.md"]', () => {
    expect(titleFromRunArgs(["run", "--plan", "feat-login.md"])).toBe(
      "feat-login.md",
    );
  });

  it("handles --plan with complex filenames", () => {
    expect(titleFromRunArgs(["run", "--plan", "gh-42-add-feature.md"])).toBe(
      "gh-42-add-feature.md",
    );
  });

  it("returns joined rest for unexpected shapes", () => {
    expect(titleFromRunArgs(["run", "--verbose", "something"])).toBe(
      "--verbose something",
    );
  });

  it("handles empty args", () => {
    expect(titleFromRunArgs([])).toBe("Auto-detect (next plan)");
  });

  it("handles large issue numbers", () => {
    expect(titleFromRunArgs(["run", "9999"])).toBe("Issue #9999");
  });
});

// ---------------------------------------------------------------------------
// branchFromRunArgs
// ---------------------------------------------------------------------------

describe("branchFromRunArgs", () => {
  it('returns "(auto)" for any args', () => {
    expect(branchFromRunArgs(["run"])).toBe("(auto)");
    expect(branchFromRunArgs(["run", "42"])).toBe("(auto)");
    expect(branchFromRunArgs(["run", "--plan", "feat.md"])).toBe("(auto)");
  });
});

// ---------------------------------------------------------------------------
// buildConfirmDataFromArgs
// ---------------------------------------------------------------------------

describe("buildConfirmDataFromArgs", () => {
  const config: RunConfig = {
    agentCommand: "claude-code",
    feedbackCommands: "bun run build && bun test",
  };

  it("builds ConfirmData for auto-detect run", () => {
    const data = buildConfirmDataFromArgs(["run"], config);
    expect(data).toEqual({
      title: "Auto-detect (next plan)",
      agentCommand: "claude-code",
      branch: "(auto)",
      feedbackCommands: "bun run build && bun test",
      runArgs: ["run"],
    });
  });

  it("builds ConfirmData for issue run", () => {
    const data = buildConfirmDataFromArgs(["run", "42"], config);
    expect(data.title).toBe("Issue #42");
    expect(data.runArgs).toEqual(["run", "42"]);
  });

  it("builds ConfirmData for plan run", () => {
    const data = buildConfirmDataFromArgs(
      ["run", "--plan", "feat-login.md"],
      config,
    );
    expect(data.title).toBe("feat-login.md");
    expect(data.runArgs).toEqual(["run", "--plan", "feat-login.md"]);
  });

  it("uses config values for agent and feedback", () => {
    const customConfig: RunConfig = {
      agentCommand: "aider",
      feedbackCommands: "npm test",
    };
    const data = buildConfirmDataFromArgs(["run"], customConfig);
    expect(data.agentCommand).toBe("aider");
    expect(data.feedbackCommands).toBe("npm test");
  });

  it("handles empty config values", () => {
    const emptyConfig: RunConfig = {
      agentCommand: "",
      feedbackCommands: "",
    };
    const data = buildConfirmDataFromArgs(["run"], emptyConfig);
    expect(data.agentCommand).toBe("");
    expect(data.feedbackCommands).toBe("");
  });
});

// ---------------------------------------------------------------------------
// toConfirmNav
// ---------------------------------------------------------------------------

describe("toConfirmNav", () => {
  const config: RunConfig = {
    agentCommand: "claude-code",
    feedbackCommands: "bun test",
  };

  it("converts exit-to-runner to navigate-to-confirm", () => {
    const result: DispatchResult = {
      type: "exit-to-runner",
      args: ["run", "42"],
    };
    const backScreen: Screen = { type: "issue-picker" };
    const converted = toConfirmNav(result, config, backScreen);

    expect(converted.type).toBe("navigate");
    if (converted.type === "navigate") {
      expect(converted.screen.type).toBe("confirm");
      if (converted.screen.type === "confirm") {
        expect(converted.screen.data.title).toBe("Issue #42");
        expect(converted.screen.data.agentCommand).toBe("claude-code");
        expect(converted.screen.data.runArgs).toEqual(["run", "42"]);
        expect(converted.screen.backScreen).toBe(backScreen);
      }
    }
  });

  it("sets backScreen to menu for menu-originated actions", () => {
    const result: DispatchResult = {
      type: "exit-to-runner",
      args: ["run"],
    };
    const backScreen: Screen = { type: "menu" };
    const converted = toConfirmNav(result, config, backScreen);

    if (converted.type === "navigate" && converted.screen.type === "confirm") {
      expect(converted.screen.backScreen?.type).toBe("menu");
    }
  });

  it("sets backScreen to backlog-picker for backlog selections", () => {
    const result: DispatchResult = {
      type: "exit-to-runner",
      args: ["run", "--plan", "feat.md"],
    };
    const backScreen: Screen = { type: "backlog-picker" };
    const converted = toConfirmNav(result, config, backScreen);

    if (converted.type === "navigate" && converted.screen.type === "confirm") {
      expect(converted.screen.data.title).toBe("feat.md");
      expect(converted.screen.backScreen?.type).toBe("backlog-picker");
    }
  });

  it("passes through stay results unchanged", () => {
    const result: DispatchResult = { type: "stay" };
    const converted = toConfirmNav(result, config, { type: "menu" });
    expect(converted).toEqual({ type: "stay" });
  });

  it("passes through exit results unchanged", () => {
    const result: DispatchResult = { type: "exit" };
    const converted = toConfirmNav(result, config, { type: "menu" });
    expect(converted).toEqual({ type: "exit" });
  });

  it("passes through navigate results unchanged", () => {
    const result: DispatchResult = {
      type: "navigate",
      screen: { type: "backlog-picker" },
    };
    const converted = toConfirmNav(result, config, { type: "menu" });
    expect(converted).toEqual(result);
  });

  it("builds correct ConfirmData from run args and config", () => {
    const result: DispatchResult = {
      type: "exit-to-runner",
      args: ["run", "--plan", "my-plan.md"],
    };
    const converted = toConfirmNav(result, config, { type: "backlog-picker" });

    if (converted.type === "navigate" && converted.screen.type === "confirm") {
      expect(converted.screen.data).toEqual({
        title: "my-plan.md",
        agentCommand: "claude-code",
        branch: "(auto)",
        feedbackCommands: "bun test",
        runArgs: ["run", "--plan", "my-plan.md"],
      });
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end transition flows
// ---------------------------------------------------------------------------

describe("transition flows", () => {
  const config: RunConfig = {
    agentCommand: "claude-code",
    feedbackCommands: "bun test",
  };

  it("run-next menu action → confirm screen with back to menu", () => {
    // Menu produces run-next → resolveAction → exit-to-runner
    const actionResult = resolveAction("run-next");
    expect(actionResult.type).toBe("exit-to-runner");

    // App wraps with toConfirmNav → navigate to confirm
    const confirmNav = toConfirmNav(actionResult, config, { type: "menu" });
    expect(confirmNav.type).toBe("navigate");
    if (confirmNav.type === "navigate") {
      expect(confirmNav.screen.type).toBe("confirm");
      if (confirmNav.screen.type === "confirm") {
        expect(confirmNav.screen.data.title).toBe("Auto-detect (next plan)");
        expect(confirmNav.screen.backScreen?.type).toBe("menu");
      }
    }
  });

  it("pick-from-backlog → backlog-picker (no confirm interception)", () => {
    const actionResult = resolveAction("pick-from-backlog");
    // Navigate results pass through unchanged
    const result = toConfirmNav(actionResult, config, { type: "menu" });
    expect(result).toEqual({
      type: "navigate",
      screen: { type: "backlog-picker" },
    });
  });

  it("pick-from-github → issue-picker (no confirm interception)", () => {
    const actionResult = resolveAction("pick-from-github");
    const result = toConfirmNav(actionResult, config, { type: "menu" });
    expect(result).toEqual({
      type: "navigate",
      screen: { type: "issue-picker" },
    });
  });

  it("issue picker select → confirm with back to issue-picker", () => {
    // Simulates what issuePickerSelect returns
    const pickerResult: DispatchResult = {
      type: "exit-to-runner",
      args: ["run", "42"],
    };
    const confirmNav = toConfirmNav(pickerResult, config, {
      type: "issue-picker",
    });

    if (
      confirmNav.type === "navigate" &&
      confirmNav.screen.type === "confirm"
    ) {
      expect(confirmNav.screen.data.title).toBe("Issue #42");
      expect(confirmNav.screen.backScreen?.type).toBe("issue-picker");
    }
  });

  it("backlog picker select → confirm with back to backlog-picker", () => {
    // Simulates what backlogPickerSelect returns
    const pickerResult: DispatchResult = {
      type: "exit-to-runner",
      args: ["run", "--plan", "feat-login.md"],
    };
    const confirmNav = toConfirmNav(pickerResult, config, {
      type: "backlog-picker",
    });

    if (
      confirmNav.type === "navigate" &&
      confirmNav.screen.type === "confirm"
    ) {
      expect(confirmNav.screen.data.title).toBe("feat-login.md");
      expect(confirmNav.screen.backScreen?.type).toBe("backlog-picker");
    }
  });

  it("quit passes through toConfirmNav unchanged", () => {
    const actionResult = resolveAction("quit");
    const result = toConfirmNav(actionResult, config, { type: "menu" });
    expect(result).toEqual({ type: "exit" });
  });
});
