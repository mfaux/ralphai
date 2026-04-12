/**
 * Tests for the options screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/options.tsx`:
 * - `optionsKeyHandler` — maps key input to an OptionsIntent
 * - `resolveOptionsIntent` — maps an OptionsIntent to a DispatchResult
 * - `buildCheckboxItems` — maps WizardOptions to ListItems
 * - `mergeWizardFlags` — merges wizard flags into runArgs
 * - `resolveWizardResult` — produces exit-to-runner with merged flags
 * - `buildEditingLabel` — builds per-option editing labels
 * - `adaptValidator` — adapts wizard validate to TextInput Validator
 * - `buildSelectItems` — builds select list items from choices
 */

import { describe, it, expect } from "bun:test";
import type { Key } from "ink";
import type { ConfirmData } from "./confirm.tsx";
import {
  optionsKeyHandler,
  resolveOptionsIntent,
  buildCheckboxItems,
  mergeWizardFlags,
  resolveWizardResult,
  buildEditingLabel,
  adaptValidator,
  buildSelectItems,
} from "./options.tsx";
import type { Screen } from "../types.ts";
import type {
  WizardOption,
  WizardConfigKey,
} from "../../interactive/wizard-options.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeData(overrides?: Partial<ConfirmData>): ConfirmData {
  return {
    title: "feat-login.md",
    agentCommand: "claude-code",
    branch: "ralphai/feat-login",
    feedbackCommands: "bun run build && bun run test",
    runArgs: ["run", "--plan=feat-login.md"],
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

function makeWizardOption(overrides?: Partial<WizardOption>): WizardOption {
  return {
    key: "agent.command",
    label: "Agent command",
    currentValue: "claude-code",
    sourceHint: "config file",
    prompt: { kind: "text" },
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
      const data = makeData({ runArgs: ["run", "--plan=my-plan.md"] });
      const result = resolveOptionsIntent("confirm", data, { type: "menu" });
      expect(result).toEqual({
        type: "exit-to-runner",
        args: ["run", "--plan=my-plan.md"],
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

// ---------------------------------------------------------------------------
// buildCheckboxItems
// ---------------------------------------------------------------------------

describe("buildCheckboxItems", () => {
  it("converts wizard options to list items with hints", () => {
    const options: WizardOption[] = [
      makeWizardOption({
        key: "agent.command",
        label: "Agent command",
        currentValue: "claude-code",
        sourceHint: "config file",
      }),
      makeWizardOption({
        key: "baseBranch",
        label: "Base branch",
        currentValue: "main",
        sourceHint: "default",
      }),
    ];

    const items = buildCheckboxItems(options);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      value: "agent.command",
      label: "Agent command",
      hint: "claude-code (config file)",
    });
    expect(items[1]).toEqual({
      value: "baseBranch",
      label: "Base branch",
      hint: "main (default)",
    });
  });

  it("returns empty array for no options", () => {
    expect(buildCheckboxItems([])).toEqual([]);
  });

  it("handles options with empty currentValue", () => {
    const options: WizardOption[] = [
      makeWizardOption({
        key: "agent.setupCommand",
        label: "Setup command",
        currentValue: "",
        sourceHint: "default",
      }),
    ];

    const items = buildCheckboxItems(options);
    expect(items[0]!.hint).toBe(" (default)");
  });

  it("uses the option key as the item value", () => {
    const options: WizardOption[] = [
      makeWizardOption({ key: "gate.maxStuck" }),
      makeWizardOption({ key: "gate.iterationTimeout" }),
      makeWizardOption({ key: "sandbox" }),
    ];

    const items = buildCheckboxItems(options);
    expect(items.map((i) => i.value)).toEqual([
      "gate.maxStuck",
      "gate.iterationTimeout",
      "sandbox",
    ]);
  });
});

// ---------------------------------------------------------------------------
// mergeWizardFlags
// ---------------------------------------------------------------------------

describe("mergeWizardFlags", () => {
  it("inserts flags after 'run' in runArgs", () => {
    const result = mergeWizardFlags(
      ["run", "--plan=test.md"],
      ["--gate-max-stuck=5", "--base-branch=dev"],
    );
    expect(result).toEqual([
      "run",
      "--gate-max-stuck=5",
      "--base-branch=dev",
      "--plan=test.md",
    ]);
  });

  it("inserts flags at the start when no 'run' in args", () => {
    const result = mergeWizardFlags(["--plan=test.md"], ["--gate-max-stuck=5"]);
    expect(result).toEqual(["--gate-max-stuck=5", "--plan=test.md"]);
  });

  it("returns original args unchanged when no wizard flags", () => {
    const original = ["run", "--plan=test.md"];
    const result = mergeWizardFlags(original, []);
    expect(result).toEqual(original);
    // Should be a new array, not the same reference
    expect(result).not.toBe(original);
  });

  it("handles bare 'run' with wizard flags", () => {
    const result = mergeWizardFlags(["run"], ["--agent-command=aider"]);
    expect(result).toEqual(["run", "--agent-command=aider"]);
  });

  it("handles issue number args", () => {
    const result = mergeWizardFlags(["run", "42"], ["--gate-review"]);
    expect(result).toEqual(["run", "--gate-review", "42"]);
  });

  it("does not modify the original runArgs array", () => {
    const original = ["run", "--plan=test.md"];
    const originalCopy = [...original];
    mergeWizardFlags(original, ["--gate-max-stuck=5"]);
    expect(original).toEqual(originalCopy);
  });
});

// ---------------------------------------------------------------------------
// resolveWizardResult
// ---------------------------------------------------------------------------

describe("resolveWizardResult", () => {
  it("returns exit-to-runner with merged flags for a single selection", () => {
    const values: Partial<Record<WizardConfigKey, string>> = {
      "gate.maxStuck": "5",
    };
    const result = resolveWizardResult(values, ["run", "--plan=test.md"]);
    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "--gate-max-stuck=5", "--plan=test.md"],
    });
  });

  it("returns exit-to-runner with multiple merged flags", () => {
    const values: Partial<Record<WizardConfigKey, string>> = {
      "agent.command": "aider",
      baseBranch: "dev",
    };
    const result = resolveWizardResult(values, ["run"]);
    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "--agent-command=aider", "--base-branch=dev"],
    });
  });

  it("returns exit-to-runner with original args when no selections", () => {
    const result = resolveWizardResult({}, ["run", "42"]);
    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "42"],
    });
  });
});

// ---------------------------------------------------------------------------
// buildEditingLabel
// ---------------------------------------------------------------------------

describe("buildEditingLabel", () => {
  it("formats label with 1-indexed position and total", () => {
    const opt = makeWizardOption({ label: "Agent command" });
    expect(buildEditingLabel(opt, 0, 3)).toBe("Agent command (1/3)");
  });

  it("shows correct position for middle option", () => {
    const opt = makeWizardOption({ label: "Base branch" });
    expect(buildEditingLabel(opt, 1, 3)).toBe("Base branch (2/3)");
  });

  it("shows correct position for last option", () => {
    const opt = makeWizardOption({ label: "Max stuck" });
    expect(buildEditingLabel(opt, 2, 3)).toBe("Max stuck (3/3)");
  });

  it("handles single option", () => {
    const opt = makeWizardOption({ label: "Sandbox mode" });
    expect(buildEditingLabel(opt, 0, 1)).toBe("Sandbox mode (1/1)");
  });
});

// ---------------------------------------------------------------------------
// adaptValidator
// ---------------------------------------------------------------------------

describe("adaptValidator", () => {
  it("returns undefined when no validate function provided", () => {
    expect(adaptValidator(undefined)).toBeUndefined();
  });

  it("returns a Validator that returns { valid: true } for valid input", () => {
    const wizardValidate = (v: string) =>
      /^\d+$/.test(v) ? undefined : "Must be a number";

    const validator = adaptValidator(wizardValidate);
    expect(validator).toBeDefined();

    const result = validator!("42");
    expect(result).toEqual({ valid: true });
  });

  it("returns a Validator that returns { valid: false, message } for invalid input", () => {
    const wizardValidate = (v: string) =>
      /^\d+$/.test(v) ? undefined : "Must be a number";

    const validator = adaptValidator(wizardValidate);
    const result = validator!("abc");
    expect(result).toEqual({ valid: false, message: "Must be a number" });
  });

  it("preserves specific error messages", () => {
    const wizardValidate = (_: string) => "Must be a positive integer (>= 1)";
    const validator = adaptValidator(wizardValidate);
    const result = validator!("0");
    expect(result).toEqual({
      valid: false,
      message: "Must be a positive integer (>= 1)",
    });
  });

  it("returns valid for empty string when validate allows it", () => {
    const wizardValidate = (_: string) => undefined; // everything is valid
    const validator = adaptValidator(wizardValidate);
    expect(validator!("")).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// buildSelectItems
// ---------------------------------------------------------------------------

describe("buildSelectItems", () => {
  it("converts string choices to list items", () => {
    const items = buildSelectItems(["true", "false"]);
    expect(items).toEqual([
      { value: "true", label: "true" },
      { value: "false", label: "false" },
    ]);
  });

  it("returns empty array for no choices", () => {
    expect(buildSelectItems([])).toEqual([]);
  });

  it("handles single choice", () => {
    const items = buildSelectItems(["yes"]);
    expect(items).toEqual([{ value: "yes", label: "yes" }]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end wizard flow (pure logic)
// ---------------------------------------------------------------------------

describe("wizard flow: pure logic end-to-end", () => {
  it("checkbox selection → edit values → merged flags result", () => {
    // Simulate: user selects gate.maxStuck and sandbox, enters values, gets result
    const values: Partial<Record<WizardConfigKey, string>> = {
      "gate.maxStuck": "10",
      sandbox: "docker",
    };
    const runArgs = ["run", "--plan=my-feature.md"];

    const result = resolveWizardResult(values, runArgs);

    expect(result.type).toBe("exit-to-runner");
    if (result.type === "exit-to-runner") {
      expect(result.args).toContain("--gate-max-stuck=10");
      expect(result.args).toContain("--sandbox=docker");
      expect(result.args).toContain("--plan=my-feature.md");
      // Wizard flags should appear before --plan=
      const maxStuckIdx = result.args.indexOf("--gate-max-stuck=10");
      const planIdx = result.args.indexOf("--plan=my-feature.md");
      expect(maxStuckIdx).toBeLessThan(planIdx);
    }
  });

  it("empty checkbox selection → no flags added", () => {
    const result = resolveWizardResult({}, ["run", "42"]);
    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "42"],
    });
  });

  it("all 8 options modified → all flags present", () => {
    const values: Partial<Record<WizardConfigKey, string>> = {
      "agent.command": "aider",
      "agent.setupCommand": "npm install",
      "hooks.feedback": "npm test",
      "hooks.prFeedback": "npm run lint",
      baseBranch: "develop",
      "gate.maxStuck": "3",
      "gate.iterationTimeout": "600",
      sandbox: "docker",
    };

    const result = resolveWizardResult(values, ["run"]);
    if (result.type === "exit-to-runner") {
      expect(result.args).toContain("--agent-command=aider");
      expect(result.args).toContain("--agent-setup-command=npm install");
      expect(result.args).toContain("--hooks-feedback=npm test");
      expect(result.args).toContain("--hooks-pr-feedback=npm run lint");
      expect(result.args).toContain("--base-branch=develop");
      expect(result.args).toContain("--gate-max-stuck=3");
      expect(result.args).toContain("--gate-iteration-timeout=600");
      expect(result.args).toContain("--sandbox=docker");
      expect(result.args).toHaveLength(9); // "run" + 8 flags
    }
  });

  it("checkbox items reflect wizard options metadata", () => {
    const options: WizardOption[] = [
      makeWizardOption({
        key: "agent.command",
        label: "Agent command",
        currentValue: "claude-code",
        sourceHint: "config file",
      }),
      makeWizardOption({
        key: "sandbox",
        label: "Sandbox mode",
        currentValue: "none",
        sourceHint: "default",
        prompt: { kind: "select", choices: ["none", "docker"] },
      }),
    ];

    const items = buildCheckboxItems(options);
    expect(items[0]!.hint).toBe("claude-code (config file)");
    expect(items[1]!.hint).toBe("none (default)");
  });

  it("editing labels show correct step counting", () => {
    const options: WizardOption[] = [
      makeWizardOption({ key: "agent.command", label: "Agent command" }),
      makeWizardOption({
        key: "gate.maxStuck",
        label: "Max stuck iterations",
      }),
      makeWizardOption({ key: "sandbox", label: "Sandbox mode" }),
    ];

    expect(buildEditingLabel(options[0]!, 0, 3)).toBe("Agent command (1/3)");
    expect(buildEditingLabel(options[1]!, 1, 3)).toBe(
      "Max stuck iterations (2/3)",
    );
    expect(buildEditingLabel(options[2]!, 2, 3)).toBe("Sandbox mode (3/3)");
  });

  it("select items built from sandbox choices", () => {
    const items = buildSelectItems(["none", "docker"]);
    expect(items).toHaveLength(2);
    expect(items[0]!.value).toBe("none");
    expect(items[1]!.value).toBe("docker");
  });
});
