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

describe("purge command", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("purge --yes deletes all files in pipeline/out/", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(outDir, "my-feature");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "my-feature.md"), "# My Feature");
    writeFileSync(join(planDir, "progress.md"), "## Progress");
    writeFileSync(join(planDir, "receipt.txt"), "slug=my-feature");

    const output = stripLogo(
      runCliOutput(["purge", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Purged");
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("purge --yes reports nothing when out/ is empty", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const output = stripLogo(
      runCliOutput(["purge", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Nothing to purge");
  });

  it("purge --yes reports nothing when out/ does not exist", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const output = stripLogo(
      runCliOutput(["purge", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Nothing to purge");
  });

  it("purge --yes shows summary counts by type", () => {
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
      runCliOutput(["purge", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("2 archived plans");
    expect(output).toContain("1 progress file");
    expect(output).toContain("2 receipts");
  });

  it("purge errors when config does not exist", () => {
    const result = runCli(["purge", "--yes"], ctx.dir, testEnv());

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
    expect(result.stderr).toContain("ralphai init");
  });

  it("purge --help shows usage", () => {
    const result = runCli(["purge", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("purge");
    expect(result.stdout).toContain("--yes");
  });

  it("purge rejects unknown flags", () => {
    const result = runCli(["purge", "--bad-flag"], ctx.dir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
    expect(result.stderr).toContain("--bad-flag");
  });

  it("purge --yes preserves the out/ directory itself", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(outDir, "plan");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "plan.md"), "# Plan");

    runCliOutput(["purge", "--yes"], ctx.dir, testEnv());

    // Directory should still exist, just be empty
    expect(existsSync(outDir)).toBe(true);
    expect(readdirSync(outDir)).toEqual([]);
  });
});
