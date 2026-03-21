import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { useTempGitDir } from "./test-utils.ts";
import { parseConfigFile } from "./config.ts";

// ---------------------------------------------------------------------------
// workspaces config key — accepted without unknown-key warning
// ---------------------------------------------------------------------------

describe("workspaces config key", () => {
  const ctx = useTempGitDir();

  it("does not warn about unknown keys for workspaces", () => {
    const configContent = JSON.stringify(
      {
        agentCommand: "echo test",
        feedbackCommands: ["echo build"],
        workspaces: {
          "packages/web": {
            feedbackCommands: ["pnpm --filter web build"],
          },
        },
      },
      null,
      2,
    );
    const configFile = join(ctx.dir, "ralphai.json");
    writeFileSync(configFile, configContent);

    // Config parsing is now handled by the TS config module
    const result = parseConfigFile(configFile);
    expect(result).not.toBeNull();
    expect(result!.warnings.join(" ")).not.toContain("unknown config key");
    expect(result!.values.workspaces).toBeDefined();
    expect(result!.values.workspaces!["packages/web"]).toBeDefined();
  });

  it("rejects non-object workspaces value", () => {
    const configFile = join(ctx.dir, "ralphai.json");
    writeFileSync(
      configFile,
      JSON.stringify({
        agentCommand: "echo test",
        workspaces: "not-an-object",
      }),
    );

    // Config parsing is now handled by the TS config module
    expect(() => parseConfigFile(configFile)).toThrow(
      "'workspaces' must be an object",
    );
  });
});
