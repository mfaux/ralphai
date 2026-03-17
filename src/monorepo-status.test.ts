import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { runCli, useTempGitDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Status scope display
// ---------------------------------------------------------------------------

describe("status scope display", () => {
  const ctx = useTempGitDir();

  it("shows scope annotation for backlog plan with scope frontmatter", () => {
    runCli(["init", "--yes"], ctx.dir);

    const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
    writeFileSync(
      join(backlogDir, "scoped-plan.md"),
      "---\nscope: packages/web\n---\n\n# Scoped Plan\n\n### Task 1: Do\n",
    );

    const result = runCli(["status"], ctx.dir);
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("scoped-plan.md");
    expect(output).toContain("scope: packages/web");
  });

  it("shows no scope annotation for plan without scope", () => {
    runCli(["init", "--yes"], ctx.dir);

    const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
    writeFileSync(
      join(backlogDir, "unscoped-plan.md"),
      "# Unscoped Plan\n\n### Task 1: Do\n",
    );

    const result = runCli(["status"], ctx.dir);
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("unscoped-plan.md");
    // The line for unscoped-plan should not mention "scope:"
    const lines = output.split("\n");
    const unscopedLine = lines.find((l: string) =>
      l.includes("unscoped-plan.md"),
    );
    expect(unscopedLine).toBeDefined();
    expect(unscopedLine).not.toContain("scope:");
  });

  it("shows scope for in-progress plan with scope frontmatter", () => {
    runCli(["init", "--yes"], ctx.dir);

    const ipDir = join(ctx.dir, ".ralphai", "pipeline", "in-progress");
    const planDir = join(ipDir, "web-feature");
    mkdirSync(planDir, { recursive: true });

    writeFileSync(
      join(planDir, "web-feature.md"),
      "---\nscope: packages/web\n---\n\n# Web Feature\n\n### Task 1: Build\n",
    );

    const result = runCli(["status"], ctx.dir);
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("web-feature.md");
    expect(output).toContain("scope: packages/web");
  });

  it("displays mix of scoped and unscoped plans correctly", () => {
    runCli(["init", "--yes"], ctx.dir);

    const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
    writeFileSync(
      join(backlogDir, "web-auth.md"),
      "---\nscope: packages/web\n---\n\n# Web Auth\n\n### Task 1: Login\n",
    );
    writeFileSync(
      join(backlogDir, "global-refactor.md"),
      "# Global Refactor\n\n### Task 1: Cleanup\n",
    );
    writeFileSync(
      join(backlogDir, "api-search.md"),
      "---\nscope: packages/api\n---\n\n# API Search\n\n### Task 1: Index\n",
    );

    const result = runCli(["status"], ctx.dir);
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);

    // Scoped plans show their scope
    expect(output).toContain("scope: packages/web");
    expect(output).toContain("scope: packages/api");

    // Unscoped plan present but without scope annotation
    expect(output).toContain("global-refactor.md");
    const lines = output.split("\n");
    const globalLine = lines.find((l: string) =>
      l.includes("global-refactor.md"),
    );
    expect(globalLine).toBeDefined();
    expect(globalLine).not.toContain("scope:");
  });
});
