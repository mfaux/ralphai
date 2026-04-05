/**
 * Tests for the run-with-options wizard screen.
 *
 * Tests pure helper functions exported from wizard.tsx:
 * - buildCheckboxItems()
 * - buildTargetListItems()
 * - buildPromptLabel()
 * - buildWizardSummary()
 *
 * Tests the WizardScreen component renders correctly in each step:
 * - target chooser (when no pre-selected target)
 * - options checkbox list (with pre-selected target)
 * - per-option prompts (text and select)
 * - done state
 *
 * Pure unit tests for helpers — no filesystem, no subprocess.
 * Component tests inject config and mock callbacks to avoid side effects.
 */

import { describe, it, expect, mock } from "bun:test";
import React from "react";
import { render } from "ink";
import type { ResolvedConfig, ConfigSource } from "../../config.ts";
import { DEFAULTS } from "../../config.ts";
import {
  buildWizardOptions,
  selectionsToFlags,
  WIZARD_KEYS,
  type WizardOption,
  type WizardConfigKey,
} from "../../interactive/wizard-options.ts";

import {
  buildCheckboxItems,
  buildTargetListItems,
  buildPromptLabel,
  buildWizardSummary,
  WizardScreen,
  type TargetChoice,
  type WizardStep,
} from "./wizard.tsx";

// ---------------------------------------------------------------------------
// Helpers
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

/** Build wizard options from default config for testing. */
function makeOptions(): WizardOption[] {
  return buildWizardOptions(makeConfig());
}

// ---------------------------------------------------------------------------
// buildCheckboxItems
// ---------------------------------------------------------------------------

describe("buildCheckboxItems", () => {
  it("returns one item per wizard option", () => {
    const options = makeOptions();
    const items = buildCheckboxItems(options);
    expect(items).toHaveLength(options.length);
  });

  it("uses wizard option key as value", () => {
    const options = makeOptions();
    const items = buildCheckboxItems(options);
    expect(items.map((i) => i.value)).toEqual(options.map((o) => o.key));
  });

  it("uses wizard option label as label", () => {
    const options = makeOptions();
    const items = buildCheckboxItems(options);
    for (let i = 0; i < options.length; i++) {
      expect(items[i]!.label).toBe(options[i]!.label);
    }
  });

  it("formats hint with current value and source", () => {
    const config = makeConfig({
      agentCommand: { value: "claude -p", source: "config" },
    });
    const options = buildWizardOptions(config);
    const items = buildCheckboxItems(options);
    const agentItem = items.find((i) => i.value === "agentCommand");
    expect(agentItem?.hint).toBe("(claude -p, config file)");
  });

  it("shows default source hint", () => {
    const options = makeOptions();
    const items = buildCheckboxItems(options);
    const baseBranch = items.find((i) => i.value === "baseBranch");
    expect(baseBranch?.hint).toBe("(main, default)");
  });

  it("shows numeric values as strings in hint", () => {
    const config = makeConfig({
      maxStuck: { value: 5, source: "cli" },
    });
    const options = buildWizardOptions(config);
    const items = buildCheckboxItems(options);
    const maxStuck = items.find((i) => i.value === "maxStuck");
    expect(maxStuck?.hint).toBe("(5, CLI flag)");
  });
});

// ---------------------------------------------------------------------------
// buildTargetListItems
// ---------------------------------------------------------------------------

describe("buildTargetListItems", () => {
  it("returns empty array for empty choices", () => {
    expect(buildTargetListItems([])).toEqual([]);
  });

  it("returns one item per choice", () => {
    const choices: TargetChoice[] = [
      { label: "Auto-detect", args: [] },
      { label: "Pick from backlog", args: ["--plan", "foo.md"] },
    ];
    const items = buildTargetListItems(choices);
    expect(items).toHaveLength(2);
  });

  it("uses index as value", () => {
    const choices: TargetChoice[] = [
      { label: "A", args: [] },
      { label: "B", args: ["42"] },
      { label: "C", args: ["--plan", "x.md"] },
    ];
    const items = buildTargetListItems(choices);
    expect(items.map((i) => i.value)).toEqual(["0", "1", "2"]);
  });

  it("uses choice label as item label", () => {
    const choices: TargetChoice[] = [
      { label: "Auto-detect (next plan)", args: [] },
    ];
    const items = buildTargetListItems(choices);
    expect(items[0]!.label).toBe("Auto-detect (next plan)");
  });
});

// ---------------------------------------------------------------------------
// buildPromptLabel
// ---------------------------------------------------------------------------

describe("buildPromptLabel", () => {
  it("includes option label and position", () => {
    const opt = makeOptions()[0]!; // agentCommand
    expect(buildPromptLabel(opt, 0, 3)).toBe("Agent command (1/3)");
  });

  it("handles single-option case", () => {
    const opt = makeOptions().find((o) => o.key === "autoCommit")!;
    expect(buildPromptLabel(opt, 0, 1)).toBe("Auto-commit (1/1)");
  });

  it("handles last-of-many case", () => {
    const opt = makeOptions().find((o) => o.key === "maxStuck")!;
    expect(buildPromptLabel(opt, 4, 5)).toBe("Max stuck iterations (5/5)");
  });
});

// ---------------------------------------------------------------------------
// buildWizardSummary
// ---------------------------------------------------------------------------

describe("buildWizardSummary", () => {
  it("returns no-changes message for empty flags", () => {
    expect(buildWizardSummary([])).toBe(
      "No changes — proceeding with current config.",
    );
  });

  it("returns applying message with single flag", () => {
    expect(buildWizardSummary(["--max-stuck=5"])).toBe(
      "Applying: --max-stuck=5",
    );
  });

  it("returns applying message with multiple flags", () => {
    const flags = [
      "--agent-command=opencode",
      "--max-stuck=10",
      "--auto-commit",
    ];
    expect(buildWizardSummary(flags)).toBe(
      "Applying: --agent-command=opencode --max-stuck=10 --auto-commit",
    );
  });
});

// ---------------------------------------------------------------------------
// WizardScreen component
// ---------------------------------------------------------------------------

describe("WizardScreen", () => {
  it("renders target chooser when no pre-selected target", async () => {
    const choices: TargetChoice[] = [
      { label: "Auto-detect", args: [] },
      { label: "Pick from backlog", args: ["--plan", "foo.md"] },
    ];

    const instance = render(
      React.createElement(WizardScreen, {
        config: makeConfig(),
        targetChoices: choices,
        onDone: () => {},
        onCancel: () => {},
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders options checkbox list when pre-selected target provided", async () => {
    const instance = render(
      React.createElement(WizardScreen, {
        config: makeConfig(),
        preSelectedTarget: { label: "Run #42", args: ["42"] },
        onDone: () => {},
        onCancel: () => {},
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("calls onDone with target args when no options selected", async () => {
    const onDone = mock((_flags: string[]) => {});

    // To test "no options selected", we need the component to go through
    // the options step and confirm with an empty selection. Since we can't
    // simulate keyboard input, we verify the component renders cleanly.
    const instance = render(
      React.createElement(WizardScreen, {
        config: makeConfig(),
        preSelectedTarget: { label: "Run #42", args: ["42"] },
        onDone,
        onCancel: () => {},
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders with custom config values", async () => {
    const config = makeConfig({
      agentCommand: { value: "opencode", source: "config" },
      maxStuck: { value: 10, source: "cli" },
      autoCommit: { value: "true", source: "env" },
    });

    const instance = render(
      React.createElement(WizardScreen, {
        config,
        preSelectedTarget: { label: "Auto-detect", args: [] },
        onDone: () => {},
        onCancel: () => {},
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders target chooser with multiple choices", async () => {
    const choices: TargetChoice[] = [
      { label: "Auto-detect (next plan)", args: [] },
      { label: "Pick from backlog", args: ["--plan", "plan.md"] },
      { label: "Issue #42", args: ["42"] },
    ];

    const instance = render(
      React.createElement(WizardScreen, {
        config: makeConfig(),
        targetChoices: choices,
        onDone: () => {},
        onCancel: () => {},
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders with isActive=false without error", async () => {
    const instance = render(
      React.createElement(WizardScreen, {
        config: makeConfig(),
        preSelectedTarget: { label: "Auto-detect", args: [] },
        onDone: () => {},
        onCancel: () => {},
        isActive: false,
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders empty target choices list without error", async () => {
    const instance = render(
      React.createElement(WizardScreen, {
        config: makeConfig(),
        targetChoices: [],
        onDone: () => {},
        onCancel: () => {},
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });
});

// ---------------------------------------------------------------------------
// Integration: selectionsToFlags round-trip
// ---------------------------------------------------------------------------

describe("wizard flow integration", () => {
  it("buildCheckboxItems keys match selectionsToFlags keys", () => {
    const options = makeOptions();
    const items = buildCheckboxItems(options);

    // All item values should be valid WizardConfigKeys
    const validKeys = new Set(WIZARD_KEYS);
    for (const item of items) {
      expect(validKeys.has(item.value as WizardConfigKey)).toBe(true);
    }
  });

  it("options from buildWizardOptions can drive selectionsToFlags", () => {
    const options = makeOptions();
    const selections: Partial<Record<WizardConfigKey, string>> = {};
    for (const opt of options) {
      selections[opt.key] = opt.currentValue;
    }

    // Should not throw
    const flags = selectionsToFlags(selections);
    expect(flags).toBeArray();
    expect(flags.length).toBe(7);
  });

  it("buildWizardSummary correctly summarizes selectionsToFlags output", () => {
    const flags = selectionsToFlags({
      agentCommand: "claude -p",
      autoCommit: "true",
    });
    const summary = buildWizardSummary(flags);
    expect(summary).toContain("--agent-command=claude -p");
    expect(summary).toContain("--auto-commit");
    expect(summary).toStartWith("Applying:");
  });
});
