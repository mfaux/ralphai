import { describe, it, expect } from "vitest";
import { existsSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";

describe("purge command", () => {
  const ctx = useTempGitDir();

  it("purge --yes deletes all files in pipeline/out/", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const outDir = join(ctx.dir, ".ralphai", "pipeline", "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "my-feature-20260101-120000.md"),
      "# My Feature",
    );
    writeFileSync(
      join(outDir, "progress-my-feature-20260101-120000.md"),
      "## Progress",
    );
    writeFileSync(
      join(outDir, "receipt-my-feature-20260101-120000.txt"),
      "slug=my-feature",
    );

    const output = stripLogo(runCliOutput(["purge", "--yes"], ctx.dir));

    expect(output).toContain("Purged");
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("purge --yes reports nothing when out/ is empty", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const outDir = join(ctx.dir, ".ralphai", "pipeline", "out");
    mkdirSync(outDir, { recursive: true });

    const output = stripLogo(runCliOutput(["purge", "--yes"], ctx.dir));

    expect(output).toContain("Nothing to purge");
  });

  it("purge --yes reports nothing when out/ does not exist", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const output = stripLogo(runCliOutput(["purge", "--yes"], ctx.dir));

    expect(output).toContain("Nothing to purge");
  });

  it("purge --yes shows summary counts by type", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const outDir = join(ctx.dir, ".ralphai", "pipeline", "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "feat-a-20260101-120000.md"), "# A");
    writeFileSync(join(outDir, "feat-b-20260102-120000.md"), "# B");
    writeFileSync(
      join(outDir, "progress-feat-a-20260101-120000.md"),
      "## Progress",
    );
    writeFileSync(
      join(outDir, "receipt-feat-a-20260101-120000.txt"),
      "slug=feat-a",
    );
    writeFileSync(
      join(outDir, "receipt-feat-b-20260102-120000.txt"),
      "slug=feat-b",
    );

    const output = stripLogo(runCliOutput(["purge", "--yes"], ctx.dir));

    expect(output).toContain("2 archived plans");
    expect(output).toContain("1 progress file");
    expect(output).toContain("2 receipts");
  });

  it("purge errors when .ralphai/ does not exist", () => {
    const result = runCli(["purge", "--yes"], ctx.dir);

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
    runCliOutput(["init", "--yes"], ctx.dir);

    const outDir = join(ctx.dir, ".ralphai", "pipeline", "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "plan-20260101-120000.md"), "# Plan");

    runCliOutput(["purge", "--yes"], ctx.dir);

    // Directory should still exist, just be empty
    expect(existsSync(outDir)).toBe(true);
    expect(readdirSync(outDir)).toEqual([]);
  });
});
