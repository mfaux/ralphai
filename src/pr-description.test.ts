import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  categorizeCommits,
  formatCommitsByCategory,
  buildCommitLog,
  buildPrBody,
  buildContinuousPrBodyStructured,
} from "./pr-description.ts";

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

function commitFile(
  dir: string,
  filename: string,
  content: string,
  message: string,
): void {
  writeFileSync(join(dir, filename), content);
  execSync(`git add -A && git commit -m "${message}"`, {
    cwd: dir,
    stdio: "ignore",
  });
}

// ---------------------------------------------------------------------------
// categorizeCommits
// ---------------------------------------------------------------------------

describe("categorizeCommits", () => {
  it("groups conventional commits by type", () => {
    const log = [
      "abc1234 feat: add user login",
      "def5678 fix: resolve null pointer",
      "aab9012 refactor(core): simplify logic",
      "bbc3456 test: add unit tests",
      "ccd7890 docs: update README",
      "eef1234 chore: bump deps",
    ].join("\n");

    const result = categorizeCommits(log);
    expect(result.features).toEqual(["add user login"]);
    expect(result.fixes).toEqual(["resolve null pointer"]);
    expect(result.refactors).toEqual(["simplify logic"]);
    expect(result.tests).toEqual(["add unit tests"]);
    expect(result.docs).toEqual(["update README"]);
    expect(result.chores).toEqual(["bump deps"]);
    expect(result.other).toEqual([]);
  });

  it("puts non-conventional commits in other", () => {
    const log = "abc1234 random commit message";
    const result = categorizeCommits(log);
    expect(result.other).toEqual(["random commit message"]);
    expect(result.features).toEqual([]);
  });

  it("handles scoped conventional commits", () => {
    const log = "abc1234 feat(parser): add JSON support";
    const result = categorizeCommits(log);
    expect(result.features).toEqual(["add JSON support"]);
  });

  it("handles breaking change indicator", () => {
    const log = "abc1234 feat!: drop Node 14 support";
    const result = categorizeCommits(log);
    expect(result.features).toEqual(["drop Node 14 support"]);
  });

  it("maps perf and style to refactors", () => {
    const log = [
      "abc1234 perf: optimize hot path",
      "def5678 style: fix indentation",
    ].join("\n");
    const result = categorizeCommits(log);
    expect(result.refactors).toEqual(["optimize hot path", "fix indentation"]);
  });

  it("maps ci, build, revert to chores", () => {
    const log = [
      "abc1234 ci: add GitHub Actions",
      "def5678 build: update webpack",
      "aab9012 revert: undo bad change",
    ].join("\n");
    const result = categorizeCommits(log);
    expect(result.chores).toEqual([
      "add GitHub Actions",
      "update webpack",
      "undo bad change",
    ]);
  });

  it("returns empty categories for empty input", () => {
    const result = categorizeCommits("");
    expect(result.features).toEqual([]);
    expect(result.fixes).toEqual([]);
    expect(result.other).toEqual([]);
  });

  it("is case-insensitive for commit types", () => {
    const log = "abc1234 FEAT: uppercase feature";
    const result = categorizeCommits(log);
    expect(result.features).toEqual(["uppercase feature"]);
  });
});

// ---------------------------------------------------------------------------
// formatCommitsByCategory
// ---------------------------------------------------------------------------

describe("formatCommitsByCategory", () => {
  it("formats non-empty categories with headings", () => {
    const commits = categorizeCommits(
      [
        "abc1234 feat: add login",
        "def5678 fix: fix crash",
        "aab9012 test: add tests",
      ].join("\n"),
    );
    const formatted = formatCommitsByCategory(commits);
    expect(formatted).toContain("### Features");
    expect(formatted).toContain("- add login");
    expect(formatted).toContain("### Bug Fixes");
    expect(formatted).toContain("- fix crash");
    expect(formatted).toContain("### Tests");
    expect(formatted).toContain("- add tests");
  });

  it("omits empty categories", () => {
    const commits = categorizeCommits("abc1234 feat: only a feature");
    const formatted = formatCommitsByCategory(commits);
    expect(formatted).toContain("### Features");
    expect(formatted).not.toContain("### Bug Fixes");
    expect(formatted).not.toContain("### Refactoring");
  });

  it("returns placeholder when no commits", () => {
    const commits = categorizeCommits("");
    const formatted = formatCommitsByCategory(commits);
    expect(formatted).toBe("_No commits._");
  });
});

// ---------------------------------------------------------------------------
// buildCommitLog (integration with git)
// ---------------------------------------------------------------------------

describe("buildCommitLog", () => {
  const ctx = useTempDir();

  it("returns commits between base and head", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature A");

    const log = buildCommitLog("main", "feature", ctx.dir);
    expect(log).toContain("feat: add feature A");
  });

  it("returns empty string when no commits between refs", () => {
    initRepo(ctx.dir);
    const log = buildCommitLog("main", "main", ctx.dir);
    expect(log).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildPrBody
// ---------------------------------------------------------------------------

describe("buildPrBody", () => {
  const ctx = useTempDir();

  it("leads with description and includes changes section", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(
      ctx.dir,
      "login.ts",
      "export function login() {}",
      "feat: add user login",
    );
    commitFile(
      ctx.dir,
      "bug.ts",
      "export function fix() {}",
      "fix: resolve crash on startup",
    );

    const body = buildPrBody(
      "Add authentication system",
      "main",
      "feature",
      ctx.dir,
    );
    // Description is the first thing in the body
    expect(body.startsWith("Add authentication system")).toBe(true);
    // No ## Summary heading
    expect(body).not.toContain("## Summary");
    // No ## Files Changed section
    expect(body).not.toContain("## Files Changed");
    // Changes section present
    expect(body).toContain("## Changes");
    expect(body).toContain("### Features");
    expect(body).toContain("- add user login");
    expect(body).toContain("### Bug Fixes");
    expect(body).toContain("- resolve crash on startup");
  });

  it("uses agent summary when provided", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Plan description", "main", "feature", ctx.dir, {
      summary:
        "Implement JWT auth with bcrypt hashing, replacing cookie sessions.",
    });
    expect(
      body.startsWith(
        "Implement JWT auth with bcrypt hashing, replacing cookie sessions.",
      ),
    ).toBe(true);
    // Plan description should NOT appear when summary is provided
    expect(body).not.toContain("Plan description");
  });

  it("falls back to plan description when no summary", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody(
      "Add authentication system",
      "main",
      "feature",
      ctx.dir,
    );
    expect(body.startsWith("Add authentication system")).toBe(true);
  });

  it("handles non-conventional commits in Other category", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "file.txt", "data", "random commit message");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir);
    expect(body).toContain("### Other");
    expect(body).toContain("- random commit message");
  });

  it("renders PRD line after description", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody(
      "Fix widget validation",
      "main",
      "feature",
      ctx.dir,
      {
        prd: 30,
        issueRepo: "org/repo",
      },
    );
    expect(body).toContain("**PRD:** org/repo#30");
    expect(body).toContain("Fix widget validation");
    // Description should appear before PRD line
    const descIdx = body.indexOf("Fix widget validation");
    const prdIdx = body.indexOf("**PRD:**");
    expect(descIdx).toBeLessThan(prdIdx);
  });

  it("omits PRD line when prd is not provided", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir);
    expect(body).not.toContain("**PRD:**");
  });

  it("omits PRD line when issueRepo is missing", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      prd: 30,
    });
    expect(body).not.toContain("**PRD:**");
  });

  it("includes Closes #N after description (same-repo)", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Fix login bug", "main", "feature", ctx.dir, {
      issueNumber: 42,
    });
    expect(body).toContain("Closes #42");
    // Description should appear before Closes
    const descIdx = body.indexOf("Fix login bug");
    const closesIdx = body.indexOf("Closes #42");
    expect(descIdx).toBeLessThan(closesIdx);
    // Closes should appear before Changes
    const changesIdx = body.indexOf("## Changes");
    expect(closesIdx).toBeLessThan(changesIdx);
  });

  it("omits Closes line for manual plans (no issueNumber)", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Manual task", "main", "feature", ctx.dir);
    expect(body).not.toContain("Closes");
  });

  it("uses cross-repo syntax when issueRepo differs from prRepo", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Fix cross-repo bug", "main", "feature", ctx.dir, {
      issueNumber: 99,
      issueRepo: "org/issues",
      prRepo: "org/code",
    });
    expect(body).toContain("Closes org/issues#99");
    expect(body).not.toContain("Closes #99");
  });

  it("uses short form when issueRepo equals prRepo", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Fix same-repo bug", "main", "feature", ctx.dir, {
      issueNumber: 42,
      issueRepo: "org/repo",
      prRepo: "org/repo",
    });
    expect(body).toContain("Closes #42");
    expect(body).not.toContain("Closes org/repo#42");
  });

  it("includes description, Closes, and PRD in correct order", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody(
      "Implement feature from PRD",
      "main",
      "feature",
      ctx.dir,
      {
        issueNumber: 42,
        issueRepo: "org/repo",
        prRepo: "org/repo",
        prd: 30,
      },
    );
    expect(body).toContain("Closes #42");
    expect(body).toContain("**PRD:** org/repo#30");
    // Order: description -> PRD -> Closes -> Changes
    const descIdx = body.indexOf("Implement feature from PRD");
    const prdIdx = body.indexOf("**PRD:**");
    const closesIdx = body.indexOf("Closes #42");
    const changesIdx = body.indexOf("## Changes");
    expect(descIdx).toBeLessThan(prdIdx);
    expect(prdIdx).toBeLessThan(closesIdx);
    expect(closesIdx).toBeLessThan(changesIdx);
  });
});

// ---------------------------------------------------------------------------
// buildContinuousPrBodyStructured
// ---------------------------------------------------------------------------

describe("buildContinuousPrBodyStructured", () => {
  const ctx = useTempDir();

  it("includes all sections", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: implement plan A");

    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      ["plan-b.md"],
      "main",
      "feature",
      ctx.dir,
    );
    expect(body).toContain("## Completed Plans");
    expect(body).toContain("- [x] plan-a");
    expect(body).toContain("## Remaining Plans");
    expect(body).toContain("- [ ] plan-b.md");
    expect(body).toContain("## Changes");
    expect(body).toContain("### Features");
    expect(body).toContain("- implement plan A");
    // No Files Changed section
    expect(body).not.toContain("## Files Changed");
  });

  it("shows placeholders when no plans completed", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      [],
      [],
      "main",
      "main",
      ctx.dir,
    );
    expect(body).toContain("_None yet._");
    expect(body).toContain("_Backlog empty");
  });

  it("prepends Closes #N when prdNumber is provided", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 146 },
    );
    expect(body).toContain("Closes #146");
    // Closes line should appear before Completed Plans
    const closesIdx = body.indexOf("Closes #146");
    const plansIdx = body.indexOf("## Completed Plans");
    expect(closesIdx).toBeLessThan(plansIdx);
  });

  it("omits Closes line when prdNumber is not provided", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "main",
      ctx.dir,
    );
    expect(body).not.toContain("Closes #");
  });

  it("preserves Closes #N when body is rebuilt with new completed plans", () => {
    initRepo(ctx.dir);
    // Simulate first build
    const body1 = buildContinuousPrBodyStructured(
      ["plan-a"],
      ["plan-b.md"],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 146 },
    );
    expect(body1).toContain("Closes #146");
    expect(body1).toContain("- [x] plan-a");

    // Simulate rebuild after second plan completes
    const body2 = buildContinuousPrBodyStructured(
      ["plan-a", "plan-b"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 146 },
    );
    expect(body2).toContain("Closes #146");
    expect(body2).toContain("- [x] plan-a");
    expect(body2).toContain("- [x] plan-b");
  });

  it("leads with summary when provided", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "main",
      ctx.dir,
      {
        prdNumber: 146,
        summary: "Add a complete metrics dashboard with real-time tracking.",
      },
    );
    expect(
      body.startsWith(
        "Add a complete metrics dashboard with real-time tracking.",
      ),
    ).toBe(true);
    // Summary should appear before Closes and Completed Plans
    const summaryIdx = body.indexOf("Add a complete metrics dashboard");
    const closesIdx = body.indexOf("Closes #146");
    const plansIdx = body.indexOf("## Completed Plans");
    expect(summaryIdx).toBeLessThan(closesIdx);
    expect(closesIdx).toBeLessThan(plansIdx);
  });

  it("omits summary paragraph when not provided", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "main",
      ctx.dir,
      { prdNumber: 146 },
    );
    // Body should start with Closes (no summary paragraph)
    expect(body.trimStart().startsWith("Closes #146")).toBe(true);
  });

  it("starts with Completed Plans when no summary and no Closes", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["manual-task.md"],
      [],
      "main",
      "main",
      ctx.dir,
    );
    expect(body.trimStart().startsWith("## Completed Plans")).toBe(true);
  });
});
