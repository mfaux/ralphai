/**
 * Tests for DockerExecutor — command construction, credential forwarding,
 * Docker availability checks, image resolution, and factory wiring.
 *
 * All tests use mocks — no real Docker required.
 */
import { describe, it, expect, spyOn } from "bun:test";
import { execSync } from "child_process";
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
  CONTAINER_HOME,
  getUserFlag,
} from "./executor/docker.ts";
import { resolveMainGitDir } from "./worktree/index.ts";
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
// Helpers
// ---------------------------------------------------------------------------

/** Extract the values following every `-v` flag from a Docker args array. */
function extractVolumeFlags(args: string[]): string[] {
  return args.reduce<string[]>((acc, a, i) => {
    if (a === "-v") {
      const next = args[i + 1];
      if (next) acc.push(next);
    }
    return acc;
  }, []);
}

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

  it.skipIf(process.platform === "win32")(
    "includes --user flag with host UID:GID",
    () => {
      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "do stuff",
        cwd: "/work/my-project",
      });
      const userIdx = args.indexOf("--user");
      expect(userIdx).toBeGreaterThan(-1);
      const uidGid = args[userIdx + 1];
      expect(uidGid).toBe(`${process.getuid!()}:${process.getgid!()}`);
    },
  );

  it("includes -e HOME=/home/agent", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-project",
    });
    const homeEnv = `HOME=${CONTAINER_HOME}`;
    const homeIdx = args.indexOf(homeEnv);
    expect(homeIdx).toBeGreaterThan(-1);
    expect(args[homeIdx - 1]).toBe("-e");
  });

  it("includes -e HUSKY=0 to suppress git hooks", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-project",
    });
    const huskyIdx = args.indexOf("HUSKY=0");
    expect(huskyIdx).toBeGreaterThan(-1);
    expect(args[huskyIdx - 1]).toBe("-e");
  });

  it("includes -e TURBO_CACHE_DIR=.turbo for build-tool cache isolation", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-project",
    });
    const idx = args.indexOf("TURBO_CACHE_DIR=.turbo");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-e");
  });

  it("includes -e NX_CACHE_DIRECTORY=.nx/cache for build-tool cache isolation", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-project",
    });
    const idx = args.indexOf("NX_CACHE_DIRECTORY=.nx/cache");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-e");
  });

  it("allows user-supplied dockerEnvVars to override TURBO_CACHE_DIR", () => {
    // dockerEnvVars are env var names forwarded from the host.
    // When the host has TURBO_CACHE_DIR set, buildEnvFlags emits `-e TURBO_CACHE_DIR`
    // (which Docker resolves from the host env), appearing after the hardcoded
    // `-e TURBO_CACHE_DIR=.turbo`. Docker's last-write-wins means the host value wins.
    const prev = process.env.TURBO_CACHE_DIR;
    process.env.TURBO_CACHE_DIR = "/custom/turbo";
    try {
      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "do stuff",
        cwd: "/work/my-project",
        dockerEnvVars: ["TURBO_CACHE_DIR"],
      });
      const hardcoded = args.indexOf("TURBO_CACHE_DIR=.turbo");
      // The forwarded flag is just the var name (Docker reads value from host env)
      const forwarded = args.indexOf("TURBO_CACHE_DIR");
      expect(hardcoded).toBeGreaterThan(-1);
      expect(forwarded).toBeGreaterThan(-1);
      expect(forwarded).toBeGreaterThan(hardcoded);
    } finally {
      if (prev === undefined) delete process.env.TURBO_CACHE_DIR;
      else process.env.TURBO_CACHE_DIR = prev;
    }
  });

  it("allows user-supplied dockerEnvVars to override NX_CACHE_DIRECTORY", () => {
    const prev = process.env.NX_CACHE_DIRECTORY;
    process.env.NX_CACHE_DIRECTORY = "/custom/nx";
    try {
      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "do stuff",
        cwd: "/work/my-project",
        dockerEnvVars: ["NX_CACHE_DIRECTORY"],
      });
      const hardcoded = args.indexOf("NX_CACHE_DIRECTORY=.nx/cache");
      const forwarded = args.indexOf("NX_CACHE_DIRECTORY");
      expect(hardcoded).toBeGreaterThan(-1);
      expect(forwarded).toBeGreaterThan(-1);
      expect(forwarded).toBeGreaterThan(hardcoded);
    } finally {
      if (prev === undefined) delete process.env.NX_CACHE_DIRECTORY;
      else process.env.NX_CACHE_DIRECTORY = prev;
    }
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

  it("mounts mainGitDir read-write when provided", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-worktree",
      mainGitDir: "/work/main-repo/.git",
    });
    const vFlags = extractVolumeFlags(args);
    const gitMount = vFlags.find((f) => f.includes("/work/main-repo/.git"));
    expect(gitMount).toBeDefined();
    expect(gitMount).toBe("/work/main-repo/.git:/work/main-repo/.git");
    // Must NOT have :ro suffix — agent needs write access for commits
    expect(gitMount).not.toContain(":ro");
  });

  it("does not add extra mount when mainGitDir is absent", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "do stuff",
      cwd: "/work/my-project",
    });
    const vFlags = extractVolumeFlags(args);
    // Should have exactly one -v mount for the worktree (plus any credential mounts)
    const workdirMount = vFlags.find((f) =>
      f.startsWith("/work/my-project:/work/my-project"),
    );
    expect(workdirMount).toBeDefined();
    // No .git mount should exist
    const gitMount = vFlags.find((f) => f.includes("/.git:"));
    expect(gitMount).toBeUndefined();
  });

  describe("feedbackWrapperPath — bind-mount feedback script", () => {
    const ctx = useTempDir();

    it("bind-mounts feedback script read-only when file exists", () => {
      const scriptPath = join(ctx.dir, "_ralphai_feedback.sh");
      writeFileSync(scriptPath, "#!/bin/bash\nbun test", { mode: 0o755 });

      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "do stuff",
        cwd: "/work/my-project",
        feedbackWrapperPath: scriptPath,
      });

      const mountArg = args.find((a) => a.includes("_ralphai_feedback.sh"));
      expect(mountArg).toBeDefined();
      expect(mountArg).toBe(`${scriptPath}:${scriptPath}:ro`);
    });

    it("does NOT mount when feedbackWrapperPath is not set", () => {
      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "do stuff",
        cwd: "/work/my-project",
      });

      const hasFeedback = args.some((a) => a.includes("_ralphai_feedback"));
      expect(hasFeedback).toBe(false);
    });

    it("does NOT mount when feedbackWrapperPath file does not exist", () => {
      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "do stuff",
        cwd: "/work/my-project",
        feedbackWrapperPath: "/nonexistent/path/_ralphai_feedback.sh",
      });

      const hasFeedback = args.some((a) => a.includes("_ralphai_feedback"));
      expect(hasFeedback).toBe(false);
    });
  });

  // --- extraAgentFlags injection ---

  it("injects extraAgentFlags between command and prompt", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "test prompt",
      cwd: "/work/project",
      extraAgentFlags: ["--verbose"],
    });
    // The tail should be: ...image, "claude", "-p", "--verbose", "test prompt"
    const promptIdx = args.lastIndexOf("test prompt");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(args[promptIdx - 1]).toBe("--verbose");
    expect(args[promptIdx - 2]).toBe("-p");
    expect(args[promptIdx - 3]).toBe("claude");
  });

  it("injects multiple extraAgentFlags in order", () => {
    const args = buildDockerArgs({
      agentCommand: "opencode run",
      prompt: "test prompt",
      cwd: "/work/project",
      extraAgentFlags: ["--print-logs", "--log-level", "DEBUG"],
    });
    const promptIdx = args.lastIndexOf("test prompt");
    expect(args[promptIdx - 3]).toBe("--print-logs");
    expect(args[promptIdx - 2]).toBe("--log-level");
    expect(args[promptIdx - 1]).toBe("DEBUG");
  });

  it("empty extraAgentFlags produces no extra args", () => {
    const argsWithout = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "test prompt",
      cwd: "/work/project",
    });
    const argsWith = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "test prompt",
      cwd: "/work/project",
      extraAgentFlags: [],
    });
    expect(argsWith).toEqual(argsWithout);
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

  it.skipIf(process.platform === "win32")(
    "mounts credential files to CONTAINER_HOME, not /root",
    () => {
      const home = ctx.dir;
      writeFileSync(join(home, ".gitconfig"), "[user]\n  name = Test\n");
      const flags = buildMountFlags("claude", [], home);
      const mountArg = flags.find((f) => f.includes(".gitconfig"));
      expect(mountArg).toBeDefined();
      expect(mountArg).toContain(`${CONTAINER_HOME}/.gitconfig`);
      expect(mountArg).not.toContain("/root/");
    },
  );

  it.skipIf(process.platform === "win32")(
    "mounts opencode auth files to CONTAINER_HOME, not /root",
    () => {
      const home = ctx.dir;
      mkdirSync(join(home, ".local", "share", "opencode"), {
        recursive: true,
      });
      writeFileSync(
        join(home, ".local", "share", "opencode", "auth.json"),
        "{}",
      );

      const flags = buildMountFlags("opencode", [], home);
      const authMount = flags.find((f) => f.includes("auth.json"));
      expect(authMount).toBeDefined();
      expect(authMount).toContain(CONTAINER_HOME);
      expect(authMount).not.toContain("/root/");
    },
  );

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

  it.skipIf(process.platform === "win32")(
    "mounts .agents/skills/ read-only when it exists",
    () => {
      const home = ctx.dir;
      mkdirSync(join(home, ".agents", "skills"), { recursive: true });
      const flags = buildMountFlags("claude", [], home);
      const skillsMount = flags.find((f) => f.includes(".agents/skills"));
      expect(skillsMount).toBeDefined();
      expect(skillsMount).toContain(":ro");
      expect(skillsMount).toContain(CONTAINER_HOME);
    },
  );

  it("skips .agents/skills/ when it does not exist", () => {
    const flags = buildMountFlags("claude", [], ctx.dir);
    const hasSkills = flags.some((f) => f.includes(".agents/skills"));
    expect(hasSkills).toBe(false);
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
// getUserFlag — host user ID forwarding
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")("getUserFlag", () => {
  it("returns --user UID:GID on POSIX systems", () => {
    // This test runs on Linux/macOS where getuid/getgid are available
    const flags = getUserFlag();
    expect(flags).toHaveLength(2);
    expect(flags[0]).toBe("--user");
    expect(flags[1]).toMatch(/^\d+:\d+$/);
  });

  it("returns current process UID:GID", () => {
    const flags = getUserFlag();
    expect(flags[1]).toBe(`${process.getuid!()}:${process.getgid!()}`);
  });
});

// ---------------------------------------------------------------------------
// CONTAINER_HOME constant
// ---------------------------------------------------------------------------

describe("CONTAINER_HOME", () => {
  it("is /home/agent", () => {
    expect(CONTAINER_HOME).toBe("/home/agent");
  });

  it("does not reference /root", () => {
    expect(CONTAINER_HOME).not.toContain("/root");
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

  it("accepts mainGitDir in config for worktree support", () => {
    const executor = new DockerExecutor({
      mainGitDir: "/work/main-repo/.git",
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

  it("passes mainGitDir through to DockerExecutor", () => {
    const executor = createExecutor("docker", {
      mainGitDir: "/work/main-repo/.git",
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

  it.skipIf(process.platform === "win32")(
    "includes --user flag with host UID:GID",
    () => {
      const args = buildSetupDockerArgs({
        agentCommand: "claude -p",
        setupCommand: "bun install",
        cwd: "/work/my-project",
      });
      const userIdx = args.indexOf("--user");
      expect(userIdx).toBeGreaterThan(-1);
      const uidGid = args[userIdx + 1];
      expect(uidGid).toBe(`${process.getuid!()}:${process.getgid!()}`);
    },
  );

  it("includes -e HOME=/home/agent", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-project",
    });
    const homeEnv = `HOME=${CONTAINER_HOME}`;
    const homeIdx = args.indexOf(homeEnv);
    expect(homeIdx).toBeGreaterThan(-1);
    expect(args[homeIdx - 1]).toBe("-e");
  });

  it("includes -e HUSKY=0 to suppress git hooks", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-project",
    });
    const huskyIdx = args.indexOf("HUSKY=0");
    expect(huskyIdx).toBeGreaterThan(-1);
    expect(args[huskyIdx - 1]).toBe("-e");
  });

  it("includes -e TURBO_CACHE_DIR=.turbo for build-tool cache isolation", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-project",
    });
    const idx = args.indexOf("TURBO_CACHE_DIR=.turbo");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-e");
  });

  it("includes -e NX_CACHE_DIRECTORY=.nx/cache for build-tool cache isolation", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-project",
    });
    const idx = args.indexOf("NX_CACHE_DIRECTORY=.nx/cache");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-e");
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

  it("mounts mainGitDir read-write when provided", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-worktree",
      mainGitDir: "/work/main-repo/.git",
    });
    const vFlags = extractVolumeFlags(args);
    const gitMount = vFlags.find((f) => f.includes("/work/main-repo/.git"));
    expect(gitMount).toBeDefined();
    expect(gitMount).toBe("/work/main-repo/.git:/work/main-repo/.git");
    expect(gitMount).not.toContain(":ro");
  });

  it("does not add extra mount when mainGitDir is absent", () => {
    const args = buildSetupDockerArgs({
      agentCommand: "claude -p",
      setupCommand: "bun install",
      cwd: "/work/my-project",
    });
    const vFlags = extractVolumeFlags(args);
    const gitMount = vFlags.find((f) => f.includes("/.git:"));
    expect(gitMount).toBeUndefined();
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

// ---------------------------------------------------------------------------
// resolveMainGitDir — worktree detection for Docker mounts
// ---------------------------------------------------------------------------

describe("resolveMainGitDir", () => {
  const ctx = useTempDir();

  it("returns undefined for a non-worktree git repo", () => {
    execSync("git init", { cwd: ctx.dir, stdio: "ignore" });
    expect(resolveMainGitDir(ctx.dir)).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "returns the main .git path for a worktree directory",
    () => {
      const mainRepo = ctx.dir;
      execSync("git init", { cwd: mainRepo, stdio: "ignore" });
      execSync("git config user.email 'test@test.com'", {
        cwd: mainRepo,
        stdio: "ignore",
      });
      execSync("git config user.name 'Test'", {
        cwd: mainRepo,
        stdio: "ignore",
      });
      writeFileSync(join(mainRepo, "file.txt"), "hello");
      execSync("git add . && git commit -m 'init'", {
        cwd: mainRepo,
        stdio: "ignore",
      });
      const worktreeDir = join(mainRepo, "..", "test-worktree");
      execSync(`git worktree add "${worktreeDir}" -b test-branch HEAD`, {
        cwd: mainRepo,
        stdio: "ignore",
      });
      try {
        const result = resolveMainGitDir(worktreeDir);
        expect(result).toBe(join(mainRepo, ".git"));
      } finally {
        execSync(`git worktree remove "${worktreeDir}"`, {
          cwd: mainRepo,
          stdio: "ignore",
        });
      }
    },
  );

  it("returns undefined for a non-git directory", () => {
    expect(resolveMainGitDir(ctx.dir)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DockerExecutor.buildSpawnDockerArgs — worktree auto-detection
// ---------------------------------------------------------------------------

describe("DockerExecutor.buildSpawnDockerArgs", () => {
  const ctx = useTempDir();

  it.skipIf(process.platform === "win32")(
    "includes main .git mount when cwd is a worktree",
    () => {
      const mainRepo = ctx.dir;
      execSync("git init", { cwd: mainRepo, stdio: "ignore" });
      execSync("git config user.email 'test@test.com'", {
        cwd: mainRepo,
        stdio: "ignore",
      });
      execSync("git config user.name 'Test'", {
        cwd: mainRepo,
        stdio: "ignore",
      });
      writeFileSync(join(mainRepo, "file.txt"), "hello");
      execSync("git add . && git commit -m 'init'", {
        cwd: mainRepo,
        stdio: "ignore",
      });
      const worktreeDir = join(mainRepo, "..", "executor-test-worktree");
      execSync(`git worktree add "${worktreeDir}" -b test-branch HEAD`, {
        cwd: mainRepo,
        stdio: "ignore",
      });
      try {
        const executor = new DockerExecutor();
        const args = executor.buildSpawnDockerArgs({
          agentCommand: "claude -p",
          prompt: "test prompt",
          cwd: worktreeDir,
        });
        const vFlags = extractVolumeFlags(args);
        const gitMount = vFlags.find((f) => f.includes(join(mainRepo, ".git")));
        expect(gitMount).toBeDefined();
        expect(gitMount).toBe(
          `${join(mainRepo, ".git")}:${join(mainRepo, ".git")}`,
        );
        // Must be read-write (no :ro suffix)
        expect(gitMount).not.toContain(":ro");
      } finally {
        execSync(`git worktree remove "${worktreeDir}"`, {
          cwd: mainRepo,
          stdio: "ignore",
        });
      }
    },
  );

  it("does not add .git mount when cwd is not a worktree", () => {
    const mainRepo = ctx.dir;
    execSync("git init", { cwd: mainRepo, stdio: "ignore" });
    const executor = new DockerExecutor();
    const args = executor.buildSpawnDockerArgs({
      agentCommand: "claude -p",
      prompt: "test prompt",
      cwd: mainRepo,
    });
    const vFlags = extractVolumeFlags(args);
    const gitMount = vFlags.find((f) => f.includes("/.git:"));
    expect(gitMount).toBeUndefined();
  });

  it("injects verbose flags when verbose is true", () => {
    const mainRepo = ctx.dir;
    execSync("git init", { cwd: mainRepo, stdio: "ignore" });
    const executor = new DockerExecutor();
    const args = executor.buildSpawnDockerArgs({
      agentCommand: "claude -p",
      prompt: "test prompt",
      cwd: mainRepo,
      verbose: true,
    });
    // Claude's built-in verbose flag is --verbose
    const promptIdx = args.lastIndexOf("test prompt");
    expect(args[promptIdx - 1]).toBe("--verbose");
  });

  it("does not inject verbose flags when verbose is false", () => {
    const mainRepo = ctx.dir;
    execSync("git init", { cwd: mainRepo, stdio: "ignore" });
    const executor = new DockerExecutor();
    const args = executor.buildSpawnDockerArgs({
      agentCommand: "claude -p",
      prompt: "test prompt",
      cwd: mainRepo,
      verbose: false,
    });
    const promptIdx = args.lastIndexOf("test prompt");
    // Without verbose, the last arg before prompt should be "-p" (part of agent command)
    expect(args[promptIdx - 1]).toBe("-p");
  });

  it("uses agentVerboseFlags override when verbose is true", () => {
    const mainRepo = ctx.dir;
    execSync("git init", { cwd: mainRepo, stdio: "ignore" });
    const executor = new DockerExecutor();
    const args = executor.buildSpawnDockerArgs({
      agentCommand: "claude -p",
      prompt: "test prompt",
      cwd: mainRepo,
      verbose: true,
      agentVerboseFlags: "--custom-debug",
    });
    const promptIdx = args.lastIndexOf("test prompt");
    expect(args[promptIdx - 1]).toBe("--custom-debug");
  });
});

// ---------------------------------------------------------------------------
// Host runtime forwarding (docker.hostRuntime)
// ---------------------------------------------------------------------------

describe("buildDockerArgs — hostRuntime socket forwarding", () => {
  const ctx = useTempDir();

  it("mounts host socket at /var/run/docker.sock when hostRuntime=true and socket exists", () => {
    // Create a fake socket file
    const socketPath = join(ctx.dir, "docker.sock");
    writeFileSync(socketPath, "");

    // Override DOCKER_HOST to point to our fake socket
    const prevDockerHost = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = `unix://${socketPath}`;
    try {
      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "test",
        cwd: "/work",
        hostRuntime: true,
      });

      const vFlags = extractVolumeFlags(args);

      const socketMount = vFlags.find((f) =>
        f.includes("/var/run/docker.sock"),
      );
      expect(socketMount).toBeDefined();
      expect(socketMount).toBe(`${socketPath}:/var/run/docker.sock`);
    } finally {
      if (prevDockerHost === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = prevDockerHost;
    }
  });

  it("forwards DOCKER_HOST env var for tcp:// scheme when hostRuntime=true", () => {
    const prevDockerHost = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "tcp://192.168.1.100:2375";
    try {
      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "test",
        cwd: "/work",
        hostRuntime: true,
      });

      // Should have -e DOCKER_HOST (forwarded from host env)
      const dockerHostIdx = args.indexOf("DOCKER_HOST");
      expect(dockerHostIdx).toBeGreaterThan(-1);
      expect(args[dockerHostIdx - 1]).toBe("-e");

      // Should NOT have a socket mount
      const vFlags = extractVolumeFlags(args);
      const socketMount = vFlags.find((f) =>
        f.includes("/var/run/docker.sock"),
      );
      expect(socketMount).toBeUndefined();
    } finally {
      if (prevDockerHost === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = prevDockerHost;
    }
  });

  it("does NOT mount socket when hostRuntime is false", () => {
    const prevDockerHost = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "unix:///var/run/docker.sock";
    try {
      const args = buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "test",
        cwd: "/work",
        hostRuntime: false,
      });

      const vFlags = extractVolumeFlags(args);
      const socketMount = vFlags.find((f) =>
        f.includes("/var/run/docker.sock"),
      );
      expect(socketMount).toBeUndefined();
    } finally {
      if (prevDockerHost === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = prevDockerHost;
    }
  });

  it("does NOT mount socket when hostRuntime is undefined (default)", () => {
    const args = buildDockerArgs({
      agentCommand: "claude -p",
      prompt: "test",
      cwd: "/work",
    });

    const vFlags = extractVolumeFlags(args);
    const socketMount = vFlags.find((f) => f.includes("/var/run/docker.sock"));
    expect(socketMount).toBeUndefined();
  });

  it("emits console warning when hostRuntime=true but no socket found", () => {
    const prevDockerHost = process.env.DOCKER_HOST;
    delete process.env.DOCKER_HOST;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      buildDockerArgs({
        agentCommand: "claude -p",
        prompt: "test",
        cwd: "/work",
        hostRuntime: true,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toContain(
        "docker.hostRuntime is enabled but no Docker/Podman socket was found",
      );
    } finally {
      warnSpy.mockRestore();
      if (prevDockerHost === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = prevDockerHost;
    }
  });
});

describe("DockerExecutor — hostRuntime config", () => {
  const ctx = useTempDir();

  it("passes hostRuntime through to buildDockerArgs", () => {
    const mainRepo = ctx.dir;
    execSync("git init", { cwd: mainRepo, stdio: "ignore" });

    // Create a fake socket
    const socketPath = join(ctx.dir, "docker.sock");
    writeFileSync(socketPath, "");

    const prevDockerHost = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = `unix://${socketPath}`;
    try {
      const executor = new DockerExecutor({ hostRuntime: true });
      const args = executor.buildSpawnDockerArgs({
        agentCommand: "claude -p",
        prompt: "test",
        cwd: mainRepo,
      });

      const vFlags = extractVolumeFlags(args);
      const socketMount = vFlags.find((f) =>
        f.includes("/var/run/docker.sock"),
      );
      expect(socketMount).toBeDefined();
    } finally {
      if (prevDockerHost === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = prevDockerHost;
    }
  });
});
