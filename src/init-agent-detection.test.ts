import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";

/**
 * Build a PATH containing only the directories needed for node and git,
 * with no agent binaries. Uses `which` to find the real locations of
 * node and git, then builds a PATH from their parent directories plus
 * /usr/bin (for `which` itself and other essentials).
 */
function basePathWithoutAgents(): string {
  const nodeDir = dirname(execSync("which node", { encoding: "utf-8" }).trim());
  const gitDir = dirname(execSync("which git", { encoding: "utf-8" }).trim());
  const dirs = new Set([nodeDir, gitDir, "/usr/bin", "/usr/local/bin", "/bin"]);
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

    it("detects Claude Code when claude binary is in PATH", () => {
      const { path } = pathWithAgent(ctx.dir, "claude");
      const result = runCli(["init", "--yes"], ctx.dir, {
        PATH: path,
        NO_COLOR: "1",
      });
      const output = stripLogo(result.stdout);

      expect(output).toContain("Detected Claude Code");
      expect(output).toContain("claude -p");

      const config = JSON.parse(
        readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
      );
      expect(config.agentCommand).toBe("claude -p");
    });

    it("detects OpenCode when opencode binary is in PATH (but not claude)", () => {
      const { path } = pathWithAgent(ctx.dir, "opencode");
      const result = runCli(["init", "--yes"], ctx.dir, {
        PATH: path,
        NO_COLOR: "1",
      });
      const output = stripLogo(result.stdout);

      expect(output).toContain("Detected OpenCode");
      expect(output).toContain("opencode run --agent build");

      const config = JSON.parse(
        readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
      );
      expect(config.agentCommand).toBe("opencode run --agent build");
    });

    it("falls back to OpenCode when no agent binaries are in PATH", () => {
      const result = runCli(["init", "--yes"], ctx.dir, {
        PATH: basePathWithoutAgents(),
        NO_COLOR: "1",
      });
      const output = stripLogo(result.stdout);

      expect(output).toContain("No supported agent found in PATH");
      expect(output).toContain("defaulting to OpenCode");
      expect(output).toContain("--agent-command=<cmd>");

      const config = JSON.parse(
        readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
      );
      expect(config.agentCommand).toBe("opencode run --agent build");
    });

    it("explicit --agent-command skips detection entirely", () => {
      const { path } = pathWithAgent(ctx.dir, "claude");
      const result = runCli(
        ["init", "--yes", "--agent-command=custom-agent --flag"],
        ctx.dir,
        { PATH: path, NO_COLOR: "1" },
      );
      const output = stripLogo(result.stdout);

      // Should NOT show any detection message
      expect(output).not.toContain("Detected Claude Code");
      expect(output).not.toContain("No supported agent found");

      const config = JSON.parse(
        readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
      );
      expect(config.agentCommand).toBe("custom-agent --flag");
    });

    it("prioritizes Claude Code over OpenCode when both are available", () => {
      const { path, shimDir } = pathWithAgent(ctx.dir, "claude");
      writeFileSync(join(shimDir, "opencode"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });

      const result = runCli(["init", "--yes"], ctx.dir, {
        PATH: path,
        NO_COLOR: "1",
      });
      const output = stripLogo(result.stdout);

      expect(output).toContain("Detected Claude Code");

      const config = JSON.parse(
        readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
      );
      expect(config.agentCommand).toBe("claude -p");
    });
  },
);
