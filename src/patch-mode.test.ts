import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { runCli, runCliOutput, useTempGitDir } from "./test-utils.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

describe("patch mode", () => {
  const ctx = useTempGitDir();

  it("does not crash when the progress file has zero completed tasks", () => {
    // Write a plan to the global state backlog so the runner can find it
    const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
    const env = { RALPHAI_HOME: ralphaiHome };

    runCliOutput(["init", "--yes"], ctx.dir, env);

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

    // Write a plan to the global state backlog so the runner can find it
    const { backlogDir } = getRepoPipelineDirs(ctx.dir, env);
    writeFileSync(
      join(backlogDir, "hello-ralphai.md"),
      "# Plan: Hello Ralphai\n\n### Task 1: Create file\n",
    );

    const result = runCli(["run", "--patch"], ctx.dir, {
      RALPHAI_NO_UPDATE_CHECK: "1",
      RALPHAI_AGENT_COMMAND: "true",
      RALPHAI_HOME: ralphaiHome,
    });

    expect(result.stdout).toContain("Patch mode: working on current branch");
    expect(result.stdout).not.toContain("syntax error in expression");
    expect(result.stderr).not.toContain("syntax error in expression");
  });
});
