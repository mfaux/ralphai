import { describe, it, expect } from "bun:test";
import { join } from "path";
import { useTempGitDir } from "./test-utils.ts";
import {
  getConfigFilePath,
  parseConfigFile,
  writeConfigFile,
} from "./config.ts";

// ---------------------------------------------------------------------------
// workspaces config key — accepted without unknown-key warning
// ---------------------------------------------------------------------------

describe("workspaces config key", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  it("does not warn about unknown keys for workspaces", () => {
    const configContent = {
      agentCommand: "echo test",
      feedbackCommands: ["echo build"],
      workspaces: {
        "packages/web": {
          feedbackCommands: ["pnpm --filter web build"],
        },
      },
    };
    writeConfigFile(ctx.dir, configContent, testEnv());

    // Config parsing is now handled by the TS config module
    const result = parseConfigFile(configPath());
    expect(result).not.toBeNull();
    expect(result!.warnings.join(" ")).not.toContain("unknown config key");
    expect(result!.values.workspaces).toBeDefined();
    expect(result!.values.workspaces!["packages/web"]).toBeDefined();
  });

  it("rejects non-object workspaces value", () => {
    writeConfigFile(
      ctx.dir,
      {
        agentCommand: "echo test",
        workspaces: "not-an-object",
      },
      testEnv(),
    );

    // Config parsing is now handled by the TS config module
    expect(() => parseConfigFile(configPath())).toThrow(
      "'workspaces' must be an object",
    );
  });
});
