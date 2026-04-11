/**
 * Tests for the wizard options pure data layer.
 *
 * Tests buildWizardOptions and selectionsToFlags with various ResolvedConfig
 * inputs. These are pure unit tests — no filesystem, no subprocess, no clack
 * prompts. Includes round-trip tests verifying that generated flags are
 * parseable by parseCLIArgs().
 */

import { describe, it, expect } from "bun:test";
import { parseCLIArgs } from "../config.ts";
import { makeTestResolvedConfig } from "../test-utils.ts";
import {
  buildWizardOptions,
  selectionsToFlags,
  WIZARD_KEYS,
  type WizardConfigKey,
  type WizardOption,
} from "./wizard-options.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a wizard option by key. */
function findOption(
  options: WizardOption[],
  key: WizardConfigKey,
): WizardOption {
  const opt = options.find((o) => o.key === key);
  if (!opt) throw new Error(`Option not found: ${key}`);
  return opt;
}

// ---------------------------------------------------------------------------
// buildWizardOptions
// ---------------------------------------------------------------------------

describe("buildWizardOptions", () => {
  it("returns exactly 8 options in the expected order", () => {
    const options = buildWizardOptions(makeTestResolvedConfig());
    expect(options).toHaveLength(8);
    expect(options.map((o) => o.key)).toEqual([...WIZARD_KEYS]);
  });

  it("includes a human-readable label for every key", () => {
    const options = buildWizardOptions(makeTestResolvedConfig());
    for (const opt of options) {
      expect(opt.label).toBeString();
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  it("shows current values as strings", () => {
    const rc = makeTestResolvedConfig();
    rc.gate.maxStuck = { value: 5, source: "config" };
    rc.gate.iterationTimeout = { value: 120, source: "env" };
    const options = buildWizardOptions(rc);

    expect(findOption(options, "gate.maxStuck").currentValue).toBe("5");
    expect(findOption(options, "gate.iterationTimeout").currentValue).toBe(
      "120",
    );
  });

  // ---- Source hint mapping ----

  describe("source hints", () => {
    it('maps "default" to "default"', () => {
      const options = buildWizardOptions(makeTestResolvedConfig());
      expect(findOption(options, "baseBranch").sourceHint).toBe("default");
    });

    it('maps "config" to "config file"', () => {
      const rc = makeTestResolvedConfig();
      rc.agent.command = { value: "claude -p", source: "config" };
      const options = buildWizardOptions(rc);
      expect(findOption(options, "agent.command").sourceHint).toBe(
        "config file",
      );
    });

    it('maps "env" to "env var"', () => {
      const rc = makeTestResolvedConfig();
      rc.hooks.feedback = { value: "bun test", source: "env" };
      const options = buildWizardOptions(rc);
      expect(findOption(options, "hooks.feedback").sourceHint).toBe("env var");
    });

    it('maps "cli" to "CLI flag"', () => {
      const rc = makeTestResolvedConfig();
      rc.gate.maxStuck = { value: 10, source: "cli" };
      const options = buildWizardOptions(rc);
      expect(findOption(options, "gate.maxStuck").sourceHint).toBe("CLI flag");
    });

    it("assigns correct source hints for all 6 keys with mixed sources", () => {
      const rc = makeTestResolvedConfig();
      rc.agent.command = { value: "opencode", source: "config" };
      rc.agent.setupCommand = { value: "npm ci", source: "env" };
      rc.hooks.feedback = {
        value: "bun test,bun run build",
        source: "cli",
      };
      rc.baseBranch = { value: "main", source: "default" };
      rc.gate.maxStuck = { value: 5, source: "config" };
      rc.gate.iterationTimeout = { value: 300, source: "env" };
      const options = buildWizardOptions(rc);

      expect(findOption(options, "agent.command").sourceHint).toBe(
        "config file",
      );
      expect(findOption(options, "agent.setupCommand").sourceHint).toBe(
        "env var",
      );
      expect(findOption(options, "hooks.feedback").sourceHint).toBe("CLI flag");
      expect(findOption(options, "baseBranch").sourceHint).toBe("default");
      expect(findOption(options, "gate.maxStuck").sourceHint).toBe(
        "config file",
      );
      expect(findOption(options, "gate.iterationTimeout").sourceHint).toBe(
        "env var",
      );
    });
  });

  // ---- Prompt metadata ----

  describe("prompt metadata", () => {
    it("assigns text prompt to string keys", () => {
      const options = buildWizardOptions(makeTestResolvedConfig());
      for (const key of [
        "agent.command",
        "agent.setupCommand",
        "hooks.feedback",
        "hooks.prFeedback",
        "baseBranch",
      ] as const) {
        expect(findOption(options, key).prompt.kind).toBe("text");
      }
    });

    it("assigns text prompt with validation to gate.maxStuck", () => {
      const options = buildWizardOptions(makeTestResolvedConfig());
      const prompt = findOption(options, "gate.maxStuck").prompt;
      expect(prompt.kind).toBe("text");
      if (prompt.kind === "text") {
        expect(prompt.validate).toBeFunction();
        expect(prompt.validate!("3")).toBeUndefined();
        expect(prompt.validate!("0")).toBeString(); // invalid: not positive
        expect(prompt.validate!("-1")).toBeString();
        expect(prompt.validate!("abc")).toBeString();
      }
    });

    it("assigns text prompt with validation to gate.iterationTimeout", () => {
      const options = buildWizardOptions(makeTestResolvedConfig());
      const prompt = findOption(options, "gate.iterationTimeout").prompt;
      expect(prompt.kind).toBe("text");
      if (prompt.kind === "text") {
        expect(prompt.validate).toBeFunction();
        expect(prompt.validate!("0")).toBeUndefined(); // valid: non-negative
        expect(prompt.validate!("120")).toBeUndefined();
        expect(prompt.validate!("-1")).toBeString();
        expect(prompt.validate!("abc")).toBeString();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// selectionsToFlags
// ---------------------------------------------------------------------------

describe("selectionsToFlags", () => {
  it("returns empty array for empty selections", () => {
    expect(selectionsToFlags({})).toEqual([]);
  });

  // ---- String keys ----

  it("produces --agent-command=<value>", () => {
    expect(selectionsToFlags({ "agent.command": "opencode" })).toEqual([
      "--agent-command=opencode",
    ]);
  });

  it("produces --agent-setup-command=<value>", () => {
    expect(selectionsToFlags({ "agent.setupCommand": "npm ci" })).toEqual([
      "--agent-setup-command=npm ci",
    ]);
  });

  it("produces --agent-setup-command= for empty string (disables setup)", () => {
    expect(selectionsToFlags({ "agent.setupCommand": "" })).toEqual([
      "--agent-setup-command=",
    ]);
  });

  it("produces --hooks-feedback=<value>", () => {
    expect(
      selectionsToFlags({ "hooks.feedback": "bun test,bun run build" }),
    ).toEqual(["--hooks-feedback=bun test,bun run build"]);
  });

  it("produces --hooks-feedback= for empty string", () => {
    expect(selectionsToFlags({ "hooks.feedback": "" })).toEqual([
      "--hooks-feedback=",
    ]);
  });

  it("produces --hooks-pr-feedback=<value>", () => {
    expect(
      selectionsToFlags({ "hooks.prFeedback": "bun run test:e2e" }),
    ).toEqual(["--hooks-pr-feedback=bun run test:e2e"]);
  });

  it("produces --hooks-pr-feedback= for empty string", () => {
    expect(selectionsToFlags({ "hooks.prFeedback": "" })).toEqual([
      "--hooks-pr-feedback=",
    ]);
  });

  it("produces --base-branch=<value>", () => {
    expect(selectionsToFlags({ baseBranch: "develop" })).toEqual([
      "--base-branch=develop",
    ]);
  });

  // ---- Numeric keys ----

  it("produces --gate-max-stuck=<n>", () => {
    expect(selectionsToFlags({ "gate.maxStuck": "5" })).toEqual([
      "--gate-max-stuck=5",
    ]);
  });

  it("produces --gate-iteration-timeout=<n>", () => {
    expect(selectionsToFlags({ "gate.iterationTimeout": "120" })).toEqual([
      "--gate-iteration-timeout=120",
    ]);
  });

  it("produces --gate-iteration-timeout=0 for zero", () => {
    expect(selectionsToFlags({ "gate.iterationTimeout": "0" })).toEqual([
      "--gate-iteration-timeout=0",
    ]);
  });

  // ---- Multiple selections ----

  it("produces flags in WIZARD_KEYS order for multiple selections", () => {
    const flags = selectionsToFlags({
      sandbox: "docker",
      "agent.command": "claude -p",
      "gate.maxStuck": "10",
    });
    // Should follow WIZARD_KEYS order: agent.command, ..., gate.maxStuck, ..., sandbox
    expect(flags).toEqual([
      "--agent-command=claude -p",
      "--gate-max-stuck=10",
      "--sandbox=docker",
    ]);
  });

  it("produces flags for all 8 keys", () => {
    const flags = selectionsToFlags({
      "agent.command": "opencode",
      "agent.setupCommand": "npm ci",
      "hooks.feedback": "bun test",
      "hooks.prFeedback": "bun run test:e2e",
      baseBranch: "develop",
      "gate.maxStuck": "5",
      "gate.iterationTimeout": "300",
      sandbox: "docker",
    });
    expect(flags).toEqual([
      "--agent-command=opencode",
      "--agent-setup-command=npm ci",
      "--hooks-feedback=bun test",
      "--hooks-pr-feedback=bun run test:e2e",
      "--base-branch=develop",
      "--gate-max-stuck=5",
      "--gate-iteration-timeout=300",
      "--sandbox=docker",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: selectionsToFlags → parseCLIArgs
// ---------------------------------------------------------------------------

describe("round-trip: selectionsToFlags → parseCLIArgs", () => {
  it("round-trips agent.command", () => {
    const flags = selectionsToFlags({ "agent.command": "claude -p" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.agent!.command).toBe("claude -p");
  });

  it("round-trips agent.setupCommand (empty string)", () => {
    const flags = selectionsToFlags({ "agent.setupCommand": "" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.agent!.setupCommand).toBe("");
  });

  it("round-trips hooks.feedback", () => {
    const flags = selectionsToFlags({
      "hooks.feedback": "bun test,bun run build",
    });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.hooks!.feedback).toBe("bun test,bun run build");
  });

  it("round-trips hooks.prFeedback", () => {
    const flags = selectionsToFlags({
      "hooks.prFeedback": "bun run test:e2e",
    });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.hooks!.prFeedback).toBe("bun run test:e2e");
  });

  it("round-trips baseBranch", () => {
    const flags = selectionsToFlags({ baseBranch: "develop" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.baseBranch).toBe("develop");
  });

  it("round-trips gate.maxStuck", () => {
    const flags = selectionsToFlags({ "gate.maxStuck": "5" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.gate!.maxStuck).toBe(5);
  });

  it("round-trips gate.iterationTimeout", () => {
    const flags = selectionsToFlags({ "gate.iterationTimeout": "120" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.gate!.iterationTimeout).toBe(120);
  });

  it("round-trips all 8 keys at once", () => {
    const selections = {
      "agent.command": "opencode",
      "agent.setupCommand": "npm ci",
      "hooks.feedback": "bun test",
      "hooks.prFeedback": "bun run test:e2e",
      baseBranch: "develop",
      "gate.maxStuck": "5",
      "gate.iterationTimeout": "300",
      sandbox: "docker",
    } as const;

    const flags = selectionsToFlags(selections);
    const { overrides } = parseCLIArgs(flags);

    expect(overrides.agent!.command).toBe("opencode");
    expect(overrides.agent!.setupCommand).toBe("npm ci");
    expect(overrides.hooks!.feedback).toBe("bun test");
    expect(overrides.hooks!.prFeedback).toBe("bun run test:e2e");
    expect(overrides.baseBranch).toBe("develop");
    expect(overrides.gate!.maxStuck).toBe(5);
    expect(overrides.gate!.iterationTimeout).toBe(300);
    expect(overrides.sandbox).toBe("docker");
  });
});
