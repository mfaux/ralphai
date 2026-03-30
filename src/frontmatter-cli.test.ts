import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { useTempDir } from "./test-utils.ts";

/**
 * Run the frontmatter CLI and return stdout.
 * Uses node --experimental-strip-types to run the TypeScript source directly,
 * avoiding a dependency on dist/ which can be cleaned by concurrent tests.
 */
function runCli(args: string[]): string {
  const cli = join(__dirname, "frontmatter-cli.ts");
  return execFileSync("node", ["--experimental-strip-types", cli, ...args], {
    encoding: "utf-8",
    timeout: 5000,
  }).trimEnd();
}

// ---------------------------------------------------------------------------
// frontmatter-cli scope command
// ---------------------------------------------------------------------------

describe("frontmatter-cli scope", () => {
  const ctx = useTempDir();

  it("prints scope value from frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\n---\n\n# Plan\n");
    expect(runCli(["scope", p])).toBe("packages/web");
  });

  it("prints nothing when no scope", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [a.md]\n---\n\n# Plan\n");
    expect(runCli(["scope", p])).toBe("");
  });

  it("prints nothing for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Just a heading\n");
    expect(runCli(["scope", p])).toBe("");
  });

  it("prints nothing for nonexistent file", () => {
    expect(runCli(["scope", join(ctx.dir, "nope.md")])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// frontmatter-cli depends-on command
// ---------------------------------------------------------------------------

describe("frontmatter-cli depends-on", () => {
  const ctx = useTempDir();

  it("prints inline deps one per line", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [a.md, b.md]\n---\n\n# Plan\n");
    expect(runCli(["depends-on", p])).toBe("a.md\nb.md");
  });

  it("prints multiline deps one per line", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - plan-a.md\n  - plan-b.md\n---\n\n# Plan\n",
    );
    expect(runCli(["depends-on", p])).toBe("plan-a.md\nplan-b.md");
  });

  it("prints nothing when no depends-on", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: lib\n---\n\n# Plan\n");
    expect(runCli(["depends-on", p])).toBe("");
  });

  it("prints nothing for nonexistent file", () => {
    expect(runCli(["depends-on", join(ctx.dir, "nope.md")])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// frontmatter-cli issue command
// ---------------------------------------------------------------------------

describe("frontmatter-cli issue", () => {
  const ctx = useTempDir();

  it("prints all issue fields as key=value", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\nsource: github\nissue: 42\nissue-url: https://github.com/org/repo/issues/42\n---\n\n# Fix\n",
    );
    const output = runCli(["issue", p]);
    expect(output).toBe(
      "source=github\nissue=42\nissue-url=https://github.com/org/repo/issues/42",
    );
  });

  it("prints empty values when no issue fields", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\n---\n\n# Plan\n");
    const output = runCli(["issue", p]);
    expect(output).toBe("source=\nissue=\nissue-url=");
  });

  it("prints empty values for nonexistent file", () => {
    const output = runCli(["issue", join(ctx.dir, "nope.md")]);
    expect(output).toBe("source=\nissue=\nissue-url=");
  });

  it("prints partial fields correctly", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nsource: manual\n---\n\n# Plan\n");
    const output = runCli(["issue", p]);
    expect(output).toBe("source=manual\nissue=\nissue-url=");
  });
});
