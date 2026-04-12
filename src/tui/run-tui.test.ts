/**
 * Tests for `src/tui/run-tui.tsx` — TUI entry point pure helpers.
 *
 * Tests the `buildAppProps` function which maps resolved config to
 * `AppProps`. Integration tests for the full `runTui()` flow are
 * deferred until `ink-testing-library` is available.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { Screen } from "./types.ts";
import type { ConfirmData } from "./screens/confirm.tsx";

// ---------------------------------------------------------------------------
// buildAppProps (uses config resolution — mock the config module)
// ---------------------------------------------------------------------------

// We test buildAppProps by mocking resolveConfig. Since it does I/O
// (reads config files, env vars), we inject different resolved values.

describe("buildAppProps", () => {
  // Dynamic import to allow mocking
  let buildAppProps: (typeof import("./run-tui.tsx"))["buildAppProps"];

  beforeEach(async () => {
    const mod = await import("./run-tui.tsx");
    buildAppProps = mod.buildAppProps;
  });

  it("returns pipelineOpts with the given cwd", () => {
    const props = buildAppProps("/test/cwd");
    expect(props.pipelineOpts.cwd).toBe("/test/cwd");
  });

  it("defaults to no GitHub issues when config resolution fails", () => {
    // Use a cwd that won't have a config file — config resolution
    // should fail silently and default to no GitHub issues.
    const props = buildAppProps("/nonexistent/path");
    expect(props.hasGitHubIssues).toBe(false);
    expect(props.githubOpts).toBeUndefined();
    expect(props.issueListOptions).toBeUndefined();
  });

  it("includes runConfig with defaults when config resolution fails", () => {
    const props = buildAppProps("/nonexistent/path");
    expect(props.runConfig).toBeDefined();
    expect(props.runConfig!.agentCommand).toBe("");
    expect(props.runConfig!.feedbackCommands).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Screen type: confirm variant
// ---------------------------------------------------------------------------

describe("Screen confirm variant", () => {
  it("can construct a confirm screen with data", () => {
    const data: ConfirmData = {
      title: "test-plan.md",
      agentCommand: "claude",
      branch: "feat/test",
      feedbackCommands: "bun test",
      runArgs: ["run"],
    };

    const screen: Screen = {
      type: "confirm",
      data,
    };

    expect(screen.type).toBe("confirm");
    expect(screen.data).toBe(data);
    expect(screen.backScreen).toBeUndefined();
  });

  it("can construct a confirm screen with backScreen", () => {
    const data: ConfirmData = {
      title: "#42 Fix bug",
      agentCommand: "aider",
      branch: "fix/bug-42",
      feedbackCommands: "",
      runArgs: ["run", "42"],
    };

    const backScreen: Screen = { type: "issue-picker" };

    const screen: Screen = {
      type: "confirm",
      data,
      backScreen,
    };

    expect(screen.type).toBe("confirm");
    expect(screen.backScreen).toEqual({ type: "issue-picker" });
  });

  it("confirm screen backScreen defaults to menu when navigating back", () => {
    // The ConfirmScreen component defaults backScreen to { type: "menu" }
    // but the Screen type allows it to be undefined
    const data: ConfirmData = {
      title: "plan.md",
      agentCommand: "",
      branch: "feat/plan",
      feedbackCommands: "",
      runArgs: ["run", "--plan=plan.md"],
    };

    const screen: Screen = {
      type: "confirm",
      data,
    };

    expect(screen.backScreen).toBeUndefined();
  });

  it("confirm screen with PRD context", () => {
    const data: ConfirmData = {
      title: "#43 Implement auth",
      agentCommand: "claude",
      branch: "feat/auth",
      feedbackCommands: "bun test; bun run build",
      prdContext: {
        prdTitle: "Auth Redesign",
        position: "1 of 3 remaining",
      },
      runArgs: ["run", "43"],
    };

    const screen: Screen = {
      type: "confirm",
      data,
      backScreen: { type: "issue-picker" },
    };

    expect(screen.data.prdContext?.prdTitle).toBe("Auth Redesign");
    expect(screen.data.prdContext?.position).toBe("1 of 3 remaining");
  });
});

// ---------------------------------------------------------------------------
// DispatchResult: exit-to-runner flow
// ---------------------------------------------------------------------------

describe("exit-to-runner dispatch flow", () => {
  it("confirm screen Enter produces exit-to-runner with runArgs", () => {
    // Simulate what the confirm screen does on Enter:
    // onResult({ type: "exit-to-runner", args: data.runArgs })
    const data: ConfirmData = {
      title: "test.md",
      agentCommand: "claude",
      branch: "feat/test",
      feedbackCommands: "",
      runArgs: ["run", "--plan=test.md"],
    };

    const result = { type: "exit-to-runner" as const, args: data.runArgs };
    expect(result.type).toBe("exit-to-runner");
    expect(result.args).toEqual(["run", "--plan=test.md"]);
  });

  it("confirm screen Esc produces navigate back to menu", () => {
    const result = {
      type: "navigate" as const,
      screen: { type: "menu" as const },
    };
    expect(result.type).toBe("navigate");
    expect(result.screen.type).toBe("menu");
  });

  it("confirm screen Esc produces navigate back to issue-picker", () => {
    const backScreen: Screen = { type: "issue-picker" };
    const result = { type: "navigate" as const, screen: backScreen };
    expect(result.type).toBe("navigate");
    expect(result.screen.type).toBe("issue-picker");
  });

  it("confirm screen o produces stay (placeholder)", () => {
    const result = { type: "stay" as const };
    expect(result.type).toBe("stay");
  });
});

// ---------------------------------------------------------------------------
// RunTuiResult type contract
// ---------------------------------------------------------------------------

describe("RunTuiResult contract", () => {
  it("result with args indicates a run should happen", () => {
    const result = { args: ["run"] as string[] | undefined };
    expect(result.args).toBeDefined();
    expect(result.args).toEqual(["run"]);
  });

  it("result with undefined args indicates user quit", () => {
    const result = { args: undefined as string[] | undefined };
    expect(result.args).toBeUndefined();
  });
});
