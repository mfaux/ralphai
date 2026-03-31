import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";

const ralphaiSrc = readFileSync(
  join(import.meta.dirname, "ralphai.ts"),
  "utf-8",
);

describe("init label creation", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  // ---------------------------------------------------------------------------
  // Source-level verification: ensureGitHubLabels creates all three labels
  // ---------------------------------------------------------------------------

  it("ensureGitHubLabels creates the ralphai label", () => {
    expect(ralphaiSrc).toContain(
      'gh label create ralphai --description "Ralphai picks up this issue" --color 7057ff --force',
    );
  });

  it("ensureGitHubLabels creates the ralphai:in-progress label", () => {
    expect(ralphaiSrc).toContain(
      'gh label create "ralphai:in-progress" --description "Ralphai is working on this issue" --color fbca04 --force',
    );
  });

  it("ensureGitHubLabels creates the ralphai-prd label", () => {
    expect(ralphaiSrc).toContain(
      'gh label create ralphai-prd --description "Ralphai PRD',
    );
    expect(ralphaiSrc).toContain("--color 1d76db --force");
  });

  // ---------------------------------------------------------------------------
  // Success message lists all three labels
  // ---------------------------------------------------------------------------

  it("success message includes all three label names", () => {
    expect(ralphaiSrc).toContain(
      'Created "ralphai", "ralphai:in-progress", and "ralphai-prd" labels',
    );
  });

  // ---------------------------------------------------------------------------
  // Manual-fallback error message includes all three gh label create commands
  // ---------------------------------------------------------------------------

  it("manual-fallback error includes gh label create for ralphai", () => {
    expect(ralphaiSrc).toContain(
      '  gh label create ralphai --description "Ralphai picks up this issue" --color 7057ff --force',
    );
  });

  it("manual-fallback error includes gh label create for ralphai:in-progress", () => {
    expect(ralphaiSrc).toContain(
      '  gh label create "ralphai:in-progress" --description "Ralphai is working on this issue" --color fbca04 --force',
    );
  });

  it("manual-fallback error includes gh label create for ralphai-prd", () => {
    expect(ralphaiSrc).toContain(
      '  gh label create ralphai-prd --description "Ralphai PRD',
    );
  });

  // ---------------------------------------------------------------------------
  // init --yes (issueSource=none) does not show label info
  // ---------------------------------------------------------------------------

  it("init --yes with default issueSource=none does not mention labels", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);
    expect(output).not.toContain("GitHub labels");
    expect(output).not.toContain("ralphai-prd label");
  });
});
