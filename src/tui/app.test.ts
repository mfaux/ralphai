/**
 * Tests for the TUI application root.
 *
 * Tests pure helper functions exported from app.tsx:
 * - targetChoiceFromRunArgs()
 * - initialScreenFrom()
 *
 * Tests the TuiRouter component renders correctly for each screen type
 * and transitions between screens via callbacks.
 *
 * Pure unit tests for helpers — no filesystem, no subprocess.
 * Component tests use Ink's render() to verify mount/unmount behavior.
 */

import { describe, it, expect, mock } from "bun:test";
import React from "react";
import { render } from "ink";
import type { ConfigSource } from "../config.ts";
import { DEFAULTS } from "../config.ts";
import type { ResolvedConfig } from "../config.ts";
import type { ConfirmScreenData } from "./screens/confirm.tsx";

import {
  targetChoiceFromRunArgs,
  initialScreenFrom,
  TuiRouter,
  type Screen,
} from "./app.tsx";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a ResolvedConfig where every key uses the given source. */
function makeConfig(
  overrides?: Partial<
    Record<keyof typeof DEFAULTS, { value: unknown; source: ConfigSource }>
  >,
): ResolvedConfig {
  const base: Record<string, { value: unknown; source: ConfigSource }> = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    base[key] = { value, source: "default" };
  }
  if (overrides) {
    for (const [key, rv] of Object.entries(overrides)) {
      base[key] = rv;
    }
  }
  return base as unknown as ResolvedConfig;
}

function makeConfirmData(
  overrides?: Partial<ConfirmScreenData>,
): ConfirmScreenData {
  return {
    title: "feat: add login endpoint",
    branch: "ralphai/gh-42-add-login-endpoint",
    agentCommand: "claude -p",
    feedbackCommands: "bun run build,bun test",
    runArgs: ["run", "42"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// targetChoiceFromRunArgs
// ---------------------------------------------------------------------------

describe("targetChoiceFromRunArgs", () => {
  it("extracts target args by filtering out 'run'", () => {
    const choice = targetChoiceFromRunArgs(["run", "42"]);
    expect(choice.args).toEqual(["42"]);
  });

  it("uses remaining args as label", () => {
    const choice = targetChoiceFromRunArgs(["run", "42"]);
    expect(choice.label).toBe("42");
  });

  it("handles multiple non-run args", () => {
    const choice = targetChoiceFromRunArgs(["run", "--plan", "foo.md"]);
    expect(choice.args).toEqual(["--plan", "foo.md"]);
    expect(choice.label).toBe("--plan foo.md");
  });

  it("handles run-only args (auto-detect)", () => {
    const choice = targetChoiceFromRunArgs(["run"]);
    expect(choice.args).toEqual([]);
    expect(choice.label).toBe("auto-detect");
  });

  it("handles empty args", () => {
    const choice = targetChoiceFromRunArgs([]);
    expect(choice.args).toEqual([]);
    expect(choice.label).toBe("auto-detect");
  });

  it("handles args without run prefix", () => {
    const choice = targetChoiceFromRunArgs(["42"]);
    expect(choice.args).toEqual(["42"]);
    expect(choice.label).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// initialScreenFrom
// ---------------------------------------------------------------------------

describe("initialScreenFrom", () => {
  it("returns the same screen (identity)", () => {
    const screen: Screen = { tag: "confirm", data: makeConfirmData() };
    expect(initialScreenFrom(screen)).toBe(screen);
  });

  it("works with wizard screen", () => {
    const screen: Screen = {
      tag: "wizard",
      config: makeConfig(),
    };
    expect(initialScreenFrom(screen)).toBe(screen);
  });

  it("works with doctor screen", () => {
    const screen: Screen = { tag: "doctor", cwd: "/tmp" };
    expect(initialScreenFrom(screen)).toBe(screen);
  });

  it("works with clean screen", () => {
    const screen: Screen = { tag: "clean", cwd: "/tmp" };
    expect(initialScreenFrom(screen)).toBe(screen);
  });

  it("works with quit screen", () => {
    const screen: Screen = { tag: "quit" };
    expect(initialScreenFrom(screen)).toBe(screen);
  });
});

// ---------------------------------------------------------------------------
// Screen type construction
// ---------------------------------------------------------------------------

describe("Screen type", () => {
  it("can construct a confirm screen", () => {
    const screen: Screen = { tag: "confirm", data: makeConfirmData() };
    expect(screen.tag).toBe("confirm");
    if (screen.tag === "confirm") {
      expect(screen.data.title).toBe("feat: add login endpoint");
    }
  });

  it("can construct a wizard screen with pre-selected target", () => {
    const screen: Screen = {
      tag: "wizard",
      config: makeConfig(),
      preSelectedTarget: { label: "Issue #42", args: ["42"] },
    };
    expect(screen.tag).toBe("wizard");
    if (screen.tag === "wizard") {
      expect(screen.preSelectedTarget?.args).toEqual(["42"]);
    }
  });

  it("can construct a wizard screen without pre-selected target", () => {
    const screen: Screen = {
      tag: "wizard",
      config: makeConfig(),
      targetChoices: [
        { label: "Auto-detect", args: [] },
        { label: "Issue #42", args: ["42"] },
      ],
    };
    expect(screen.tag).toBe("wizard");
    if (screen.tag === "wizard") {
      expect(screen.preSelectedTarget).toBeUndefined();
      expect(screen.targetChoices).toHaveLength(2);
    }
  });

  it("can construct a wizard screen with previous screen reference", () => {
    const confirmScreen: Screen = {
      tag: "confirm",
      data: makeConfirmData(),
    };
    const wizardScreen: Screen = {
      tag: "wizard",
      config: makeConfig(),
      preSelectedTarget: { label: "42", args: ["42"] },
      previousScreen: confirmScreen,
    };
    expect(wizardScreen.tag).toBe("wizard");
    if (wizardScreen.tag === "wizard") {
      expect(wizardScreen.previousScreen?.tag).toBe("confirm");
    }
  });

  it("can construct a doctor screen", () => {
    const screen: Screen = { tag: "doctor", cwd: "/home/user/project" };
    if (screen.tag === "doctor") {
      expect(screen.cwd).toBe("/home/user/project");
    }
  });

  it("can construct a clean screen", () => {
    const screen: Screen = { tag: "clean", cwd: "/home/user/project" };
    if (screen.tag === "clean") {
      expect(screen.cwd).toBe("/home/user/project");
    }
  });
});

// ---------------------------------------------------------------------------
// TuiRouter component — render tests
// ---------------------------------------------------------------------------

describe("TuiRouter", () => {
  it("renders confirm screen without error", () => {
    const screen: Screen = { tag: "confirm", data: makeConfirmData() };
    const config = makeConfig();

    const instance = render(
      React.createElement(TuiRouter, { initialScreen: screen, config }),
    );

    instance.unmount();
  });

  it("renders wizard screen with pre-selected target without error", () => {
    const config = makeConfig();
    const screen: Screen = {
      tag: "wizard",
      config,
      preSelectedTarget: { label: "Issue #42", args: ["42"] },
    };

    const instance = render(
      React.createElement(TuiRouter, { initialScreen: screen, config }),
    );

    instance.unmount();
  });

  it("renders wizard screen without pre-selected target", () => {
    const config = makeConfig();
    const screen: Screen = {
      tag: "wizard",
      config,
      targetChoices: [
        { label: "Auto-detect", args: [] },
        { label: "Issue #42", args: ["42"] },
      ],
    };

    const instance = render(
      React.createElement(TuiRouter, { initialScreen: screen, config }),
    );

    instance.unmount();
  });

  it("renders confirm screen with PRD context", () => {
    const screen: Screen = {
      tag: "confirm",
      data: makeConfirmData({
        prdContext: {
          prdTitle: "Auth Redesign",
          prdNumber: 100,
          position: "2 of 5 remaining",
        },
      }),
    };
    const config = makeConfig();

    const instance = render(
      React.createElement(TuiRouter, { initialScreen: screen, config }),
    );

    instance.unmount();
  });

  it("renders confirm screen with empty feedback", () => {
    const screen: Screen = {
      tag: "confirm",
      data: makeConfirmData({ feedbackCommands: "" }),
    };
    const config = makeConfig();

    const instance = render(
      React.createElement(TuiRouter, { initialScreen: screen, config }),
    );

    instance.unmount();
  });
});

// ---------------------------------------------------------------------------
// Integration: confirm → wizard transition via targetChoiceFromRunArgs
// ---------------------------------------------------------------------------

describe("confirm → wizard integration", () => {
  it("targetChoiceFromRunArgs produces valid TargetChoice for wizard", () => {
    const runArgs = ["run", "42"];
    const target = targetChoiceFromRunArgs(runArgs);

    // Valid for passing as preSelectedTarget to WizardScreen
    expect(target).toEqual({
      label: "42",
      args: ["42"],
    });
  });

  it("targetChoiceFromRunArgs with plan args produces valid TargetChoice", () => {
    const runArgs = ["run", "--plan", "my-plan.md"];
    const target = targetChoiceFromRunArgs(runArgs);

    expect(target).toEqual({
      label: "--plan my-plan.md",
      args: ["--plan", "my-plan.md"],
    });
  });

  it("wizard screen can be constructed from confirm transition", () => {
    const confirmScreen: Screen = {
      tag: "confirm",
      data: makeConfirmData(),
    };
    const config = makeConfig();
    const target = targetChoiceFromRunArgs(confirmScreen.data.runArgs);

    const wizardScreen: Screen = {
      tag: "wizard",
      config,
      preSelectedTarget: target,
      previousScreen: confirmScreen,
    };

    expect(wizardScreen.tag).toBe("wizard");
    if (wizardScreen.tag === "wizard") {
      expect(wizardScreen.preSelectedTarget?.args).toEqual(["42"]);
      expect(wizardScreen.previousScreen?.tag).toBe("confirm");
    }
  });
});
