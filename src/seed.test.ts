import { describe, it, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  runCliInProcess,
  runCliOutputInProcess,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";

describe("seed command", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("seeds hello-world into an initialized repo", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    // init already creates hello-world.md — remove it to test seed independently
    const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planPath = join(backlogDir, "hello-world.md");
    if (existsSync(planPath)) {
      const { rmSync } = require("fs");
      rmSync(planPath, { force: true });
    }
    expect(existsSync(planPath)).toBe(false);

    const output = stripLogo(
      await runCliOutputInProcess(["seed"], ctx.dir, testEnv()),
    );

    expect(existsSync(planPath)).toBe(true);
    const content = readFileSync(planPath, "utf8");
    expect(content).toContain("# Plan: Hello World");
    expect(output).toContain("Seeded hello-world into backlog");
    expect(output).not.toContain("Cleaned");
  });

  it("overwrites existing hello-world in backlog", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planPath = join(backlogDir, "hello-world.md");

    // Write different content to backlog
    writeFileSync(planPath, "# old content");

    const output = stripLogo(
      await runCliOutputInProcess(["seed"], ctx.dir, testEnv()),
    );

    expect(existsSync(planPath)).toBe(true);
    const content = readFileSync(planPath, "utf8");
    expect(content).toContain("# Plan: Hello World");
    expect(output).toContain("Cleaned hello-world from: backlog");
    expect(output).toContain("Seeded hello-world into backlog");
  });

  it("cleans up in-progress plan and seeds fresh copy", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { backlogDir, wipDir: inProgressDir } = getRepoPipelineDirs(
      ctx.dir,
      testEnv(),
    );

    // Simulate an in-progress plan (no active runner)
    const slugDir = join(inProgressDir, "hello-world");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "hello-world.md"), "# in progress");
    writeFileSync(join(slugDir, "progress.md"), "## Progress");

    const output = stripLogo(
      await runCliOutputInProcess(["seed"], ctx.dir, testEnv()),
    );

    // In-progress directory should be removed
    expect(existsSync(slugDir)).toBe(false);
    // Fresh plan should be in backlog
    const planPath = join(backlogDir, "hello-world.md");
    expect(existsSync(planPath)).toBe(true);
    expect(readFileSync(planPath, "utf8")).toContain("# Plan: Hello World");
    expect(output).toContain("in-progress");
    expect(output).toContain("Seeded hello-world into backlog");
  });

  it("cleans up archived plan and seeds fresh copy", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { backlogDir, archiveDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Remove backlog copy from init
    const backlogFile = join(backlogDir, "hello-world.md");
    if (existsSync(backlogFile)) {
      const { rmSync } = require("fs");
      rmSync(backlogFile, { force: true });
    }

    // Simulate an archived plan
    const archiveSlugDir = join(archiveDir, "hello-world");
    mkdirSync(archiveSlugDir, { recursive: true });
    writeFileSync(join(archiveSlugDir, "hello-world.md"), "# archived");
    writeFileSync(join(archiveSlugDir, "receipt.txt"), "outcome: success");

    const output = stripLogo(
      await runCliOutputInProcess(["seed"], ctx.dir, testEnv()),
    );

    // Archive directory should be removed
    expect(existsSync(archiveSlugDir)).toBe(false);
    // Fresh plan should be in backlog
    expect(existsSync(backlogFile)).toBe(true);
    expect(readFileSync(backlogFile, "utf8")).toContain("# Plan: Hello World");
    expect(output).toContain("archive");
    expect(output).toContain("Seeded hello-world into backlog");
  });

  it("cleans all stages when plan exists everywhere", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());
    const {
      backlogDir,
      wipDir: inProgressDir,
      archiveDir,
    } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Backlog (already there from init)
    writeFileSync(join(backlogDir, "hello-world.md"), "# backlog");

    // In-progress
    const ipDir = join(inProgressDir, "hello-world");
    mkdirSync(ipDir, { recursive: true });
    writeFileSync(join(ipDir, "hello-world.md"), "# wip");

    // Archive
    const archDir = join(archiveDir, "hello-world");
    mkdirSync(archDir, { recursive: true });
    writeFileSync(join(archDir, "hello-world.md"), "# done");

    const output = stripLogo(
      await runCliOutputInProcess(["seed"], ctx.dir, testEnv()),
    );

    expect(output).toContain("in-progress");
    expect(output).toContain("archive");
    expect(output).toContain("backlog");
    expect(output).toContain("Seeded hello-world into backlog");
    expect(existsSync(ipDir)).toBe(false);
    expect(existsSync(archDir)).toBe(false);
    expect(existsSync(join(backlogDir, "hello-world.md"))).toBe(true);
  });

  it("errors when ralphai is not initialized", async () => {
    // Don't run init
    const output = stripLogo(
      await runCliOutputInProcess(["seed"], ctx.dir, testEnv()),
    );

    expect(output).toContain("not set up");
    expect(output).toContain("ralphai init");
  });

  it("aborts when runner PID is active", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { wipDir: inProgressDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Simulate an in-progress plan with an active runner PID
    const slugDir = join(inProgressDir, "hello-world");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "hello-world.md"), "# running");
    // Use the current process PID (guaranteed alive)
    writeFileSync(join(slugDir, "runner.pid"), String(process.pid));

    const output = stripLogo(
      await runCliOutputInProcess(["seed"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Cannot seed");
    expect(output).toContain(String(process.pid));
    expect(output).toContain("Stop the runner first");
    // Plan should NOT have been cleaned up
    expect(existsSync(slugDir)).toBe(true);
  });

  it("ignores stale PID file when process is gone", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());
    const { backlogDir, wipDir: inProgressDir } = getRepoPipelineDirs(
      ctx.dir,
      testEnv(),
    );

    // Simulate an in-progress plan with a stale (non-existent) PID
    const slugDir = join(inProgressDir, "hello-world");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "hello-world.md"), "# stale");
    writeFileSync(join(slugDir, "runner.pid"), "99999999");

    const output = stripLogo(
      await runCliOutputInProcess(["seed"], ctx.dir, testEnv()),
    );

    // Should proceed despite stale PID
    expect(existsSync(slugDir)).toBe(false);
    expect(existsSync(join(backlogDir, "hello-world.md"))).toBe(true);
    expect(output).toContain("Seeded hello-world into backlog");
  });

  it("is listed under Plumbing in help output", async () => {
    const output = stripLogo(
      await runCliOutputInProcess(["--help"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Plumbing");
    expect(output).toContain("seed");
  });
});
