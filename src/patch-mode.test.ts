import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { runCli, runCliOutput, useTempGitDir } from "./test-utils.ts";

describe("patch mode", () => {
  const ctx = useTempGitDir();

  it("does not crash when the progress file has zero completed tasks", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    execSync("git config user.name 'Test User'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    execSync("git config user.email 'test@example.com'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    execSync("git add -A && git commit -m init", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    execSync("git checkout -b feat/dataset-editor", {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    const result = runCli(["run", "--patch", "--turns=1"], ctx.dir, {
      RALPHAI_NO_UPDATE_CHECK: "1",
      RALPHAI_AGENT_COMMAND: "true",
    });

    expect(result.stdout).toContain("Patch mode: working on current branch");
    expect(result.stdout).not.toContain("syntax error in expression");
    expect(result.stderr).not.toContain("syntax error in expression");
  });
});
