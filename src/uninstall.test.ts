import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

describe("uninstall command", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("uninstall --yes removes the global state directory", () => {
    // Set up ralphai first so there's state to remove
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());
    const ralphaiHome = join(ctx.dir, ".ralphai-home");
    expect(existsSync(ralphaiHome)).toBe(true);

    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Removed");
    expect(output).toContain(ralphaiHome);
    expect(existsSync(ralphaiHome)).toBe(false);
  });

  it("uninstall --yes prints package manager uninstall command", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    // Should suggest one of the known uninstall commands
    expect(output).toMatch(
      /npm uninstall -g ralphai|pnpm remove -g ralphai|yarn global remove ralphai|bun remove -g ralphai/,
    );
  });

  it("uninstall --yes handles missing global state directory", () => {
    // Don't init, so there's no ~/.ralphai-home
    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("No global state directory found");
    // Should still print the uninstall command
    expect(output).toMatch(
      /npm uninstall -g ralphai|pnpm remove -g ralphai|yarn global remove ralphai|bun remove -g ralphai/,
    );
  });

  it("uninstall --yes warns about plans in the backlog", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    // Create a backlog plan
    const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    writeFileSync(join(backlogDir, "prd-feature-x.md"), "# Feature X");

    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Warning: active plans found");
    expect(output).toContain("2 in backlog");
  });

  it("uninstall --yes warns about plans in progress", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    // Create an in-progress plan (slug-folder format)
    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(wipDir, "prd-feature-y");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-feature-y.md"), "# Feature Y");

    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Warning: active plans found");
    expect(output).toContain("1 in progress");
  });

  it("uninstall --yes warns about backlog and in-progress plans together", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { backlogDir, wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Add 2 backlog plans
    writeFileSync(join(backlogDir, "prd-a.md"), "# A");
    writeFileSync(join(backlogDir, "prd-b.md"), "# B");

    // Add 1 in-progress plan
    const planDir = join(wipDir, "prd-c");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-c.md"), "# C");

    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Warning: active plans found");
    expect(output).toContain("3 in backlog");
    expect(output).toContain("1 in progress");
  });

  it("uninstall --yes does not warn when no plans exist", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    // Remove sample plan so the backlog is truly empty
    const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const samplePlan = join(backlogDir, "hello-ralphai.md");
    if (existsSync(samplePlan)) rmSync(samplePlan, { force: true });

    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).not.toContain("Warning");
  });

  it("uninstall --help shows usage and flags", () => {
    const result = runCli(["uninstall", "--help"], ctx.dir, testEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("uninstall");
    expect(result.stdout).toContain("--yes");
  });

  it("uninstall rejects unknown flags", () => {
    const result = runCli(["uninstall", "--bogus"], ctx.dir, testEnv());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown flag");
  });
});
