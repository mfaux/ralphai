import { describe, it, expect } from "vitest";
import {
  formatShowConfig,
  detectAgentType,
  type FormatShowConfigInput,
} from "./show-config.ts";
import type { ResolvedConfig, RalphaiConfig } from "./config.ts";
import { DEFAULTS } from "./config.ts";

// ---------------------------------------------------------------------------
// Helper: build a ResolvedConfig from defaults with optional overrides
// ---------------------------------------------------------------------------

type FieldOverride<K extends keyof RalphaiConfig> = {
  value: RalphaiConfig[K];
  source: "default" | "config" | "env" | "cli";
};

function makeResolved(
  overrides: Partial<{
    [K in keyof RalphaiConfig]: FieldOverride<K>;
  }> = {},
): ResolvedConfig {
  const resolved: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS) as Array<keyof RalphaiConfig>) {
    resolved[key] = overrides[key] ?? {
      value: DEFAULTS[key],
      source: "default",
    };
  }
  return resolved as unknown as ResolvedConfig;
}

// ---------------------------------------------------------------------------
// detectAgentType
// ---------------------------------------------------------------------------

describe("detectAgentType", () => {
  it("detects claude", () => {
    expect(detectAgentType("claude -p")).toBe("claude");
  });

  it("detects opencode", () => {
    expect(detectAgentType("opencode --agent")).toBe("opencode");
  });

  it("detects codex", () => {
    expect(detectAgentType("codex run")).toBe("codex");
  });

  it("detects gemini", () => {
    expect(detectAgentType("gemini-cli")).toBe("gemini");
  });

  it("detects aider", () => {
    expect(detectAgentType("aider --yes")).toBe("aider");
  });

  it("detects goose", () => {
    expect(detectAgentType("goose session")).toBe("goose");
  });

  it("detects kiro", () => {
    expect(detectAgentType("kiro --auto")).toBe("kiro");
  });

  it("detects amp", () => {
    expect(detectAgentType("amp run")).toBe("amp");
  });

  it("returns unknown for unrecognized command", () => {
    expect(detectAgentType("my-custom-agent")).toBe("unknown");
  });

  it("returns unknown for empty command", () => {
    expect(detectAgentType("")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(detectAgentType("CLAUDE -p")).toBe("claude");
  });
});

// ---------------------------------------------------------------------------
// formatShowConfig
// ---------------------------------------------------------------------------

describe("formatShowConfig", () => {
  const defaultInput = (): FormatShowConfigInput => ({
    config: makeResolved(),
    configFilePath: "/home/user/.ralphai/repos/test-repo/config.json",
    configFileExists: false,
    envVars: {},
    rawFlags: {},
    workspaces: null,
  });

  it("starts with the header line", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).toContain(
      "Resolved settings (precedence: CLI > env > config > defaults):",
    );
  });

  it("shows all default values with default sources", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).toContain("  agentCommand       = <none>  (default (none))");
    expect(output).toContain("  feedbackCommands   = <none>  (default (none))");
    expect(output).toContain("  baseBranch         = main  (default)");
    expect(output).toContain("  mode               = branch  (default)");
    expect(output).toContain("  continuous         = false  (default)");
    expect(output).toContain("  autoCommit         = false  (default)");
    expect(output).toContain("  maxStuck           = 3  (default)");
    expect(output).toContain("  taskTimeout        = off  (default)");
    expect(output).toContain("  maxLearnings       = 20  (default)");
    expect(output).toContain("  issueSource        = none  (default)");
  });

  it("shows <no agentCommand set> when agentCommand is empty", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).toContain("  detectedAgentType  = <no agentCommand set>");
  });

  it("shows detected agent type when agentCommand is set", () => {
    const input = defaultInput();
    input.config = makeResolved({
      agentCommand: { value: "claude -p", source: "config" },
    });
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain("  detectedAgentType  = claude");
  });

  it("hides issue detail fields when issueSource is none", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).not.toContain("  issueLabel");
    expect(output).not.toContain("  issueInProgressLabel");
    expect(output).not.toContain("  issueRepo");
    expect(output).not.toContain("  issueCommentProgress");
  });

  it("shows issue detail fields when issueSource is github", () => {
    const input = defaultInput();
    input.config = makeResolved({
      issueSource: { value: "github", source: "config" },
    });
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain("  issueLabel         = ralphai  (default)");
    expect(output).toContain(
      "  issueInProgressLabel = ralphai:in-progress  (default)",
    );
    expect(output).toContain(
      "  issueRepo          = <auto-detect>  (default (auto-detect))",
    );
    expect(output).toContain("  issueCommentProgress = true  (default)");
  });

  it("shows maxLearnings=0 as unlimited", () => {
    const input = defaultInput();
    input.config = makeResolved({
      maxLearnings: { value: 0, source: "config" },
    });
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain("  maxLearnings       = unlimited");
  });

  // --- Source label tests ---

  it("shows config source with file path", () => {
    const input = defaultInput();
    input.config = makeResolved({
      baseBranch: { value: "develop", source: "config" },
    });
    input.configFilePath = "/home/user/.ralphai/repos/test-repo/config.json";
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  baseBranch         = develop  (config (/home/user/.ralphai/repos/test-repo/config.json))",
    );
  });

  it("shows env source with var name and value", () => {
    const input = defaultInput();
    input.config = makeResolved({
      mode: { value: "patch", source: "env" },
    });
    input.envVars = { RALPHAI_MODE: "patch" };
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  mode               = patch  (env (RALPHAI_MODE=patch))",
    );
  });

  it("shows cli source for mode with raw flag (--branch)", () => {
    const input = defaultInput();
    input.config = makeResolved({
      mode: { value: "branch", source: "cli" },
    });
    input.rawFlags = { mode: "--branch" };
    const output = formatShowConfig(input);
    expect(output).toContain("  mode               = branch  (cli (--branch))");
  });

  it("shows cli source for autoCommit --no-auto-commit", () => {
    const input = defaultInput();
    input.config = makeResolved({
      autoCommit: { value: "false", source: "cli" },
    });
    input.rawFlags = { autoCommit: "--no-auto-commit" };
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  autoCommit         = false  (cli (--no-auto-commit))",
    );
  });

  // --- Config file status ---

  it("shows config file as not found when missing", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).toContain(
      "Config file: /home/user/.ralphai/repos/test-repo/config.json (not found, using defaults)",
    );
  });

  it("shows config file as loaded when present", () => {
    const input = defaultInput();
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain(
      "Config file: /home/user/.ralphai/repos/test-repo/config.json (loaded)",
    );
  });

  // --- Worktree info ---

  it("shows worktree info when in a worktree", () => {
    const input = defaultInput();
    input.worktree = {
      isWorktree: true,
      mainWorktree: "/home/user/project",
    };
    const output = formatShowConfig(input);
    expect(output).toContain("  worktree           = true");
    expect(output).toContain("  mainWorktree       = /home/user/project");
  });

  it("omits worktree info when not in a worktree", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).not.toContain("worktree");
    expect(output).not.toContain("mainWorktree");
  });

  // --- Workspaces display ---

  it("shows workspaces when present", () => {
    const input = defaultInput();
    input.configFileExists = true;
    input.workspaces = {
      "packages/foo": { feedbackCommands: ["bun test", "bun run lint"] },
    };
    const output = formatShowConfig(input);
    expect(output).toContain("Workspaces (per-package overrides):");
    expect(output).toContain(
      "  packages/foo: feedbackCommands=bun test, bun run lint",
    );
  });

  it("shows workspaces with string feedbackCommands", () => {
    const input = defaultInput();
    input.configFileExists = true;
    input.workspaces = {
      "packages/bar": { feedbackCommands: "npm test" },
    };
    const output = formatShowConfig(input);
    expect(output).toContain("  packages/bar: feedbackCommands=npm test");
  });

  it("shows workspaces with null feedbackCommands as none", () => {
    const input = defaultInput();
    input.configFileExists = true;
    input.workspaces = {
      "packages/baz": {},
    };
    const output = formatShowConfig(input);
    expect(output).toContain("  packages/baz: feedbackCommands=none");
  });
});
