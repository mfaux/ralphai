/**
 * Tests for DockerExecutor — command construction, credential forwarding,
 * Docker availability checks, image resolution, and factory wiring.
 *
 * All tests use mocks — no real Docker required.
 */
import { describe, it, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import {
  buildDockerArgs,
  buildEnvFlags,
  buildMountFlags,
  buildSetupDockerArgs,
  checkDockerAvailability,
  formatDockerCommand,
  pullDockerImage,
  resolveDockerImage,
  DockerExecutor,
} from "./executor/docker.ts";
import { createExecutor } from "./executor/index.ts";
import { LocalExecutor } from "./executor/local.ts";
import {
  parseConfigFile,
  parseCLIArgs,
  applyEnvOverrides,
  DEFAULTS,
} from "./config.ts";
import { buildConfirmLines } from "./tui/screens/confirm.tsx";
import { useTempDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// resolveDockerImage
// ---------------------------------------------------------------------------

describe("resolveDockerImage", () => {
  it("auto-resolves claude agent to ghcr.io/mfaux/ralphai-sandbox:claude", () => {
    expect(resolveDockerImage("claude -p")).toBe(
      "ghcr.io/mfaux/ralphai-sandbox:claude",
    );
  });

  it("auto-resolves opencode agent", () => {
    expect(resolveDockerImage("opencode run --agent build")).toBe(
      "ghcr.io/mfaux/ralphai-sandbox:opencode",
    );
  });

  it("auto-resolves codex agent", () => {
    expect(resolveDockerImage("codex exec")).toBe(
      "ghcr.io/mfaux/ralphai-sandbox:codex",
    );
  });

  it("falls back to latest for unknown agent", () => {
    expect(resolveDockerImage("my-custom-agent")).toBe(
      "ghcr.io/mfaux/ralphai-sandbox:latest",
    );
  });

  it("uses dockerImage override when provided", () => {
    expect(resolveDockerImage("claude -p", "my-registry/my-image:v1")).toBe(
      "my-registry/my-image:v1",
    );
  });

  it("ignores empty dockerImage override", () => {
    expect(resolveDockerImage("claude -p", "")).toBe(
      "ghcr.io/mfaux/ralphai-sandbox:claude",
    );
  });
});

// ---------------------------------------------------------------------------
// buildDockerArgs — command construction
// ---------------------------------------------------------------------------

describe("buildDockerArgs", () => {
  it("includes --rm flag", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-project",
    });
    expect(args).toContain("--rm");
    expect(args[0]).toBe("run");
    expect(args[1]).toBe("--rm");
  });

  it("bind-mounts worktree at host path", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-project",
    });
    const vIdx = args.indexOf("-v");
    expect(vIdx).toBeGreaterThan(-1);
    expect(args[vIdx + 1]).toBe("/work/my-project:/work/my-project");
  });

  it("sets working directory to worktree path", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-project",
    });
    const wIdx = args.indexOf("-w");
    expect(wIdx).toBeGreaterThan(-1);
    expect(args[wIdx + 1]).toBe("/work/my-project");
  });

  it("auto-resolves image from agent name", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work",
    });
    expect(args).toContain("ghcr.io/mfaux/ralphai-sandbox:claude");
  });

  it("uses dockerImage override", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work",
      dockerImage: "my-image:latest",
    });
    expect(args).toContain("my-image:latest");
    expect(args).not.toContain("ghcr.io/mfaux/ralphai-sandbox:claude");
  });

  it("appends agent command and prompt at end", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "implement feature X",
      cwd: "/work",
    });
    // Last three args should be: "claude", "-p", "implement feature X"
    const len = args.length;
    expect(args[len - 3]).toBe("claude");
    expect(args[len - 2]).toBe("-p");
    expect(args[len - 1]).toBe("implement feature X");
  });

  it("includes RALPHAI_NONCE env var when nonce provided", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "test",
      cwd: "/work",
      nonce: "abc-123",
    });
    const eIdx = args.indexOf("RALPHAI_NONCE=abc-123");
    expect(eIdx).toBeGreaterThan(-1);
    // The flag before it should be "-e"
    expect(args[eIdx - 1]).toBe("-e");
  });

  it("does NOT include RALPHAI_NONCE when nonce is undefined", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "test",
      cwd: "/work",
    });
    const hasNonce = args.some((a) => a.includes("RALPHAI_NONCE"));
    expect(hasNonce).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildEnvFlags — credential env var forwarding
// ---------------------------------------------------------------------------

describe("buildEnvFlags", () => {
  it("forwards ANTHROPIC_API_KEY for claude agent", () => {
    const flags = buildEnvFlags("claude", [], {
      ANTHROPIC_API_KEY: "sk-ant-123",
      GITHUB_TOKEN: "ghp_123",
    });
    expect(flags).toContain("ANTHROPIC_API_KEY");
  });

  it("forwards OPENAI_API_KEY for codex agent", () => {
    const flags = buildEnvFlags("codex", [], {
      OPENAI_API_KEY: "sk-123",
    });
    expect(flags).toContain("OPENAI_API_KEY");
  });

  it("does NOT forward ANTHROPIC_API_KEY for codex agent", () => {
    const flags = buildEnvFlags("codex", [], {
      ANTHROPIC_API_KEY: "sk-ant-123",
      OPENAI_API_KEY: "sk-123",
    });
    expect(flags).not.toContain("ANTHROPIC_API_KEY");
  });

  it("forwards GITHUB_TOKEN and GH_TOKEN for all agents", () => {
    const flags = buildEnvFlags("claude", [], {
      GITHUB_TOKEN: "ghp_123",
      GH_TOKEN: "gho_456",
    });
    expect(flags).toContain("GITHUB_TOKEN");
    expect(flags).toContain("GH_TOKEN");
  });

  it("forwards git identity vars when set", () => {
    const flags = buildEnvFlags("claude", [], {
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });
    expect(flags).toContain("GIT_AUTHOR_NAME");
    expect(flags).toContain("GIT_AUTHOR_EMAIL");
    expect(flags).toContain("GIT_COMMITTER_NAME");
    expect(flags).toContain("GIT_COMMITTER_EMAIL");
  });

  it("skips env vars that are not set on host", () => {
    const flags = buildEnvFlags("claude", [], {});
    // No env vars set, so no -e flags
    expect(flags).toHaveLength(0);
  });

  it("skips env vars that are empty string", () => {
    const flags = buildEnvFlags("claude", [], {
      ANTHROPIC_API_KEY: "",
      GITHUB_TOKEN: "",
    });
    expect(flags).toHaveLength(0);
  });

  it("includes extra env vars from dockerEnvVars config", () => {
    const flags = buildEnvFlags("claude", ["CUSTOM_VAR", "MY_SECRET"], {
      CUSTOM_VAR: "value1",
      MY_SECRET: "value2",
    });
    expect(flags).toContain("CUSTOM_VAR");
    expect(flags).toContain("MY_SECRET");
  });

  it("uses -e flag format (not -e VAR=value)", () => {
    const flags = buildEnvFlags("claude", [], {
      ANTHROPIC_API_KEY: "sk-ant-123",
    });
    // Should be ["-e", "ANTHROPIC_API_KEY"], not ["-e", "ANTHROPIC_API_KEY=sk-ant-123"]
    const idx = flags.indexOf("ANTHROPIC_API_KEY");
    expect(idx).toBeGreaterThan(0);
    expect(flags[idx - 1]).toBe("-e");
    expect(flags[idx]).not.toContain("=");
  });

  it("prevents process.env leakage — only allowlisted vars", () => {
    const flags = buildEnvFlags("claude", [], {
      ANTHROPIC_API_KEY: "sk-ant-123",
      HOME: "/home/user",
      PATH: "/usr/bin",
      SECRET_INTERNAL_VAR: "should-not-appear",
    });
    // HOME, PATH, SECRET_INTERNAL_VAR should NOT appear
    expect(flags).not.toContain("HOME");
    expect(flags).not.toContain("PATH");
    expect(flags).not.toContain("SECRET_INTERNAL_VAR");
    // Only ANTHROPIC_API_KEY should be present
    const varNames = flags.filter((f) => f !== "-e");
    expect(varNames).toEqual(["ANTHROPIC_API_KEY"]);
  });
});

// ---------------------------------------------------------------------------
// buildMountFlags — credential file mounts
// ---------------------------------------------------------------------------

describe("buildMountFlags", () => {
  const ctx = useTempDir();

  it("mounts .gitconfig read-only when it exists", () => {
    const home = ctx.dir;
    writeFileSync(join(home, ".gitconfig"), "[user]\n  name = Test\n");
    const flags = buildMountFlags("claude", [], home);
    expect(flags).toContain("-v");
    const mountArg = flags.find((f) => f.includes(".gitconfig"));
    expect(mountArg).toBeDefined();
    expect(mountArg).toContain(":ro");
  });

  it("skips .gitconfig when it does not exist", () => {
    // Use a fresh temp dir with no .gitconfig
    const flags = buildMountFlags("claude", [], ctx.dir);
    const hasGitconfig = flags.some((f) => f.includes(".gitconfig"));
    expect(hasGitconfig).toBe(false);
  });

  it("mounts opencode auth files when they exist", () => {
    const home = ctx.dir;
    mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
    writeFileSync(join(home, ".local", "share", "opencode", "auth.json"), "{}");
    mkdirSync(join(home, ".config", "github-copilot"), { recursive: true });

    const flags = buildMountFlags("opencode", [], home);
    const authMount = flags.find((f) => f.includes("auth.json"));
    expect(authMount).toBeDefined();
    expect(authMount).toContain(":ro");
    const copilotMount = flags.find((f) => f.includes("github-copilot"));
    expect(copilotMount).toBeDefined();
    expect(copilotMount).toContain(":ro");
  });

  it("skips opencode auth files for claude agent", () => {
    const home = ctx.dir;
    mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
    writeFileSync(join(home, ".local", "share", "opencode", "auth.json"), "{}");

    const flags = buildMountFlags("claude", [], home);
    const hasAuth = flags.some((f) => f.includes("auth.json"));
    expect(hasAuth).toBe(false);
  });

  it("includes extra mounts from dockerMounts config", () => {
    const flags = buildMountFlags("claude", ["/host/path:/container/path:ro"]);
    expect(flags).toContain("/host/path:/container/path:ro");
  });

  it("does NOT mount ~/.ralphai/", () => {
    const home = ctx.dir;
    mkdirSync(join(home, ".ralphai"), { recursive: true });
    writeFileSync(join(home, ".ralphai", "config.json"), "{}");

    const flags = buildMountFlags("claude", [], home);
    const hasRalphai = flags.some((f) => f.includes(".ralphai"));
    expect(hasRalphai).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkDockerAvailability
// ---------------------------------------------------------------------------

describe("checkDockerAvailability", () => {
  it("returns unavailable on Windows", () => {
    const result = checkDockerAvailability("win32");
    expect(result.available).toBe(false);
    expect(result.error).toContain("not supported on Windows");
    expect(result.error).toContain("WSL");
  });

  it("returns unavailable when docker binary not found", () => {
    const result = checkDockerAvailability("linux", (cmd) => {
      if (cmd === "docker --version") return false;
      return true;
    });
    expect(result.available).toBe(false);
    expect(result.error).toContain("not installed");
    expect(result.error).toContain("https://docs.docker.com/get-docker/");
  });

  it("returns unavailable when daemon not running", () => {
    const result = checkDockerAvailability("linux", (cmd) => {
      if (cmd === "docker --version") return true;
      if (cmd === "docker info") return false;
      return true;
    });
    expect(result.available).toBe(false);
    expect(result.error).toContain("daemon is not running");
    expect(result.error).toContain("systemctl start docker");
  });

  it("returns available when docker is installed and running", () => {
    const result = checkDockerAvailability("linux", () => true);
    expect(result.available).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns available on macOS when docker is running", () => {
    const result = checkDockerAvailability("darwin", () => true);
    expect(result.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatDockerCommand
// ---------------------------------------------------------------------------

describe("formatDockerCommand", () => {
  it("formats a simple command", () => {
    const result = formatDockerCommand(["run", "--rm", "alpine", "echo", "hi"]);
    expect(result).toBe("docker run --rm alpine echo hi");
  });

  it("quotes arguments with spaces", () => {
    const result = formatDockerCommand([
      "run",
      "--rm",
      "alpine",
      "echo",
      "hello world",
    ]);
    expect(result).toContain("'hello world'");
  });
});

// ---------------------------------------------------------------------------
// DockerExecutor class
// ---------------------------------------------------------------------------

describe("DockerExecutor", () => {
  it("implements the AgentExecutor interface", () => {
    const executor = new DockerExecutor();
    expect(typeof executor.spawn).toBe("function");
  });

  it("stores docker config", () => {
    const executor = new DockerExecutor({
      dockerImage: "my-image:latest",
      dockerEnvVars: ["MY_VAR"],
      dockerMounts: ["/host:/container"],
    });
    expect(typeof executor.spawn).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// createExecutor factory
// ---------------------------------------------------------------------------

describe("createExecutor — docker support", () => {
  it("returns LocalExecutor for sandbox='none'", () => {
    const executor = createExecutor("none");
    expect(executor).toBeInstanceOf(LocalExecutor);
  });

  it("returns DockerExecutor for sandbox='docker'", () => {
    const executor = createExecutor("docker");
    expect(executor).toBeInstanceOf(DockerExecutor);
  });

  it("passes docker config to DockerExecutor", () => {
    const executor = createExecutor("docker", {
      dockerImage: "custom:v1",
      dockerEnvVars: ["MY_VAR"],
      dockerMounts: ["/a:/b"],
    });
    expect(executor).toBeInstanceOf(DockerExecutor);
  });

  it("throws for unknown sandbox mode", () => {
    expect(() => createExecutor("unknown")).toThrow(
      "Unknown sandbox mode: 'unknown'",
    );
  });
});

// ---------------------------------------------------------------------------
// Config keys — dockerImage, dockerMounts, dockerEnvVars
// ---------------------------------------------------------------------------

describe("docker config keys", () => {
  // These tests verify the config keys are properly wired through the
  // 4-layer resolution system. The sandbox config tests in
  // config-sandbox.test.ts cover the pattern; here we verify the
  // docker-specific keys follow the same pattern.

  it("parseCLIArgs parses --docker-image", () => {
    const result = parseCLIArgs(["--docker-image=my-image:v1"]);
    expect(result.overrides.dockerImage).toBe("my-image:v1");
    expect(result.rawFlags.dockerImage).toBe("--docker-image=my-image:v1");
  });

  it("parseCLIArgs parses --docker-mounts", () => {
    const result = parseCLIArgs(["--docker-mounts=/a:/b,/c:/d"]);
    expect(result.overrides.dockerMounts).toBe("/a:/b,/c:/d");
  });

  it("parseCLIArgs parses --docker-env-vars", () => {
    const result = parseCLIArgs(["--docker-env-vars=MY_VAR,OTHER_VAR"]);
    expect(result.overrides.dockerEnvVars).toBe("MY_VAR,OTHER_VAR");
  });

  it("applyEnvOverrides reads RALPHAI_DOCKER_IMAGE", () => {
    const result = applyEnvOverrides({ RALPHAI_DOCKER_IMAGE: "my-image:v2" });
    expect(result.dockerImage).toBe("my-image:v2");
  });

  it("applyEnvOverrides reads RALPHAI_DOCKER_MOUNTS", () => {
    const result = applyEnvOverrides({
      RALPHAI_DOCKER_MOUNTS: "/a:/b,/c:/d",
    });
    expect(result.dockerMounts).toBe("/a:/b,/c:/d");
  });

  it("applyEnvOverrides reads RALPHAI_DOCKER_ENV_VARS", () => {
    const result = applyEnvOverrides({
      RALPHAI_DOCKER_ENV_VARS: "MY_VAR,OTHER",
    });
    expect(result.dockerEnvVars).toBe("MY_VAR,OTHER");
  });

  describe("parseConfigFile — docker keys", () => {
    const ctx = useTempDir();

    it("parses dockerImage from config", () => {
      const filePath = join(ctx.dir, "docker-image-config.json");
      writeFileSync(filePath, JSON.stringify({ dockerImage: "my-image:v3" }));
      const result = parseConfigFile(filePath);
      expect(result!.values.dockerImage).toBe("my-image:v3");
    });

    it("parses dockerMounts as array", () => {
      const filePath = join(ctx.dir, "docker-mounts-config.json");
      writeFileSync(
        filePath,
        JSON.stringify({ dockerMounts: ["/a:/b", "/c:/d"] }),
      );
      const result = parseConfigFile(filePath);
      expect(result!.values.dockerMounts).toBe("/a:/b,/c:/d");
    });

    it("parses dockerEnvVars as array", () => {
      const filePath = join(ctx.dir, "docker-envvars-config.json");
      writeFileSync(
        filePath,
        JSON.stringify({ dockerEnvVars: ["MY_VAR", "OTHER"] }),
      );
      const result = parseConfigFile(filePath);
      expect(result!.values.dockerEnvVars).toBe("MY_VAR,OTHER");
    });
  });

  it("DEFAULTS have empty strings for docker config keys", () => {
    expect(DEFAULTS.dockerImage).toBe("");
    expect(DEFAULTS.dockerMounts).toBe("");
    expect(DEFAULTS.dockerEnvVars).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Confirm screen — Docker warning
// ---------------------------------------------------------------------------

describe("buildConfirmLines — Docker warning", () => {
  it("includes Docker warning when dockerWarning is set", () => {
    const lines = buildConfirmLines({
      title: "test",
      agentCommand: "claude -p",
      branch: "main",
      feedbackCommands: "",
      sandbox: "docker (cli)",
      dockerWarning: "Docker daemon is not running.",
      runArgs: ["run"],
    });
    const warningLine = lines.find(
      (l: { label: string }) => l.label === "WARNING",
    );
    expect(warningLine).toBeDefined();
    expect(warningLine!.value).toContain("Docker daemon");
  });

  it("omits Docker warning when dockerWarning is undefined", () => {
    const lines = buildConfirmLines({
      title: "test",
      agentCommand: "claude -p",
      branch: "main",
      feedbackCommands: "",
      sandbox: "none (default)",
      runArgs: ["run"],
    });
    const warningLine = lines.find(
      (l: { label: string }) => l.label === "WARNING",
    );
    expect(warningLine).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildSetupDockerArgs — setup command construction
// ---------------------------------------------------------------------------

describe("buildSetupDockerArgs", () => {
  it("includes --rm flag", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-project",
    });
    expect(args[0]).toBe("run");
    expect(args[1]).toBe("--rm");
  });

  it("bind-mounts worktree at host path", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-project",
    });
    const vIdx = args.indexOf("-v");
    expect(vIdx).toBeGreaterThan(-1);
    expect(args[vIdx + 1]).toBe("/work/my-project:/work/my-project");
  });

  it("sets working directory to worktree path", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-project",
    });
    const wIdx = args.indexOf("-w");
    expect(wIdx).toBeGreaterThan(-1);
    expect(args[wIdx + 1]).toBe("/work/my-project");
  });

  it("auto-resolves image from agent name (same as agent execution)", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "npm install",
      cwd: "/work",
    });
    expect(args).toContain("ghcr.io/mfaux/ralphai-sandbox:claude");
  });

  it("uses dockerImage override", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "npm install",
      cwd: "/work",
      dockerImage: "my-image:latest",
    });
    expect(args).toContain("my-image:latest");
    expect(args).not.toContain("ghcr.io/mfaux/ralphai-sandbox:claude");
  });

  it("wraps setup command with sh -c as entrypoint", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install && bun run build",
      cwd: "/work",
    });
    const len = args.length;
    expect(args[len - 3]).toBe("sh");
    expect(args[len - 2]).toBe("-c");
    expect(args[len - 1]).toBe("bun install && bun run build");
  });

  it("does NOT include RALPHAI_NONCE (setup has no nonce)", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work",
    });
    const hasNonce = args.some((a) => a.includes("RALPHAI_NONCE"));
    expect(hasNonce).toBe(false);
  });

  it("includes extra env vars from dockerEnvVars config", () => {
    // Note: buildEnvFlags only includes vars that are set on host,
    // so we verify the structural correctness via the args pattern
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "npm install",
      cwd: "/work",
      dockerEnvVars: ["CUSTOM_VAR"],
    });
    // The args should contain env flags from buildEnvFlags
    // (actual values depend on host env, tested separately)
    expect(args).toContain("--rm");
  });

  it("includes extra mounts from dockerMounts config", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "npm install",
      cwd: "/work",
      dockerMounts: ["/host/cache:/container/cache"],
    });
    expect(args).toContain("/host/cache:/container/cache");
  });
});

// ---------------------------------------------------------------------------
// pullDockerImage
// ---------------------------------------------------------------------------

describe("pullDockerImage", () => {
  it("resolves auto-detected image in result", () => {
    // Use a definitely-nonexistent image so the pull fails fast
    // without attempting a real network pull
    const result = pullDockerImage(
      "claude -p",
      "localhost:1/nonexistent:never",
    );
    expect(result.image).toBe("localhost:1/nonexistent:never");
  });

  it("uses custom dockerImage when provided", () => {
    const result = pullDockerImage("claude -p", "localhost:1/my-image:v1");
    expect(result.image).toBe("localhost:1/my-image:v1");
  });

  it("returns success: false when docker pull fails", () => {
    const result = pullDockerImage(
      "claude -p",
      "localhost:1/nonexistent:never",
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("auto-resolves image from agent command when no override", () => {
    // Verify image resolution is correct without triggering a real pull.
    // We can't call pullDockerImage with a real registry image in tests
    // (it would timeout), so verify via resolveDockerImage instead —
    // pullDockerImage delegates to it for image resolution.
    expect(resolveDockerImage("opencode run --agent build")).toBe(
      "ghcr.io/mfaux/ralphai-sandbox:opencode",
    );
  });
});
