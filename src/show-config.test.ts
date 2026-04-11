import { describe, it, expect } from "bun:test";
import {
  formatShowConfig,
  detectAgentType,
  type FormatShowConfigInput,
} from "./show-config.ts";
import type { ResolvedConfig } from "./config.ts";
import { makeTestResolvedConfig } from "./test-utils.ts";

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

  it("matches only the binary name, not flag values", () => {
    // opencode command with a --model flag that contains "claude" should
    // detect as opencode, not claude.
    expect(
      detectAgentType(
        "opencode run --agent build --model github-copilot/claude-opus-4.6",
      ),
    ).toBe("opencode");
  });

  it("ignores agent names appearing in non-binary arguments", () => {
    expect(detectAgentType("my-tool --backend claude")).toBe("unknown");
    expect(detectAgentType("codex --model opencode-v2")).toBe("codex");
  });
});

// ---------------------------------------------------------------------------
// formatShowConfig
// ---------------------------------------------------------------------------

describe("formatShowConfig", () => {
  const defaultInput = (): FormatShowConfigInput => ({
    config: makeTestResolvedConfig(),
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
    expect(output).toContain("  agent.command      = <none>  (default (none))");
    expect(output).toContain(
      "  agent.interactiveCommand = <none>  (default (none))",
    );
    expect(output).toContain("  agent.setupCommand = <none>  (default (none))");
    expect(output).toContain("  hooks.feedback     = <none>  (default (none))");
    expect(output).toContain("  hooks.prFeedback   = <none>  (default (none))");
    expect(output).toContain("  baseBranch         = main  (default)");
    expect(output).toContain("  gate.review        = true  (default)");
    expect(output).toContain("  prompt.verbose     = false  (default)");
    expect(output).toContain("  gate.maxStuck      = 3  (default)");
    expect(output).toContain("  gate.iterationTimeout = off  (default)");
    expect(output).toContain("  issue.source       = none  (default)");
  });

  it("shows agent.setupCommand when configured", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.agent.setupCommand = { value: "bun install", source: "config" };
    input.config = rc;
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain("  agent.setupCommand = bun install  (config (");
  });

  it("shows <no agent.command set> when agent.command is empty", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).toContain("  detectedAgentType  = <no agent.command set>");
  });

  it("shows detected agent type when agent.command is set", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.agent.command = { value: "claude -p", source: "config" };
    input.config = rc;
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain("  detectedAgentType  = claude");
  });

  it("hides issue detail fields when issue.source is none", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).not.toContain("  issue.standaloneLabel");
    expect(output).not.toContain("  issue.subissueLabel");
    expect(output).not.toContain("  issue.prdLabel");
    expect(output).not.toContain("  issue.repo");
    expect(output).not.toContain("  issue.commentProgress");
    expect(output).not.toContain("  issue.hitlLabel");
  });

  it("shows issue detail fields when issue.source is github", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.issue.source = { value: "github", source: "config" };
    input.config = rc;
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  issue.standaloneLabel = ralphai-standalone  (default)",
    );
    expect(output).toContain(
      "  issue.subissueLabel = ralphai-subissue  (default)",
    );
    expect(output).toContain("  issue.prdLabel     = ralphai-prd  (default)");
    expect(output).toContain(
      "  issue.repo         = <auto-detect>  (default (auto-detect))",
    );
    expect(output).toContain("  issue.commentProgress = true  (default)");
    expect(output).toContain(
      "  issue.hitlLabel    = ralphai-subissue-hitl  (default)",
    );
  });

  // --- Source label tests ---

  it("shows config source with file path", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.baseBranch = { value: "develop", source: "config" };
    input.config = rc;
    input.configFilePath = "/home/user/.ralphai/repos/test-repo/config.json";
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  baseBranch         = develop  (config (/home/user/.ralphai/repos/test-repo/config.json))",
    );
  });

  it("shows cli source for gate.review --gate-no-review", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.gate.review = { value: false, source: "cli" };
    input.config = rc;
    input.rawFlags = { "gate.review": "--gate-no-review" };
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  gate.review        = false  (cli (--gate-no-review))",
    );
  });

  it("shows env source for gate.review", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.gate.review = { value: false, source: "env" };
    input.config = rc;
    input.envVars = { RALPHAI_GATE_REVIEW: "false" };
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  gate.review        = false  (env (RALPHAI_GATE_REVIEW=false))",
    );
  });

  it("shows cli source for prompt.verbose --prompt-verbose", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.prompt.verbose = { value: true, source: "cli" };
    input.config = rc;
    input.rawFlags = { "prompt.verbose": "--prompt-verbose" };
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  prompt.verbose     = true  (cli (--prompt-verbose))",
    );
  });

  it("shows env source for prompt.verbose", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.prompt.verbose = { value: true, source: "env" };
    input.config = rc;
    input.envVars = { RALPHAI_PROMPT_VERBOSE: "true" };
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  prompt.verbose     = true  (env (RALPHAI_PROMPT_VERBOSE=true))",
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
    expect(output).toContain("  packages/baz: prFeedbackCommands=none");
  });

  it("shows workspaces with prFeedbackCommands array", () => {
    const input = defaultInput();
    input.configFileExists = true;
    input.workspaces = {
      "packages/web": {
        prFeedbackCommands: ["bun test", "bun run lint"],
      },
    };
    const output = formatShowConfig(input);
    expect(output).toContain(
      "  packages/web: prFeedbackCommands=bun test, bun run lint",
    );
  });

  it("shows workspaces with prFeedbackCommands string", () => {
    const input = defaultInput();
    input.configFileExists = true;
    input.workspaces = {
      "packages/api": {
        prFeedbackCommands: "npm test",
      },
    };
    const output = formatShowConfig(input);
    expect(output).toContain("  packages/api: prFeedbackCommands=npm test");
  });

  // --- Auto-detected source label ---

  it("shows auto-detected source for sandbox when Docker detected", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.sandbox = { value: "docker", source: "auto-detected" };
    input.config = rc;
    const output = formatShowConfig(input);
    expect(output).toContain("  sandbox            = docker  (auto-detected)");
  });

  it("shows auto-detected source for sandbox when Docker not detected", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig();
    rc.sandbox = { value: "none", source: "auto-detected" };
    input.config = rc;
    const output = formatShowConfig(input);
    expect(output).toContain("  sandbox            = none  (auto-detected)");
  });
});
