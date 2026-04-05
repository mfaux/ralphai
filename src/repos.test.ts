import { describe, it, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  runCli,
  runCliOutputInProcess,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";
import { removeStaleRepos, listAllRepos } from "./global-state.ts";

describe("repos command", () => {
  const ctx = useTempGitDir();
  const env = () => ({ RALPHAI_HOME: join(ctx.dir, ".ralphai-home") });

  it("shows 'No repos found' when no repos exist", async () => {
    const output = stripLogo(
      await runCliOutputInProcess(["repos"], ctx.dir, env()),
    );
    expect(output).toContain("No repos found");
  });

  it("lists an initialized repo", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, env());

    const output = stripLogo(
      await runCliOutputInProcess(["repos"], ctx.dir, env()),
    );
    expect(output).toContain("Repos");
    expect(output).toContain(ctx.dir);
  });

  it("--help shows usage with --clean flag", async () => {
    const output = stripLogo(
      await runCliOutputInProcess(["repos", "--help"], ctx.dir, env()),
    );
    expect(output).toContain("--clean");
    expect(output).toContain("stale");
  });

  it("--clean removes stale repos with dead paths", async () => {
    const home = join(ctx.dir, ".ralphai-home");

    // Create a fake stale repo entry (path that doesn't exist, empty pipeline)
    const staleDir = join(home, "repos", "_path-deadbeef1234");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(
      join(staleDir, "config.json"),
      JSON.stringify({ repoPath: "/tmp/nonexistent-dir-xyz" }),
    );

    // Verify it shows up as stale
    const beforeOutput = stripLogo(
      await runCliOutputInProcess(["repos"], ctx.dir, env()),
    );
    expect(beforeOutput).toContain("_path-deadbeef1234");
    expect(beforeOutput).toContain("[stale]");

    // Run --clean
    const cleanOutput = stripLogo(
      await runCliOutputInProcess(["repos", "--clean"], ctx.dir, env()),
    );
    expect(cleanOutput).toContain("Removed");
    expect(cleanOutput).toContain("_path-deadbeef1234");

    // Verify it's gone
    expect(existsSync(staleDir)).toBe(false);
  });

  it("--clean preserves stale repos that have plans", async () => {
    const home = join(ctx.dir, ".ralphai-home");

    // Create a stale repo with a backlog plan
    const staleDir = join(home, "repos", "_path-hasplans1234");
    const backlogDir = join(staleDir, "pipeline", "backlog");
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(
      join(staleDir, "config.json"),
      JSON.stringify({ repoPath: "/tmp/nonexistent-dir-abc" }),
    );
    writeFileSync(join(backlogDir, "important-task.md"), "# Task\nDo stuff\n");

    // Run --clean
    const cleanOutput = stripLogo(
      await runCliOutputInProcess(["repos", "--clean"], ctx.dir, env()),
    );

    // Should NOT have been removed (not in the "Removed" message)
    expect(cleanOutput).toContain("No stale repos to remove");
    expect(existsSync(staleDir)).toBe(true);
    // Should still appear in the listing
    expect(cleanOutput).toContain("_path-hasplans1234");
  });

  it("--clean reports nothing when no stale repos exist", async () => {
    const output = stripLogo(
      await runCliOutputInProcess(["repos", "--clean"], ctx.dir, env()),
    );
    expect(output).toContain("No stale repos to remove");
  });
});

describe("removeStaleRepos", () => {
  const ctx = useTempGitDir();
  const env = () => ({ RALPHAI_HOME: join(ctx.dir, ".ralphai-home") });

  it("removes entries with dead repoPath and empty pipeline", () => {
    const home = join(ctx.dir, ".ralphai-home");
    const staleDir = join(home, "repos", "_path-unit-stale1");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(
      join(staleDir, "config.json"),
      JSON.stringify({ repoPath: "/tmp/gone-forever" }),
    );

    const removed = removeStaleRepos(env());
    expect(removed).toContain("_path-unit-stale1");
    expect(existsSync(staleDir)).toBe(false);
  });

  it("removes entries with no repoPath and empty pipeline", () => {
    const home = join(ctx.dir, ".ralphai-home");
    const dir = join(home, "repos", "_path-no-repopath");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({}));

    const removed = removeStaleRepos(env());
    expect(removed).toContain("_path-no-repopath");
    expect(existsSync(dir)).toBe(false);
  });

  it("removes entries with no config.json and empty pipeline", () => {
    const home = join(ctx.dir, ".ralphai-home");
    const dir = join(home, "repos", "_path-no-config");
    const pipelineDir = join(dir, "pipeline");
    mkdirSync(join(pipelineDir, "backlog"), { recursive: true });
    mkdirSync(join(pipelineDir, "in-progress"), { recursive: true });
    mkdirSync(join(pipelineDir, "out"), { recursive: true });

    const removed = removeStaleRepos(env());
    expect(removed).toContain("_path-no-config");
    expect(existsSync(dir)).toBe(false);
  });

  it("preserves entries with no config.json but non-empty pipeline", () => {
    const home = join(ctx.dir, ".ralphai-home");
    const dir = join(home, "repos", "_path-no-config-has-plans");
    const backlogDir = join(dir, "pipeline", "backlog");
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(join(backlogDir, "task.md"), "# Task\n");

    const removed = removeStaleRepos(env());
    expect(removed).not.toContain("_path-no-config-has-plans");
    expect(existsSync(dir)).toBe(true);
  });

  it("preserves entries where repoPath still exists", () => {
    const home = join(ctx.dir, ".ralphai-home");
    const dir = join(home, "repos", "_path-still-alive");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ repoPath: ctx.dir }), // ctx.dir exists
    );

    const removed = removeStaleRepos(env());
    expect(removed).not.toContain("_path-still-alive");
    expect(existsSync(dir)).toBe(true);
  });

  it("returns empty array when nothing is stale", () => {
    const removed = removeStaleRepos(env());
    expect(removed).toEqual([]);
  });
});
