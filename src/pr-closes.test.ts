import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  extractIssueNumbersFromPlans,
  buildClosesBlock,
  buildContinuousPrBodyStructured,
} from "./pr-lifecycle.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "ignore",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "init.txt"), "init\n");
  execSync('git add -A && git commit -m "init"', {
    cwd: dir,
    stdio: "ignore",
  });
}

// ---------------------------------------------------------------------------
// extractIssueNumbersFromPlans
// ---------------------------------------------------------------------------

describe("extractIssueNumbersFromPlans", () => {
  it("extracts issue numbers from gh-N-slug.md filenames", () => {
    const plans = [
      "gh-42-fix-login.md",
      "gh-99-add-dashboard.md",
      "gh-7-refactor-auth.md",
    ];
    expect(extractIssueNumbersFromPlans(plans)).toEqual([42, 99, 7]);
  });

  it("skips non-GitHub filenames", () => {
    const plans = ["manual-plan.md", "fix-bug.md", "readme.md"];
    expect(extractIssueNumbersFromPlans(plans)).toEqual([]);
  });

  it("skips gh-0-* filenames (issues start at 1)", () => {
    const plans = ["gh-0-zero-issue.md"];
    expect(extractIssueNumbersFromPlans(plans)).toEqual([]);
  });

  it("skips gh-abc-* filenames (non-numeric)", () => {
    // gh-abc- doesn't match \d+ pattern
    const plans = ["gh-abc-bad.md"];
    expect(extractIssueNumbersFromPlans(plans)).toEqual([]);
  });

  it("deduplicates issue numbers", () => {
    const plans = [
      "gh-42-first-attempt.md",
      "gh-42-second-attempt.md",
      "gh-10-other.md",
    ];
    expect(extractIssueNumbersFromPlans(plans)).toEqual([42, 10]);
  });

  it("returns empty array for empty input", () => {
    expect(extractIssueNumbersFromPlans([])).toEqual([]);
  });

  it("handles mixed GitHub and manual plans", () => {
    const plans = [
      "gh-5-feature.md",
      "manual-task.md",
      "gh-12-bugfix.md",
      "custom-plan.md",
    ];
    expect(extractIssueNumbersFromPlans(plans)).toEqual([5, 12]);
  });
});

// ---------------------------------------------------------------------------
// buildClosesBlock
// ---------------------------------------------------------------------------

describe("buildClosesBlock", () => {
  it("produces Closes #N for same-repo", () => {
    const result = buildClosesBlock({
      issueNumbers: [42, 99],
    });
    expect(result).toBe("Closes #42\nCloses #99");
  });

  it("produces Closes #N with PRD number first", () => {
    const result = buildClosesBlock({
      prdNumber: 10,
      issueNumbers: [42, 99],
    });
    expect(result).toBe("Closes #10\nCloses #42\nCloses #99");
  });

  it("uses cross-repo syntax when issueRepo differs from prRepo", () => {
    const result = buildClosesBlock({
      issueNumbers: [42],
      issueRepo: "org/issues-repo",
      prRepo: "org/code-repo",
    });
    expect(result).toBe("Closes org/issues-repo#42");
  });

  it("uses cross-repo syntax for PRD too", () => {
    const result = buildClosesBlock({
      prdNumber: 10,
      issueNumbers: [42],
      issueRepo: "org/issues-repo",
      prRepo: "org/code-repo",
    });
    expect(result).toBe("Closes org/issues-repo#10\nCloses org/issues-repo#42");
  });

  it("uses short form when issueRepo equals prRepo", () => {
    const result = buildClosesBlock({
      issueNumbers: [42],
      issueRepo: "org/repo",
      prRepo: "org/repo",
    });
    expect(result).toBe("Closes #42");
  });

  it("uses short form when issueRepo is missing", () => {
    const result = buildClosesBlock({
      issueNumbers: [42],
      prRepo: "org/repo",
    });
    expect(result).toBe("Closes #42");
  });

  it("uses short form when prRepo is missing", () => {
    const result = buildClosesBlock({
      issueNumbers: [42],
      issueRepo: "org/repo",
    });
    expect(result).toBe("Closes #42");
  });

  it("deduplicates PRD number when it appears in child issues", () => {
    const result = buildClosesBlock({
      prdNumber: 42,
      issueNumbers: [42, 99],
    });
    expect(result).toBe("Closes #42\nCloses #99");
  });

  it("returns empty string when no numbers provided", () => {
    const result = buildClosesBlock({
      issueNumbers: [],
    });
    expect(result).toBe("");
  });

  it("returns empty string when only prdNumber is undefined and issues empty", () => {
    const result = buildClosesBlock({
      prdNumber: undefined,
      issueNumbers: [],
    });
    expect(result).toBe("");
  });

  it("emits only PRD when no child issues", () => {
    const result = buildClosesBlock({
      prdNumber: 170,
      issueNumbers: [],
    });
    expect(result).toBe("Closes #170");
  });
});

// ---------------------------------------------------------------------------
// buildContinuousPrBodyStructured — child issue integration
// ---------------------------------------------------------------------------

describe("buildContinuousPrBodyStructured child issues", () => {
  const ctx = useTempDir();

  it("includes Closes lines for completed GitHub-sourced plans", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["gh-42-fix-login.md", "gh-99-add-feature.md"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170 },
    );
    expect(body).toContain("Closes #170");
    expect(body).toContain("Closes #42");
    expect(body).toContain("Closes #99");
    // Closes block appears before Completed Plans
    const closesIdx = body.indexOf("Closes #170");
    const plansIdx = body.indexOf("## Completed Plans");
    expect(closesIdx).toBeLessThan(plansIdx);
  });

  it("only completed plans produce Closes lines", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["gh-42-fix-login.md"],
      ["gh-99-pending.md"],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170 },
    );
    expect(body).toContain("Closes #42");
    expect(body).not.toContain("Closes #99");
  });

  it("non-GitHub plans do not produce Closes lines", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["manual-task.md", "gh-42-fix.md"],
      [],
      "main",
      "main",
      ctx.dir,
    );
    expect(body).toContain("Closes #42");
    // manual-task appears in checklist but not in Closes
    expect(body).toContain("- [x] manual-task.md");
    const closesLines = body.split("\n").filter((l) => l.startsWith("Closes "));
    expect(closesLines).toHaveLength(1);
    expect(closesLines[0]).toBe("Closes #42");
  });

  it("deduplicates PRD number that also appears as child plan", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["gh-170-prd-itself.md", "gh-42-child.md"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170 },
    );
    const closesLines = body.split("\n").filter((l) => l.startsWith("Closes "));
    // 170 should appear only once even though it's both PRD and child
    const closes170 = closesLines.filter((l) => l.includes("#170"));
    expect(closes170).toHaveLength(1);
    expect(closesLines).toHaveLength(2); // #170 and #42
  });

  it("PRD with no GitHub-sourced plans only emits Closes #prd", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["manual-task.md"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170 },
    );
    const closesLines = body.split("\n").filter((l) => l.startsWith("Closes "));
    expect(closesLines).toEqual(["Closes #170"]);
  });

  it("empty completed plans list produces no child Closes lines", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      [],
      ["gh-42-pending.md"],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170 },
    );
    const closesLines = body.split("\n").filter((l) => l.startsWith("Closes "));
    expect(closesLines).toEqual(["Closes #170"]);
  });

  it("uses cross-repo syntax when issueRepo differs from prRepo", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["gh-42-fix.md"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170, issueRepo: "org/issues", prRepo: "org/code" },
    );
    expect(body).toContain("Closes org/issues#170");
    expect(body).toContain("Closes org/issues#42");
  });

  it("uses short form when issueRepo equals prRepo", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["gh-42-fix.md"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170, issueRepo: "org/repo", prRepo: "org/repo" },
    );
    expect(body).toContain("Closes #170");
    expect(body).toContain("Closes #42");
    expect(body).not.toContain("Closes org/");
  });

  it("accumulates Closes as plans complete", () => {
    initRepo(ctx.dir);
    // First build: one plan completed
    const body1 = buildContinuousPrBodyStructured(
      ["gh-42-first.md"],
      ["gh-99-second.md"],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170 },
    );
    expect(body1).toContain("Closes #42");
    expect(body1).not.toContain("Closes #99");

    // Second build: both completed
    const body2 = buildContinuousPrBodyStructured(
      ["gh-42-first.md", "gh-99-second.md"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 170 },
    );
    expect(body2).toContain("Closes #42");
    expect(body2).toContain("Closes #99");
  });

  it("omits Closes block entirely when no PRD and no GitHub plans", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["manual-task.md"],
      [],
      "main",
      "main",
      ctx.dir,
    );
    expect(body).not.toContain("Closes");
    // Body should start with Completed Plans
    expect(body.trimStart().startsWith("## Completed Plans")).toBe(true);
  });
});
