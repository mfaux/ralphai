import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";

/** Binary names of all agents that detectInstalledAgent() probes for. */
const AGENT_BINARIES = [
  "opencode",
  "claude",
  "codex",
  "gemini",
  "aider",
  "goose",
  "kiro-cli",
  "amp",
];

/**
 * Build a PATH containing only the directories needed for node and git,
 * with no agent binaries. Uses `which` to find the real locations of
 * node and git, then builds a PATH from their parent directories plus
 * /usr/bin (for `which` itself and other essentials). Any directory that
 * contains a known agent binary is excluded so that detectInstalledAgent()
 * falls through to the OpenCode fallback.
 */
function basePathWithoutAgents(): string {
  const nodeDir = dirname(execSync("which node", { encoding: "utf-8" }).trim());
  const gitDir = dirname(execSync("which git", { encoding: "utf-8" }).trim());
  const dirs = new Set([nodeDir, gitDir, "/usr/bin", "/usr/local/bin", "/bin"]);

  // Remove any directory that contains a known agent binary
  for (const dir of [...dirs]) {
    if (AGENT_BINARIES.some((bin) => existsSync(join(dir, bin)))) {
      dirs.delete(dir);
    }
  }

  return [...dirs].join(":");
}

/**
 * Build a PATH that includes a shim for a specific agent binary, plus
 * the base essentials (node, git). No real agent binaries will be found.
 */
function pathWithAgent(
  testDir: string,
  binaryName: string,
): { path: string; shimDir: string } {
  const shimDir = join(testDir, "shims");
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(join(shimDir, binaryName), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  return { path: `${shimDir}:${basePathWithoutAgents()}`, shimDir };
}

describe.skipIf(process.platform === "win32")(
  "init --yes agent detection",
  () => {
    const ctx = useTempGitDir();

    function testEnv() {
      return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
    }
    function configPath() {
      return getConfigFilePath(ctx.dir, testEnv());
    }

    it("detects OpenCode when opencode binary is in PATH", () => {
      const { path } = pathWithAgent(ctx.dir, "opencode");
      const result = runCli(["init", "--yes"], ctx.dir, {
        ...testEnv(),
        PATH: path,
        NO_COLOR: "1",
      });
      const output = stripLogo(result.stdout);

      expect(output).toContain("Detected OpenCode");
      expect(output).toContain("opencode run --agent build");

      const config = JSON.parse(readFileSync(configPath(), "utf-8"));
      expect(config.agentCommand).toBe("opencode run --agent build");
    });

    it("falls back to OpenCode when no agent binaries are in PATH", () => {
      const result = runCli(["init", "--yes"], ctx.dir, {
        ...testEnv(),
        PATH: basePathWithoutAgents(),
        NO_COLOR: "1",
      });
      const output = stripLogo(result.stdout);

      expect(output).toContain("No supported agent found in PATH");
      expect(output).toContain("defaulting to OpenCode");
      expect(output).toContain("--agent-command=<cmd>");

      const config = JSON.parse(readFileSync(configPath(), "utf-8"));
      expect(config.agentCommand).toBe("opencode run --agent build");
    });

    it("explicit --agent-command skips detection entirely", () => {
      const result = runCli(
        ["init", "--yes", "--agent-command=custom-agent --flag"],
        ctx.dir,
        { ...testEnv(), PATH: basePathWithoutAgents(), NO_COLOR: "1" },
      );
      const output = stripLogo(result.stdout);

      // Should NOT show any detection message
      expect(output).not.toContain("Detected OpenCode");
      expect(output).not.toContain("No supported agent found");

      const config = JSON.parse(readFileSync(configPath(), "utf-8"));
      expect(config.agentCommand).toBe("custom-agent --flag");
    });
  },
);
