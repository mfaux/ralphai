/**
 * Tests for the run wizard.
 *
 * Tests CLI integration (help text, non-TTY error, flag recognition) via
 * runCli, and unit tests for runConfigWizard by mocking @clack/prompts.
 *
 * This file uses mock.module("@clack/prompts"), so it must run in an
 * isolated process (listed in ISOLATED in scripts/test.ts).  The CLI
 * integration tests therefore use runCli (subprocess) instead of
 * runCliInProcess to avoid mock.module poisoning the in-process imports.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { join } from "path";
import { runCli, useTempGitDir } from "../test-utils.ts";
import type { ResolvedConfig, ConfigSource } from "../config.ts";
import { DEFAULTS } from "../config.ts";

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
      base[key] = rv!;
    }
  }
  return base as unknown as ResolvedConfig;
}

// ---------------------------------------------------------------------------
// CLI integration: help text
// ---------------------------------------------------------------------------

describe("run --help wizard flag", () => {
  it("run --help lists --wizard, -w", () => {
    const result = runCli(["run", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--wizard");
    expect(result.stdout).toContain("-w");
  });
});

describe("ralphai --help mentions wizard", () => {
  it("ralphai --help run description mentions wizard mode", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("wizard");
  });
});

// ---------------------------------------------------------------------------
// CLI integration: non-TTY error
// ---------------------------------------------------------------------------

describe("--wizard non-TTY error", () => {
  const ctx = useTempGitDir();
  const env = () => ({ RALPHAI_HOME: join(ctx.dir, ".ralphai-home") });

  it("ralphai run --wizard in non-TTY prints error with guidance", () => {
    // runCli runs in a pipe (non-TTY) context
    runCli(["init", "--yes"], ctx.dir, env());
    const result = runCli(["run", "--wizard"], ctx.dir, env());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--wizard");
    expect(result.stderr).toContain("TTY");
  });

  it("ralphai run -w in non-TTY prints error with guidance", () => {
    runCli(["init", "--yes"], ctx.dir, env());
    const result = runCli(["run", "-w"], ctx.dir, env());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--wizard");
    expect(result.stderr).toContain("TTY");
  });

  it("--wizard is not rejected as an unknown flag", () => {
    runCli(["init", "--yes"], ctx.dir, env());
    const result = runCli(["run", "--wizard"], ctx.dir, env());
    // Should get the TTY error, not "Unrecognized argument"
    expect(result.stderr).not.toContain("Unrecognized argument");
  });

  it("-w is not rejected as an unknown flag", () => {
    runCli(["init", "--yes"], ctx.dir, env());
    const result = runCli(["run", "-w"], ctx.dir, env());
    expect(result.stderr).not.toContain("Unrecognized argument");
  });
});

// ---------------------------------------------------------------------------
// Unit tests: runConfigWizard with mocked clack
// ---------------------------------------------------------------------------

describe("runConfigWizard", () => {
  // We need to mock @clack/prompts before importing runConfigWizard.
  // Use bun's mock.module to intercept the clack import.

  let mockMultiselect: ReturnType<typeof mock>;
  let mockText: ReturnType<typeof mock>;
  let mockSelect: ReturnType<typeof mock>;
  let mockIntro: ReturnType<typeof mock>;
  let mockOutro: ReturnType<typeof mock>;
  let mockCancel: ReturnType<typeof mock>;
  let mockIsCancel: ReturnType<typeof mock>;
  let runConfigWizard: typeof import("./run-wizard.ts").runConfigWizard;

  beforeEach(async () => {
    mockMultiselect = mock();
    mockText = mock();
    mockSelect = mock();
    mockIntro = mock();
    mockOutro = mock();
    mockCancel = mock();
    mockIsCancel = mock(() => false);

    mock.module("@clack/prompts", () => ({
      multiselect: mockMultiselect,
      text: mockText,
      select: mockSelect,
      intro: mockIntro,
      outro: mockOutro,
      cancel: mockCancel,
      isCancel: mockIsCancel,
    }));

    // Re-import to pick up mocked clack
    const mod = await import("./run-wizard.ts");
    runConfigWizard = mod.runConfigWizard;
  });

  it("returns empty array when user selects nothing", async () => {
    mockMultiselect.mockResolvedValue([]);
    const result = await runConfigWizard(makeConfig());
    expect(result).toEqual([]);
    expect(mockIntro).toHaveBeenCalled();
    expect(mockOutro).toHaveBeenCalled();
  });

  it("returns null when user cancels at multiselect", async () => {
    const cancelSymbol = Symbol("cancel");
    mockMultiselect.mockResolvedValue(cancelSymbol);
    mockIsCancel.mockImplementation((v: unknown) => v === cancelSymbol);

    const result = await runConfigWizard(makeConfig());
    expect(result).toBeNull();
    expect(mockCancel).toHaveBeenCalled();
  });

  it("returns null when user cancels at individual text prompt", async () => {
    const cancelSymbol = Symbol("cancel");
    mockMultiselect.mockResolvedValue(["agentCommand"]);
    mockText.mockResolvedValue(cancelSymbol);
    mockIsCancel.mockImplementation((v: unknown) => v === cancelSymbol);

    const result = await runConfigWizard(makeConfig());
    expect(result).toBeNull();
    expect(mockCancel).toHaveBeenCalled();
  });

  it("returns null when user cancels at select prompt", async () => {
    const cancelSymbol = Symbol("cancel");
    mockMultiselect.mockResolvedValue(["autoCommit"]);
    mockSelect.mockResolvedValue(cancelSymbol);
    mockIsCancel.mockImplementation((v: unknown) => v === cancelSymbol);

    const result = await runConfigWizard(makeConfig());
    expect(result).toBeNull();
  });

  it("returns synthetic flags for selected text options", async () => {
    mockMultiselect.mockResolvedValue(["agentCommand", "baseBranch"]);
    mockText
      .mockResolvedValueOnce("claude -p")
      .mockResolvedValueOnce("develop");

    const result = await runConfigWizard(makeConfig());
    expect(result).toEqual([
      "--agent-command=claude -p",
      "--base-branch=develop",
    ]);
  });

  it("returns synthetic flags for autoCommit select", async () => {
    mockMultiselect.mockResolvedValue(["autoCommit"]);
    mockSelect.mockResolvedValue("true");

    const result = await runConfigWizard(makeConfig());
    expect(result).toEqual(["--auto-commit"]);
  });

  it("returns --no-auto-commit for autoCommit false", async () => {
    mockMultiselect.mockResolvedValue(["autoCommit"]);
    mockSelect.mockResolvedValue("false");

    const result = await runConfigWizard(makeConfig());
    expect(result).toEqual(["--no-auto-commit"]);
  });

  it("returns flags for numeric options", async () => {
    mockMultiselect.mockResolvedValue(["maxStuck", "iterationTimeout"]);
    mockText.mockResolvedValueOnce("5").mockResolvedValueOnce("120");

    const result = await runConfigWizard(makeConfig());
    expect(result).toEqual(["--max-stuck=5", "--iteration-timeout=120"]);
  });

  it("multiselect options show current values and source hints", async () => {
    const config = makeConfig({
      agentCommand: { value: "claude -p", source: "config" },
      maxStuck: { value: 5, source: "env" },
    });
    mockMultiselect.mockResolvedValue([]);

    await runConfigWizard(config);

    // Check the options passed to multiselect
    const call = mockMultiselect.mock.calls[0]![0] as {
      options: { value: string; hint: string }[];
    };
    const agentOpt = call.options.find((o) => o.value === "agentCommand");
    expect(agentOpt!.hint).toContain("claude -p");
    expect(agentOpt!.hint).toContain("config file");

    const maxStuckOpt = call.options.find((o) => o.value === "maxStuck");
    expect(maxStuckOpt!.hint).toContain("5");
    expect(maxStuckOpt!.hint).toContain("env var");
  });

  it("shows all 9 options in multiselect", async () => {
    mockMultiselect.mockResolvedValue([]);
    await runConfigWizard(makeConfig());

    const call = mockMultiselect.mock.calls[0]![0] as {
      options: { value: string }[];
    };
    expect(call.options).toHaveLength(9);
    const keys = call.options.map((o) => o.value);
    expect(keys).toContain("agentCommand");
    expect(keys).toContain("setupCommand");
    expect(keys).toContain("feedbackCommands");
    expect(keys).toContain("prFeedbackCommands");
    expect(keys).toContain("baseBranch");
    expect(keys).toContain("maxStuck");
    expect(keys).toContain("iterationTimeout");
    expect(keys).toContain("autoCommit");
    expect(keys).toContain("sandbox");
  });

  it("text prompt receives current value as initialValue", async () => {
    const config = makeConfig({
      agentCommand: { value: "opencode run --agent build", source: "default" },
    });
    mockMultiselect.mockResolvedValue(["agentCommand"]);
    mockText.mockResolvedValue("claude -p");

    await runConfigWizard(config);

    const textCall = mockText.mock.calls[0]![0] as { initialValue: string };
    expect(textCall.initialValue).toBe("opencode run --agent build");
  });

  it("select prompt receives current value as initialValue", async () => {
    const config = makeConfig({
      autoCommit: { value: "true", source: "config" },
    });
    mockMultiselect.mockResolvedValue(["autoCommit"]);
    mockSelect.mockResolvedValue("false");

    await runConfigWizard(config);

    const selectCall = mockSelect.mock.calls[0]![0] as {
      initialValue: string;
    };
    expect(selectCall.initialValue).toBe("true");
  });

  it("handles all 7 options selected at once", async () => {
    mockMultiselect.mockResolvedValue([
      "agentCommand",
      "setupCommand",
      "feedbackCommands",
      "baseBranch",
      "maxStuck",
      "iterationTimeout",
      "autoCommit",
    ]);
    // First 6 are text, last is select
    mockText
      .mockResolvedValueOnce("claude -p")
      .mockResolvedValueOnce("npm ci")
      .mockResolvedValueOnce("bun test,bun build")
      .mockResolvedValueOnce("develop")
      .mockResolvedValueOnce("5")
      .mockResolvedValueOnce("300");
    mockSelect.mockResolvedValue("true");

    const result = await runConfigWizard(makeConfig());
    expect(result).toEqual([
      "--agent-command=claude -p",
      "--setup-command=npm ci",
      "--feedback-commands=bun test,bun build",
      "--base-branch=develop",
      "--max-stuck=5",
      "--iteration-timeout=300",
      "--auto-commit",
    ]);
  });
});
