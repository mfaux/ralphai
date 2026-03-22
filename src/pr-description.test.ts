import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  categorizeCommits,
  formatCommitsByCategory,
  buildCommitLog,
  buildDiffStat,
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
// buildDiffStat (integration with git)
// ---------------------------------------------------------------------------

describe("buildDiffStat", () => {
  const ctx = useTempDir();

  it("returns diffstat between base and head", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "new-file.txt", "content\n", "feat: add new file");

    const stat = buildDiffStat("main", "feature", ctx.dir);
    expect(stat).toContain("new-file.txt");
    expect(stat).toMatch(/\d+ file/);
  });

  it("returns empty string when no diff", () => {
    initRepo(ctx.dir);
    const stat = buildDiffStat("main", "main", ctx.dir);
    expect(stat).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildPrBody
// ---------------------------------------------------------------------------

describe("buildPrBody", () => {
  const ctx = useTempDir();

  it("includes summary, changes, and files changed sections", () => {
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
    expect(body).toContain("## Summary");
    expect(body).toContain("Add authentication system");
    expect(body).toContain("## Changes");
    expect(body).toContain("### Features");
    expect(body).toContain("- add user login");
    expect(body).toContain("### Bug Fixes");
    expect(body).toContain("- resolve crash on startup");
    expect(body).toContain("## Files Changed");
    expect(body).toContain("login.ts");
    expect(body).toContain("bug.ts");
  });

  it("omits Files Changed section when no diff", () => {
    initRepo(ctx.dir);
    const body = buildPrBody("Empty plan", "main", "main", ctx.dir);
    expect(body).toContain("## Summary");
    expect(body).toContain("Empty plan");
    expect(body).not.toContain("## Files Changed");
  });

  it("handles non-conventional commits in Other category", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "file.txt", "data", "random commit message");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir);
    expect(body).toContain("### Other");
    expect(body).toContain("- random commit message");
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
    expect(body).toContain("## Files Changed");
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
});
