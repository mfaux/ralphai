/**
 * Tests for the screen-frame component's pure helpers.
 *
 * Tests the exported pure functions from `src/tui/components/screen-frame.tsx`:
 * - `borderColor` — contextual color based on pipeline state
 * - `bannerColor` — deprecated alias for `borderColor`
 * - `screenLabel` — human-readable screen type labels
 * - `SCREEN_LABELS` — label map completeness
 */

import { describe, it, expect } from "bun:test";
import type { PipelineState } from "../../pipeline-state.ts";
import {
  borderColor,
  bannerColor,
  screenLabel,
  SCREEN_LABELS,
  FRAME_BORDER_STYLE,
} from "./screen-frame.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePipelineState(
  overrides: Partial<PipelineState> = {},
): PipelineState {
  return {
    backlog: [],
    inProgress: [],
    completedSlugs: [],
    worktrees: [],
    problems: [],
    ...overrides,
  };
}

function makeStalledPlan() {
  return {
    slug: "feat-login",
    filename: "feat-login.md",
    scope: "feat",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: true,
    liveness: { tag: "stalled" as const },
  };
}

function makeRunningPlan() {
  return {
    slug: "feat-signup",
    filename: "feat-signup.md",
    scope: "feat",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: true,
    liveness: { tag: "running" as const, pid: 1234 },
  };
}

// ---------------------------------------------------------------------------
// borderColor
// ---------------------------------------------------------------------------

describe("borderColor", () => {
  it("returns 'cyan' by default with no stalled plans", () => {
    const state = makePipelineState();
    expect(borderColor(state)).toBe("cyan");
  });

  it("returns 'cyan' when pipeline state is null (loading)", () => {
    expect(borderColor(null)).toBe("cyan");
  });

  it("returns 'yellow' when pipeline has stalled plans", () => {
    const state = makePipelineState({
      inProgress: [makeStalledPlan()],
    });
    expect(borderColor(state)).toBe("yellow");
  });

  it("returns 'cyan' when pipeline has running (non-stalled) plans", () => {
    const state = makePipelineState({
      inProgress: [makeRunningPlan()],
    });
    expect(borderColor(state)).toBe("cyan");
  });

  it("returns 'yellow' when pipeline has mix of running and stalled", () => {
    const state = makePipelineState({
      inProgress: [makeRunningPlan(), makeStalledPlan()],
    });
    expect(borderColor(state)).toBe("yellow");
  });

  it("uses colorOverride when provided, ignoring pipeline state", () => {
    const state = makePipelineState({
      inProgress: [makeStalledPlan()],
    });
    expect(borderColor(state, "green")).toBe("green");
  });

  it("uses colorOverride when provided with null state", () => {
    expect(borderColor(null, "red")).toBe("red");
  });

  it("uses colorOverride as-is for any string value", () => {
    expect(borderColor(null, "#ff00ff")).toBe("#ff00ff");
  });
});

// ---------------------------------------------------------------------------
// bannerColor (deprecated alias)
// ---------------------------------------------------------------------------

describe("bannerColor (deprecated alias)", () => {
  it("is the same function as borderColor", () => {
    expect(bannerColor).toBe(borderColor);
  });
});

// ---------------------------------------------------------------------------
// screenLabel
// ---------------------------------------------------------------------------

describe("screenLabel", () => {
  it("returns 'menu' for the menu screen", () => {
    expect(screenLabel("menu")).toBe("menu");
  });

  it("returns 'issues' for the issue-picker screen", () => {
    expect(screenLabel("issue-picker")).toBe("issues");
  });

  it("returns 'backlog' for the backlog-picker screen", () => {
    expect(screenLabel("backlog-picker")).toBe("backlog");
  });

  it("returns 'confirm' for the confirm screen", () => {
    expect(screenLabel("confirm")).toBe("confirm");
  });

  it("returns 'options' for the options screen", () => {
    expect(screenLabel("options")).toBe("options");
  });

  it("returns 'stop' for the stop screen", () => {
    expect(screenLabel("stop")).toBe("stop");
  });

  it("returns 'reset' for the reset screen", () => {
    expect(screenLabel("reset")).toBe("reset");
  });

  it("returns 'status' for the status screen", () => {
    expect(screenLabel("status")).toBe("status");
  });

  it("returns 'doctor' for the doctor screen", () => {
    expect(screenLabel("doctor")).toBe("doctor");
  });

  it("returns 'clean' for the clean screen", () => {
    expect(screenLabel("clean")).toBe("clean");
  });
});

// ---------------------------------------------------------------------------
// SCREEN_LABELS completeness
// ---------------------------------------------------------------------------

describe("SCREEN_LABELS", () => {
  it("has entries for all known screen types", () => {
    const knownScreenTypes = [
      "menu",
      "issue-picker",
      "backlog-picker",
      "confirm",
      "options",
      "stop",
      "reset",
      "status",
      "doctor",
      "clean",
    ];

    for (const type of knownScreenTypes) {
      expect(SCREEN_LABELS).toHaveProperty(type);
      expect(typeof SCREEN_LABELS[type as keyof typeof SCREEN_LABELS]).toBe(
        "string",
      );
    }
  });

  it("labels are non-empty strings", () => {
    for (const [, label] of Object.entries(SCREEN_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// FRAME_BORDER_STYLE
// ---------------------------------------------------------------------------

describe("FRAME_BORDER_STYLE", () => {
  it("is 'round'", () => {
    expect(FRAME_BORDER_STYLE).toBe("round");
  });
});
