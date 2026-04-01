import { describe, it, expect } from "bun:test";
import { existsSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

describe("clean command", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  // -------------------------------------------------------------------------
  // Help and flag validation
  // -------------------------------------------------------------------------

  it("clean --help shows usage", () => {
    const result = runCli(["clean", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("clean");
    expect(result.stdout).toContain("--worktrees");
    expect(result.stdout).toContain("--archive");
    expect(result.stdout).toContain("--yes");
  });

  it("clean rejects unknown flags", () => {
    const result = runCli(["clean", "--bad-flag"], ctx.dir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
    expect(result.stderr).toContain("--bad-flag");
  });

  it("clean is listed in top-level --help", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("clean");
  });

  // -------------------------------------------------------------------------
  // Config guard
  // -------------------------------------------------------------------------

  it("clean errors when config does not exist", () => {
    const result = runCli(["clean", "--yes"], ctx.dir, testEnv());

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  // -------------------------------------------------------------------------
  // Nothing to clean
  // -------------------------------------------------------------------------

  it("clean -y prints 'Nothing to clean' when no archive and no worktrees", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const output = stripLogo(runCliOutput(["clean", "-y"], ctx.dir, testEnv()));

    expect(output).toContain("Nothing to clean");
  });

  it("clean --archive -y prints 'Nothing to clean' when out/ is empty", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const output = stripLogo(
      runCliOutput(["clean", "--archive", "-y"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Nothing to clean");
  });

  it("clean --worktrees -y prints 'Nothing to clean' when no orphaned worktrees", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const output = stripLogo(
      runCliOutput(["clean", "--worktrees", "-y"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Nothing to clean");
  });

  // -------------------------------------------------------------------------
  // Archive cleanup (--archive)
  // -------------------------------------------------------------------------

  it("clean --archive -y deletes archived plans", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(outDir, "my-feature");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "my-feature.md"), "# My Feature");
    writeFileSync(join(planDir, "progress.md"), "## Progress");
    writeFileSync(join(planDir, "receipt.txt"), "slug=my-feature");

    const output = stripLogo(
      runCliOutput(["clean", "--archive", "-y"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Cleaned");
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("clean --archive -y shows summary counts", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDirA = join(outDir, "feat-a");
    const planDirB = join(outDir, "feat-b");
    mkdirSync(planDirA, { recursive: true });
    mkdirSync(planDirB, { recursive: true });
    writeFileSync(join(planDirA, "feat-a.md"), "# A");
    writeFileSync(join(planDirB, "feat-b.md"), "# B");
    writeFileSync(join(planDirA, "progress.md"), "## Progress");
    writeFileSync(join(planDirA, "receipt.txt"), "slug=feat-a");
    writeFileSync(join(planDirB, "receipt.txt"), "slug=feat-b");

    const output = stripLogo(
      runCliOutput(["clean", "--archive", "-y"], ctx.dir, testEnv()),
    );

    expect(output).toContain("2 archived plans");
    expect(output).toContain("1 progress file");
    expect(output).toContain("2 receipts");
  });

  it("clean --archive -y preserves the out/ directory itself", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(outDir, "plan");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "plan.md"), "# Plan");

    runCliOutput(["clean", "--archive", "-y"], ctx.dir, testEnv());

    expect(existsSync(outDir)).toBe(true);
    expect(readdirSync(outDir)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Default (both) — archive portion
  // -------------------------------------------------------------------------

  it("clean -y deletes archived plans (default scope includes archive)", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(outDir, "my-feature");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "my-feature.md"), "# My Feature");

    const output = stripLogo(runCliOutput(["clean", "-y"], ctx.dir, testEnv()));

    expect(output).toContain("Cleaned");
    expect(readdirSync(outDir)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // --worktrees only does NOT touch archive
  // -------------------------------------------------------------------------

  it("clean --worktrees -y does not remove archived plans", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(outDir, "my-feature");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "my-feature.md"), "# My Feature");

    const output = stripLogo(
      runCliOutput(["clean", "--worktrees", "-y"], ctx.dir, testEnv()),
    );

    // Should still say "Nothing to clean" because there are no orphaned worktrees
    // (archive exists but --worktrees scopes to worktrees only)
    expect(output).toContain("Nothing to clean");
    // Archive should still exist
    expect(existsSync(join(planDir, "my-feature.md"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // --archive only does NOT touch worktrees
  // (validated implicitly — no worktrees exist in test, so just archive cleanup)
  // -------------------------------------------------------------------------

  it("clean --archive -y only cleans archive, not worktrees", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(outDir, "feat-x");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "feat-x.md"), "# X");

    const output = stripLogo(
      runCliOutput(["clean", "--archive", "-y"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Cleaned");
    expect(output).toContain("1 archived plan");
    expect(readdirSync(outDir)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Exit code
  // -------------------------------------------------------------------------

  it("clean -y exits 0 when nothing to clean", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const result = runCli(["clean", "-y"], ctx.dir, testEnv());

    expect(result.exitCode).toBe(0);
  });
});
