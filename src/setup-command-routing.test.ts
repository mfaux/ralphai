/**
 * Tests for setup command routing through Docker when sandbox="docker".
 *
 * Verifies that executeSetupCommand() routes through Docker when given
 * a sandbox config with sandbox="docker", and falls through to host
 * exec when sandbox="none" or no config is provided.
 *
 * Uses setExecImpl() to intercept all subprocess calls — no real Docker
 * or shell commands are executed.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { setExecImpl } from "./exec.ts";
import {
  executeSetupCommand,
  type SetupSandboxConfig,
} from "./worktree/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let execCalls: Array<{
  command: string;
  options: Record<string, unknown>;
}> = [];

let restore: () => void;
let exitCode: number | null = null;
const originalExit = process.exit;
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

/** Default mock that succeeds and records calls. */
function mockExecSuccess() {
  return setExecImpl(((command: string, options: Record<string, unknown>) => {
    execCalls.push({ command, options });
    return "";
  }) as any);
}

/** Mock that throws for specific commands (simulating failure). */
function mockExecFail(failCmd?: string | RegExp) {
  return setExecImpl(((command: string, options: Record<string, unknown>) => {
    execCalls.push({ command, options });
    if (!failCmd) {
      const err = new Error("Command failed");
      (err as any).status = 1;
      throw err;
    }
    const matches =
      failCmd instanceof RegExp ? failCmd.test(command) : command === failCmd;
    if (matches) {
      const err = new Error("Command failed");
      (err as any).status = 1;
      throw err;
    }
    return "";
  }) as any);
}

beforeEach(() => {
  execCalls = [];
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
  if (restore) restore();
  process.exit = originalExit;
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
});

// ---------------------------------------------------------------------------
// Routing logic
// ---------------------------------------------------------------------------

describe("executeSetupCommand — routing", () => {
  it("runs setup command on host when no sandboxConfig is provided", () => {
    restore = mockExecSuccess();
    executeSetupCommand("bun install", "/work/my-project");

    // Should have exactly one call: the setup command itself
    const setupCalls = execCalls.filter((c) =>
      c.command.includes("bun install"),
    );
    expect(setupCalls).toHaveLength(1);
    expect(setupCalls[0]!.options.cwd).toBe("/work/my-project");
    // Should NOT route through docker
    const dockerCalls = execCalls.filter((c) => c.command.startsWith("docker"));
    expect(dockerCalls).toHaveLength(0);
  });

  it("runs setup command on host when sandbox is 'none'", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "none",
      agentCommand: "claude -p",
    };
    executeSetupCommand("bun install", "/work/my-project", config);

    const setupCalls = execCalls.filter((c) =>
      c.command.includes("bun install"),
    );
    expect(setupCalls).toHaveLength(1);
    const dockerCalls = execCalls.filter((c) => c.command.startsWith("docker"));
    expect(dockerCalls).toHaveLength(0);
  });

  it("routes through Docker when sandbox is 'docker'", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("bun install", "/work/my-project", config);

    // Should include a docker command
    const dockerCalls = execCalls.filter((c) => c.command.startsWith("docker"));
    expect(dockerCalls).toHaveLength(1);
    // Should NOT have a direct host "bun install" call
    const directSetupCalls = execCalls.filter(
      (c) => c.command === "bun install",
    );
    expect(directSetupCalls).toHaveLength(0);
  });

  it("no-ops when setupCommand is empty (sandbox=none)", () => {
    restore = mockExecSuccess();
    executeSetupCommand("", "/work/my-project");
    expect(execCalls).toHaveLength(0);
  });

  it("no-ops when setupCommand is empty (sandbox=docker)", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("", "/work/my-project", config);
    expect(execCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Docker command construction for setup
// ---------------------------------------------------------------------------

describe("executeSetupCommand — Docker command construction", () => {
  it("includes worktree bind mount at host path", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("npm install", "/work/my-project", config);

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    expect(dockerCall).toBeDefined();
    expect(dockerCall!.command).toContain("/work/my-project:/work/my-project");
  });

  it("sets working directory to worktree path", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("npm install", "/work/my-project", config);

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    expect(dockerCall!.command).toContain("-w /work/my-project");
  });

  it("resolves image from agent command", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("npm install", "/work", config);

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    expect(dockerCall!.command).toContain(
      "ghcr.io/mfaux/ralphai-sandbox:claude",
    );
  });

  it("uses dockerImage override from config", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
      dockerConfig: {
        dockerImage: "my-custom-image:v2",
      },
    };
    executeSetupCommand("npm install", "/work", config);

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    expect(dockerCall!.command).toContain("my-custom-image:v2");
    expect(dockerCall!.command).not.toContain(
      "ghcr.io/mfaux/ralphai-sandbox:claude",
    );
  });

  it("wraps setup command with sh -c", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("bun install && bun run build", "/work", config);

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    // sh -c is in the command string; the setup command may be quoted
    expect(dockerCall!.command).toContain("sh -c");
    expect(dockerCall!.command).toContain("bun install && bun run build");
  });

  it("passes extra docker mounts from config", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
      dockerConfig: {
        dockerMounts: ["/host/cache:/container/cache:ro"],
      },
    };
    executeSetupCommand("npm install", "/work", config);

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    expect(dockerCall!.command).toContain("/host/cache:/container/cache:ro");
  });

  it("passes extra docker env vars from config", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
      dockerConfig: {
        dockerEnvVars: ["MY_CUSTOM_VAR"],
      },
    };
    executeSetupCommand("npm install", "/work", config);

    // Verify docker command was built
    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    expect(dockerCall).toBeDefined();
  });

  it("mounts main git dir when mainGitDir is provided", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
      mainGitDir: "/work/main-repo/.git",
    };
    executeSetupCommand(
      "bun install",
      "/work/.ralphai-worktrees/my-plan",
      config,
    );

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    expect(dockerCall!.command).toContain(
      "/work/main-repo/.git:/work/main-repo/.git",
    );
  });

  it("does NOT add main git dir mount when mainGitDir is absent", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("bun install", "/work/my-project", config);

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    // The docker command should have the worktree mount but not a .git mount.
    // resolveMainGitDir calls execQuiet which returns "" (not a worktree),
    // so no main git dir mount is added.
    expect(dockerCall!.command).toContain("/work/my-project:/work/my-project");
    // The key assertion is no .git mount (credential mounts may exist).
    expect(dockerCall!.command).not.toContain("/.git:");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("executeSetupCommand — error handling", () => {
  it("exits with code 1 when Docker setup command fails", () => {
    restore = mockExecFail(/^docker/);
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
    restore = mockExecFail();
    expect(() => executeSetupCommand("npm install", "/work")).toThrow(
      "process.exit(1)",
    );
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HUSKY suppression
// ---------------------------------------------------------------------------

describe("executeSetupCommand — HUSKY suppression", () => {
  it("sets HUSKY=0 in process.env during host setup execution", () => {
    let capturedHusky: string | undefined;
    restore = setExecImpl(((
      command: string,
      options: Record<string, unknown>,
    ) => {
      execCalls.push({ command, options });
      capturedHusky = process.env.HUSKY;
      return "";
    }) as any);

    executeSetupCommand("bun install", "/work/my-project");

    expect(capturedHusky).toBe("0");
  });

  it("restores original HUSKY value after successful host setup", () => {
    const originalHusky = process.env.HUSKY;
    process.env.HUSKY = "original-value";
    restore = mockExecSuccess();

    executeSetupCommand("bun install", "/work/my-project");

    expect(process.env.HUSKY).toBe("original-value");
    // Clean up
    if (originalHusky === undefined) {
      delete process.env.HUSKY;
    } else {
      process.env.HUSKY = originalHusky;
    }
  });

  it("restores original HUSKY value after failed host setup", () => {
    const originalHusky = process.env.HUSKY;
    process.env.HUSKY = "original-value";
    restore = mockExecFail();

    expect(() => executeSetupCommand("bun install", "/work")).toThrow(
      "process.exit(1)",
    );

    expect(process.env.HUSKY).toBe("original-value");
    // Clean up
    if (originalHusky === undefined) {
      delete process.env.HUSKY;
    } else {
      process.env.HUSKY = originalHusky;
    }
  });

  it("deletes HUSKY from process.env after host setup when it was not previously set", () => {
    const originalHusky = process.env.HUSKY;
    delete process.env.HUSKY;
    restore = mockExecSuccess();

    executeSetupCommand("bun install", "/work/my-project");

    expect(process.env.HUSKY).toBeUndefined();
    // Clean up
    if (originalHusky !== undefined) {
      process.env.HUSKY = originalHusky;
    }
  });

  it("includes HUSKY=0 in Docker setup command args", () => {
    restore = mockExecSuccess();
    const config: SetupSandboxConfig = {
      sandbox: "docker",
      agentCommand: "claude -p",
    };
    executeSetupCommand("bun install", "/work/my-project", config);

    const dockerCall = execCalls.find((c) => c.command.startsWith("docker"));
    expect(dockerCall).toBeDefined();
    expect(dockerCall!.command).toContain("HUSKY=0");
  });
});
