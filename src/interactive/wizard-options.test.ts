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
    const config = makeTestResolvedConfig(undefined, {
      maxStuck: { value: 5, source: "config" },
      iterationTimeout: { value: 120, source: "env" },
    });
    const options = buildWizardOptions(config);

    expect(findOption(options, "maxStuck").currentValue).toBe("5");
    expect(findOption(options, "iterationTimeout").currentValue).toBe("120");
  });

  // ---- Source hint mapping ----

  describe("source hints", () => {
    it('maps "default" to "default"', () => {
      const options = buildWizardOptions(makeTestResolvedConfig());
      expect(findOption(options, "baseBranch").sourceHint).toBe("default");
    });

    it('maps "config" to "config file"', () => {
      const config = makeTestResolvedConfig(undefined, {
        agentCommand: { value: "claude -p", source: "config" },
      });
      const options = buildWizardOptions(config);
      expect(findOption(options, "agentCommand").sourceHint).toBe(
        "config file",
      );
    });

    it('maps "env" to "env var"', () => {
      const config = makeTestResolvedConfig(undefined, {
        feedbackCommands: { value: "bun test", source: "env" },
      });
      const options = buildWizardOptions(config);
      expect(findOption(options, "feedbackCommands").sourceHint).toBe(
        "env var",
      );
    });

    it('maps "cli" to "CLI flag"', () => {
      const config = makeTestResolvedConfig(undefined, {
        maxStuck: { value: 10, source: "cli" },
      });
      const options = buildWizardOptions(config);
      expect(findOption(options, "maxStuck").sourceHint).toBe("CLI flag");
    });

    it("assigns correct source hints for all 6 keys with mixed sources", () => {
      const config = makeTestResolvedConfig(undefined, {
        agentCommand: { value: "opencode", source: "config" },
        setupCommand: { value: "npm ci", source: "env" },
        feedbackCommands: { value: "bun test,bun run build", source: "cli" },
        baseBranch: { value: "main", source: "default" },
        maxStuck: { value: 5, source: "config" },
        iterationTimeout: { value: 300, source: "env" },
      });
      const options = buildWizardOptions(config);

      expect(findOption(options, "agentCommand").sourceHint).toBe(
        "config file",
      );
      expect(findOption(options, "setupCommand").sourceHint).toBe("env var");
      expect(findOption(options, "feedbackCommands").sourceHint).toBe(
        "CLI flag",
      );
      expect(findOption(options, "baseBranch").sourceHint).toBe("default");
      expect(findOption(options, "maxStuck").sourceHint).toBe("config file");
      expect(findOption(options, "iterationTimeout").sourceHint).toBe(
        "env var",
      );
    });
  });

  // ---- Prompt metadata ----

  describe("prompt metadata", () => {
    it("assigns text prompt to string keys", () => {
      const options = buildWizardOptions(makeTestResolvedConfig());
      for (const key of [
        "agentCommand",
        "setupCommand",
        "feedbackCommands",
        "prFeedbackCommands",
        "baseBranch",
      ] as const) {
        expect(findOption(options, key).prompt.kind).toBe("text");
      }
    });

    it("assigns text prompt with validation to maxStuck", () => {
      const options = buildWizardOptions(makeTestResolvedConfig());
      const prompt = findOption(options, "maxStuck").prompt;
      expect(prompt.kind).toBe("text");
      if (prompt.kind === "text") {
        expect(prompt.validate).toBeFunction();
        expect(prompt.validate!("3")).toBeUndefined();
        expect(prompt.validate!("0")).toBeString(); // invalid: not positive
        expect(prompt.validate!("-1")).toBeString();
        expect(prompt.validate!("abc")).toBeString();
      }
    });

    it("assigns text prompt with validation to iterationTimeout", () => {
      const options = buildWizardOptions(makeTestResolvedConfig());
      const prompt = findOption(options, "iterationTimeout").prompt;
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
    expect(selectionsToFlags({ agentCommand: "opencode" })).toEqual([
      "--agent-command=opencode",
    ]);
  });

  it("produces --setup-command=<value>", () => {
    expect(selectionsToFlags({ setupCommand: "npm ci" })).toEqual([
      "--setup-command=npm ci",
    ]);
  });

  it("produces --setup-command= for empty string (disables setup)", () => {
    expect(selectionsToFlags({ setupCommand: "" })).toEqual([
      "--setup-command=",
    ]);
  });

  it("produces --feedback-commands=<value>", () => {
    expect(
      selectionsToFlags({ feedbackCommands: "bun test,bun run build" }),
    ).toEqual(["--feedback-commands=bun test,bun run build"]);
  });

  it("produces --feedback-commands= for empty string", () => {
    expect(selectionsToFlags({ feedbackCommands: "" })).toEqual([
      "--feedback-commands=",
    ]);
  });

  it("produces --pr-feedback-commands=<value>", () => {
    expect(
      selectionsToFlags({ prFeedbackCommands: "bun run test:e2e" }),
    ).toEqual(["--pr-feedback-commands=bun run test:e2e"]);
  });

  it("produces --pr-feedback-commands= for empty string", () => {
    expect(selectionsToFlags({ prFeedbackCommands: "" })).toEqual([
      "--pr-feedback-commands=",
    ]);
  });

  it("produces --base-branch=<value>", () => {
    expect(selectionsToFlags({ baseBranch: "develop" })).toEqual([
      "--base-branch=develop",
    ]);
  });

  // ---- Numeric keys ----

  it("produces --max-stuck=<n>", () => {
    expect(selectionsToFlags({ maxStuck: "5" })).toEqual(["--max-stuck=5"]);
  });

  it("produces --iteration-timeout=<n>", () => {
    expect(selectionsToFlags({ iterationTimeout: "120" })).toEqual([
      "--iteration-timeout=120",
    ]);
  });

  it("produces --iteration-timeout=0 for zero", () => {
    expect(selectionsToFlags({ iterationTimeout: "0" })).toEqual([
      "--iteration-timeout=0",
    ]);
  });

  // ---- Multiple selections ----

  it("produces flags in WIZARD_KEYS order for multiple selections", () => {
    const flags = selectionsToFlags({
      sandbox: "docker",
      agentCommand: "claude -p",
      maxStuck: "10",
    });
    // Should follow WIZARD_KEYS order: agentCommand, ..., maxStuck, ..., sandbox
    expect(flags).toEqual([
      "--agent-command=claude -p",
      "--max-stuck=10",
      "--sandbox=docker",
    ]);
  });

  it("produces flags for all 8 keys", () => {
    const flags = selectionsToFlags({
      agentCommand: "opencode",
      setupCommand: "npm ci",
      feedbackCommands: "bun test",
      prFeedbackCommands: "bun run test:e2e",
      baseBranch: "develop",
      maxStuck: "5",
      iterationTimeout: "300",
      sandbox: "docker",
    });
    expect(flags).toEqual([
      "--agent-command=opencode",
      "--setup-command=npm ci",
      "--feedback-commands=bun test",
      "--pr-feedback-commands=bun run test:e2e",
      "--base-branch=develop",
      "--max-stuck=5",
      "--iteration-timeout=300",
      "--sandbox=docker",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: selectionsToFlags → parseCLIArgs
// ---------------------------------------------------------------------------

describe("round-trip: selectionsToFlags → parseCLIArgs", () => {
  it("round-trips agentCommand", () => {
    const flags = selectionsToFlags({ agentCommand: "claude -p" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.agentCommand).toBe("claude -p");
  });

  it("round-trips setupCommand (empty string)", () => {
    const flags = selectionsToFlags({ setupCommand: "" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.setupCommand).toBe("");
  });

  it("round-trips feedbackCommands", () => {
    const flags = selectionsToFlags({
      feedbackCommands: "bun test,bun run build",
    });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.feedbackCommands).toBe("bun test,bun run build");
  });

  it("round-trips prFeedbackCommands", () => {
    const flags = selectionsToFlags({
      prFeedbackCommands: "bun run test:e2e",
    });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.prFeedbackCommands).toBe("bun run test:e2e");
  });

  it("round-trips baseBranch", () => {
    const flags = selectionsToFlags({ baseBranch: "develop" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.baseBranch).toBe("develop");
  });

  it("round-trips maxStuck", () => {
    const flags = selectionsToFlags({ maxStuck: "5" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.maxStuck).toBe(5);
  });

  it("round-trips iterationTimeout", () => {
    const flags = selectionsToFlags({ iterationTimeout: "120" });
    const { overrides } = parseCLIArgs(flags);
    expect(overrides.iterationTimeout).toBe(120);
  });

  it("round-trips all 8 keys at once", () => {
    const selections = {
      agentCommand: "opencode",
      setupCommand: "npm ci",
      feedbackCommands: "bun test",
      prFeedbackCommands: "bun run test:e2e",
      baseBranch: "develop",
      maxStuck: "5",
      iterationTimeout: "300",
      sandbox: "docker",
    } as const;

    const flags = selectionsToFlags(selections);
    const { overrides } = parseCLIArgs(flags);

    expect(overrides.agentCommand).toBe("opencode");
    expect(overrides.setupCommand).toBe("npm ci");
    expect(overrides.feedbackCommands).toBe("bun test");
    expect(overrides.prFeedbackCommands).toBe("bun run test:e2e");
    expect(overrides.baseBranch).toBe("develop");
    expect(overrides.maxStuck).toBe(5);
    expect(overrides.iterationTimeout).toBe(300);
    expect(overrides.sandbox).toBe("docker");
  });
});
