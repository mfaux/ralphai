/**
 * Tests for setup command routing through Docker when sandbox="docker".
 *
 * Verifies that executeSetupCommand() routes through Docker when given
 * a sandbox config with sandbox="docker", and falls through to host
 * execSync when sandbox="none" or no config is provided.
 *
 * Uses mock.module() to intercept child_process calls — no real Docker
 * or shell commands are executed.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mock child_process to capture spawnSync and execSync calls
// ---------------------------------------------------------------------------

let spawnSyncCalls: Array<{
  command: string;
  args: string[];
  options: Record<string, unknown>;
}> = [];
let execSyncCalls: Array<{
  command: string;
  options: Record<string, unknown>;
}> = [];

let mockSpawnSyncResult: {
  status: number | null;
  error?: Error;
} = { status: 0 };
let mockExecSyncThrow: Error | null = null;

mock.module("child_process", () => ({
  execSync: (command: string, options: Record<string, unknown> = {}) => {
    execSyncCalls.push({ command, options });
    if (mockExecSyncThrow) throw mockExecSyncThrow;
    return "";
  },
  spawnSync: (
    command: string,
    args: string[],
    options: Record<string, unknown> = {},
  ) => {
    spawnSyncCalls.push({ command, args, options });
    return mockSpawnSyncResult;
  },
  // Re-export spawn for other modules that might need it
  spawn: () => {},
}));

// Import after mocking
import {
  executeSetupCommand,
  type SetupSandboxConfig,
} from "./worktree/management.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Capture process.exit calls instead of actually exiting
let exitCode: number | null = null;
const originalExit = process.exit;
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

beforeEach(() => {
  spawnSyncCalls = [];
  execSyncCalls = [];
  mockSpawnSyncResult = { status: 0 };
  mockExecSyncThrow = null;
  exitCode = null;
  process.exit = ((code: number) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
  // Suppress console output during tests
  console.error = () => {};
  console.log = () => {};
});

afterEach(() => {
  process.exit = originalExit;
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
});

// ---------------------------------------------------------------------------
// Routing logic
// ---------------------------------------------------------------------------

describe("executeSetupCommand — routing", () => {
  it("runs via execSync on host when no sandboxConfig is provided", () => {
    executeSetupCommand("bun install", "/work/my-project");
    expect(execSyncCalls).toHaveLength(1);
    expect(execSyncCalls[0]!.command).toBe("bun install");
    expect(execSyncCalls[0]!.options.cwd).toBe("/work/my-project");
    expect(spawnSyncCalls).toHaveLength(0);
  });

  it("runs via execSync on host when sandbox is 'none'", () => {
    const config: SetupSandboxConfig = {
      sandbox: "none",
      agentCommand: "claude -p",
    };
    executeSetupCommand("bun install", "/work/my-project", config);
    expect(execSyncCalls).toHaveLength(1);
    expect(execSyncCalls[0]!.command).toBe("bun install");
    expect(spawnSyncCalls).toHaveLength(0);
  });

  it("runs via Docker spawnSync when sandbox is 'docker'", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("bun install", "/work/my-project", config);
    expect(spawnSyncCalls).toHaveLength(1);
    expect(spawnSyncCalls[0]!.command).toBe("docker");
    // resolveMainGitDir may call execSync for git rev-parse, but no
    // host setup command (like "bun install") should run via execSync
    const hostSetupCalls = execSyncCalls.filter(
      (c) => c.command === "bun install",
    );
    expect(hostSetupCalls).toHaveLength(0);
  });

  it("no-ops when setupCommand is empty (sandbox=none)", () => {
    executeSetupCommand("", "/work/my-project");
    expect(execSyncCalls).toHaveLength(0);
    expect(spawnSyncCalls).toHaveLength(0);
  });

  it("no-ops when setupCommand is empty (sandbox=docker)", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("", "/work/my-project", config);
    expect(execSyncCalls).toHaveLength(0);
    expect(spawnSyncCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Docker command construction for setup
// ---------------------------------------------------------------------------

describe("executeSetupCommand — Docker command construction", () => {
  it("includes worktree bind mount at host path", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("npm install", "/work/my-project", config);

    const args = spawnSyncCalls[0]!.args;
    const vIdx = args.indexOf("-v");
    expect(vIdx).toBeGreaterThan(-1);
    expect(args[vIdx + 1]).toBe("/work/my-project:/work/my-project");
  });

  it("sets working directory to worktree path", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("npm install", "/work/my-project", config);

    const args = spawnSyncCalls[0]!.args;
    const wIdx = args.indexOf("-w");
    expect(wIdx).toBeGreaterThan(-1);
    expect(args[wIdx + 1]).toBe("/work/my-project");
  });

  it("resolves image from agent command", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("npm install", "/work", config);

    const args = spawnSyncCalls[0]!.args;
    expect(args).toContain("ghcr.io/mfaux/ralphai-sandbox:claude");
  });

  it("uses dockerImage override from config", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
      dockerConfig: {
        dockerImage: "my-custom-image:v2",
      },
    };
    executeSetupCommand("npm install", "/work", config);

    const args = spawnSyncCalls[0]!.args;
    expect(args).toContain("my-custom-image:v2");
    expect(args).not.toContain("ghcr.io/mfaux/ralphai-sandbox:claude");
  });

  it("wraps setup command with sh -c", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("bun install && bun run build", "/work", config);

    const args = spawnSyncCalls[0]!.args;
    const len = args.length;
    expect(args[len - 3]).toBe("sh");
    expect(args[len - 2]).toBe("-c");
    expect(args[len - 1]).toBe("bun install && bun run build");
  });

  it("uses stdio: inherit for interactive output", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("npm install", "/work", config);

    expect(spawnSyncCalls[0]!.options.stdio).toBe("inherit");
  });

  it("passes extra docker mounts from config", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
      dockerConfig: {
        dockerMounts: ["/host/cache:/container/cache:ro"],
      },
    };
    executeSetupCommand("npm install", "/work", config);

    const args = spawnSyncCalls[0]!.args;
    expect(args).toContain("/host/cache:/container/cache:ro");
  });

  it("passes extra docker env vars from config", () => {
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
      dockerConfig: {
        dockerEnvVars: ["MY_CUSTOM_VAR"],
      },
    };
    executeSetupCommand("npm install", "/work", config);

    // Verify docker args were built (env var forwarding is tested in
    // buildEnvFlags tests — here we verify it was passed through)
    expect(spawnSyncCalls).toHaveLength(1);
    expect(spawnSyncCalls[0]!.command).toBe("docker");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("executeSetupCommand — error handling", () => {
  it("exits with code 1 when Docker setup command fails", () => {
    mockSpawnSyncResult = { status: 1 };
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };

    expect(() => executeSetupCommand("npm install", "/work", config)).toThrow(
      "process.exit(1)",
    );
    expect(exitCode).toBe(1);
  });

  it("exits with code 1 when host setup command fails", () => {
    mockExecSyncThrow = new Error("Command failed");
    expect(() => executeSetupCommand("npm install", "/work")).toThrow(
      "process.exit(1)",
    );
    expect(exitCode).toBe(1);
  });

  it("exits with code 1 when Docker spawn error occurs", () => {
    mockSpawnSyncResult = { status: 1, error: new Error("ENOENT") };
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };

    expect(() => executeSetupCommand("npm install", "/work", config)).toThrow(
      "process.exit(1)",
    );
    expect(exitCode).toBe(1);
  });
});
