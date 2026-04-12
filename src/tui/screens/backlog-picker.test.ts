/**
 * Tests for the backlog picker screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/backlog-picker.tsx`:
 * - `buildBacklogPickerItems` — converts backlog plans to ListItem[] with
 *   scope/dependency hints and disabled state for unmet deps
 * - `backlogPickerSelect` — maps a selected value to a DispatchResult
 */

import { describe, it, expect } from "bun:test";
import type { BacklogPlan } from "../../plan-lifecycle.ts";
import {
  buildBacklogPickerItems,
  backlogPickerSelect,
} from "./backlog-picker.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides?: Partial<BacklogPlan>): BacklogPlan {
  return {
    filename: "plan-1.md",
    scope: "",
    dependsOn: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildBacklogPickerItems
// ---------------------------------------------------------------------------

describe("buildBacklogPickerItems", () => {
  it("returns empty array for empty backlog", () => {
    expect(buildBacklogPickerItems([], [])).toEqual([]);
  });

  it("creates a selectable item for a plan with no dependencies", () => {
    const plans = [makePlan({ filename: "feat-login.md" })];
    const items = buildBacklogPickerItems(plans, []);

    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("feat-login.md");
    expect(items[0]!.label).toBe("feat-login.md");
    expect(items[0]!.disabled).toBeFalsy();
  });

  it("shows scope as hint when present", () => {
    const plans = [makePlan({ filename: "feat-auth.md", scope: "auth" })];
    const items = buildBacklogPickerItems(plans, []);

    expect(items[0]!.hint).toBe("scope: auth");
    expect(items[0]!.disabled).toBeFalsy();
  });

  it("marks plans with unmet dependencies as disabled", () => {
    const plans = [
      makePlan({
        filename: "feat-b.md",
        dependsOn: ["feat-a"],
      }),
    ];
    const items = buildBacklogPickerItems(plans, []);

    expect(items[0]!.disabled).toBe(true);
  });

  it("shows unmet dependency names in the hint", () => {
    const plans = [
      makePlan({
        filename: "feat-c.md",
        dependsOn: ["feat-a", "feat-b"],
      }),
    ];
    const items = buildBacklogPickerItems(plans, []);

    expect(items[0]!.hint).toContain("waiting on feat-a, feat-b");
    expect(items[0]!.disabled).toBe(true);
  });

  it("combines scope and unmet deps in hint with middle dot separator", () => {
    const plans = [
      makePlan({
        filename: "feat-c.md",
        scope: "core",
        dependsOn: ["feat-a"],
      }),
    ];
    const items = buildBacklogPickerItems(plans, []);

    expect(items[0]!.hint).toBe("scope: core \u00b7 waiting on feat-a");
    expect(items[0]!.disabled).toBe(true);
  });

  it("enables plans when all dependencies are satisfied", () => {
    const plans = [
      makePlan({
        filename: "feat-b.md",
        dependsOn: ["feat-a"],
      }),
    ];
    const items = buildBacklogPickerItems(plans, ["feat-a"]);

    expect(items[0]!.disabled).toBeFalsy();
  });

  it("strips .md suffix from dependency names in hint", () => {
    const plans = [
      makePlan({
        filename: "feat-c.md",
        dependsOn: ["feat-a.md"],
      }),
    ];
    const items = buildBacklogPickerItems(plans, []);

    expect(items[0]!.hint).toContain("waiting on feat-a");
  });

  it("handles mixed ready and blocked plans", () => {
    const plans = [
      makePlan({ filename: "feat-a.md" }),
      makePlan({ filename: "feat-b.md", dependsOn: ["feat-a"] }),
      makePlan({ filename: "feat-c.md", scope: "ui" }),
    ];
    const items = buildBacklogPickerItems(plans, []);

    expect(items).toHaveLength(3);

    // feat-a: no deps → selectable
    expect(items[0]!.value).toBe("feat-a.md");
    expect(items[0]!.disabled).toBeFalsy();

    // feat-b: unmet dep → disabled
    expect(items[1]!.value).toBe("feat-b.md");
    expect(items[1]!.disabled).toBe(true);

    // feat-c: no deps → selectable, has scope hint
    expect(items[2]!.value).toBe("feat-c.md");
    expect(items[2]!.disabled).toBeFalsy();
    expect(items[2]!.hint).toBe("scope: ui");
  });

  it("no hint when plan has no scope and no dependencies", () => {
    const plans = [makePlan({ filename: "simple.md" })];
    const items = buildBacklogPickerItems(plans, []);

    expect(items[0]!.hint).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// backlogPickerSelect
// ---------------------------------------------------------------------------

describe("backlogPickerSelect", () => {
  it("returns exit-to-runner with --plan flag for valid filename", () => {
    const result = backlogPickerSelect("feat-login.md");

    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "--plan=feat-login.md"],
    });
  });

  it("returns null for __back__ sentinel", () => {
    expect(backlogPickerSelect("__back__")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(backlogPickerSelect("")).toBeNull();
  });

  it("passes filename exactly as given", () => {
    const result = backlogPickerSelect("gh-42-add-feature.md");

    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "--plan=gh-42-add-feature.md"],
    });
  });

  it("produces args compatible with CLI --plan= validator", () => {
    // The CLI argument validator (in ralphai.ts) uses /^--plan=/ to recognize
    // the plan flag. Verify that backlogPickerSelect produces args that match
    // this pattern, preventing "Unrecognized argument: --plan" errors.
    const result = backlogPickerSelect("feat-login.md");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("exit-to-runner");

    if (result!.type === "exit-to-runner") {
      const planArg = result!.args.find((a: string) => a !== "run");
      expect(planArg).toBeDefined();
      expect(/^--plan=/.test(planArg!)).toBe(true);
      expect(planArg).toBe("--plan=feat-login.md");
    }
  });
});
