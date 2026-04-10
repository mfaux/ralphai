import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import { pushBranch, archiveRun, buildPrdPrBody } from "./pr-lifecycle.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Initialize a bare remote + clone pair for push tests. */
function initRepoWithRemote(dir: string): {
  repoDir: string;
  remoteDir: string;
} {
  const remoteDir = join(dir, "remote.git");
  const repoDir = join(dir, "repo");

  // Create bare remote
  mkdirSync(remoteDir, { recursive: true });
  execSync("git init --bare", { cwd: remoteDir, stdio: "ignore" });

  // Clone it
  execSync(`git clone "${remoteDir}" repo`, { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: "ignore" });

  // Initial commit
  writeFileSync(join(repoDir, "init.txt"), "init\n");
  execSync('git add -A && git commit -m "init"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  execSync("git push", { cwd: repoDir, stdio: "ignore" });

  return { repoDir, remoteDir };
}

/** Initialize a git repo with one commit (no remote). */
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
// pushBranch
// ---------------------------------------------------------------------------

describe("pushBranch", () => {
  const ctx = useTempDir();

  it("pushes a branch to a remote", () => {
    const { repoDir } = initRepoWithRemote(ctx.dir);

    // Create and push a feature branch
    execSync("git checkout -b test-branch", { cwd: repoDir, stdio: "ignore" });
    writeFileSync(join(repoDir, "new.txt"), "new\n");
    execSync('git add -A && git commit -m "add new"', {
      cwd: repoDir,
      stdio: "ignore",
    });

    const result = pushBranch("test-branch", repoDir, true);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("test-branch");
  });

  it("returns failure when no remote exists", () => {
    initRepo(ctx.dir);
    const result = pushBranch("main", ctx.dir, true);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed to push");
  });
});

// ---------------------------------------------------------------------------
// archiveRun
// ---------------------------------------------------------------------------

describe("archiveRun", () => {
  const ctx = useTempDir();

  it("returns early when wipFiles is empty", () => {
    const result = archiveRun({
      wipFiles: [],
      archiveDir: join(ctx.dir, "out"),
      cwd: ctx.dir,
    });
    expect(result.archived).toBe(false);
    expect(result.message).toContain("No WIP files");
  });

  it("moves plan folder to archive directory", () => {
    const wipDir = join(ctx.dir, "in-progress", "my-plan");
    const archiveDir = join(ctx.dir, "out");
    mkdirSync(wipDir, { recursive: true });
    writeFileSync(join(wipDir, "plan.md"), "# Plan\n\nDo stuff.");
    writeFileSync(join(wipDir, "progress.md"), "## Progress\n");

    initRepo(ctx.dir);

    const result = archiveRun({
      wipFiles: [join(wipDir, "plan.md"), join(wipDir, "progress.md")],
      archiveDir,
      cwd: ctx.dir,
    });

    expect(result.archived).toBe(true);
    expect(result.message).toContain("Archived");
    expect(existsSync(join(archiveDir, "my-plan", "plan.md"))).toBe(true);
    expect(existsSync(join(archiveDir, "my-plan", "progress.md"))).toBe(true);
    expect(existsSync(wipDir)).toBe(false);
  });

  it("creates archive directory if it does not exist", () => {
    const wipDir = join(ctx.dir, "in-progress", "test-plan");
    const archiveDir = join(ctx.dir, "nonexistent", "archive");
    mkdirSync(wipDir, { recursive: true });
    writeFileSync(join(wipDir, "plan.md"), "# Test");

    initRepo(ctx.dir);

    archiveRun({
      wipFiles: [join(wipDir, "plan.md")],
      archiveDir,
      cwd: ctx.dir,
    });

    expect(existsSync(archiveDir)).toBe(true);
  });

  it("reads issue frontmatter from plan files", () => {
    const wipDir = join(ctx.dir, "in-progress", "issue-plan");
    mkdirSync(wipDir, { recursive: true });
    writeFileSync(
      join(wipDir, "plan.md"),
      "---\nsource: github\nissue: 42\nissue-url: https://github.com/o/r/issues/42\n---\n\n# Fix it",
    );

    initRepo(ctx.dir);
    const archiveDir = join(ctx.dir, "out");

    // Should not throw even though gh is likely not available
    const result = archiveRun({
      wipFiles: [join(wipDir, "plan.md")],
      archiveDir,
      cwd: ctx.dir,
    });

    expect(result.archived).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildPrdPrBody
// ---------------------------------------------------------------------------

describe("buildPrdPrBody", () => {
  const ctx = useTempDir();

  it("includes PRD title and completed sub-issues", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10, 11, 12],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
    });

    expect(body).toContain("Add user dashboard");
    expect(body).toContain("#10");
    expect(body).toContain("#11");
    expect(body).toContain("#12");
  });

  it("includes Closes references for PRD and sub-issues", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10, 11],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
    });

    expect(body).toContain("Closes #42");
    expect(body).toContain("Closes #10");
    expect(body).toContain("Closes #11");
  });

  it("marks stuck sub-issues clearly", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [11, 12],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
    });

    expect(body).toContain("Completed");
    expect(body).toContain("#10");
    expect(body).toContain("Stuck");
    expect(body).toContain("#11");
    expect(body).toContain("#12");
  });

  it("does not reference stuck sub-issues in Closes block", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [11],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
    });

    expect(body).toContain("Closes #42");
    expect(body).toContain("Closes #10");
    expect(body).not.toContain("Closes #11");
  });

  it("includes commit log in Changes section", () => {
    initRepo(ctx.dir);

    // Add a commit so the log is non-empty
    execSync("git checkout -b feat/test-prd", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    writeFileSync(join(ctx.dir, "feature.txt"), "feature\n");
    execSync('git add -A && git commit -m "feat: add dashboard widget"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/test-prd",
      cwd: ctx.dir,
    });

    expect(body).toContain("Changes");
    expect(body).toContain("add dashboard widget");
  });

  it("renders Waiting on Human section when hitlSubIssues is non-empty", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      hitlSubIssues: [20, 21],
      baseBranch: "main",
      headBranch: "main",
      cwd: ctx.dir,
    });

    expect(body).toContain("## Waiting on Human");
    expect(body).toContain("- [ ] #20");
    expect(body).toContain("- [ ] #21");
  });

  it("omits Waiting on Human section when hitlSubIssues is empty", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      hitlSubIssues: [],
      baseBranch: "main",
      headBranch: "main",
      cwd: ctx.dir,
    });

    expect(body).not.toContain("Waiting on Human");
  });

  it("omits Waiting on Human section when hitlSubIssues is undefined", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "main",
      cwd: ctx.dir,
    });

    expect(body).not.toContain("Waiting on Human");
  });

  it("excludes HITL sub-issues from Closes references", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      hitlSubIssues: [20, 21],
      baseBranch: "main",
      headBranch: "main",
      cwd: ctx.dir,
    });

    expect(body).toContain("Closes #42");
    expect(body).toContain("Closes #10");
    expect(body).not.toContain("Closes #20");
    expect(body).not.toContain("Closes #21");
  });

  it("shows blocked sub-issues in stuck section with HITL dependency note", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [11],
      hitlSubIssues: [20],
      blockedSubIssues: [{ number: 12, blockedBy: [20] }],
      baseBranch: "main",
      headBranch: "main",
      cwd: ctx.dir,
    });

    expect(body).toContain("## Stuck Sub-Issues");
    expect(body).toContain("- [ ] #11");
    expect(body).toContain("- [ ] #12 — blocked by HITL #20");
  });

  it("does not duplicate blocked sub-issues already in stuck list", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [12],
      hitlSubIssues: [20],
      blockedSubIssues: [{ number: 12, blockedBy: [20] }],
      baseBranch: "main",
      headBranch: "main",
      cwd: ctx.dir,
    });

    // #12 should appear only once
    const matches = body.match(/- \[ \] #12/g);
    expect(matches).toHaveLength(1);
    expect(body).toContain("- [ ] #12 — blocked by HITL #20");
  });

  it("includes Summary section when summaries are provided", () => {
    initRepo(ctx.dir);

    const summaries = new Map<number, string>();
    summaries.set(
      10,
      "Added JWT-based authentication with login/logout endpoints.",
    );
    summaries.set(11, "Implemented rate limiting on auth routes.");

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10, 11],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
      summaries,
    });

    expect(body).toContain("## Summary");
    expect(body).toContain("**#10:** Added JWT-based authentication");
    expect(body).toContain("**#11:** Implemented rate limiting");
  });

  it("omits Summary section when no summaries are provided", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
    });

    expect(body).not.toContain("## Summary");
  });

  it("omits Summary section when summaries map is empty", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
      summaries: new Map(),
    });

    expect(body).not.toContain("## Summary");
  });

  it("includes Learnings section when learnings are provided", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
      learnings: [
        "The auth module requires a warm-up call before use.",
        "Rate limiting is enforced at the gateway level.",
      ],
    });

    expect(body).toContain("## Learnings");
    expect(body).toContain(
      "- The auth module requires a warm-up call before use.",
    );
    expect(body).toContain("- Rate limiting is enforced at the gateway level.");
  });

  it("places Learnings section after Changes section", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
      learnings: ["Some learning"],
    });

    const changesIndex = body.indexOf("## Changes");
    const learningsIndex = body.indexOf("## Learnings");
    expect(changesIndex).toBeGreaterThan(-1);
    expect(learningsIndex).toBeGreaterThan(changesIndex);
  });

  it("omits Learnings section when learnings is an empty array", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
      learnings: [],
    });

    expect(body).not.toContain("## Learnings");
  });

  it("omits Learnings section when learnings is not provided", () => {
    initRepo(ctx.dir);

    const body = buildPrdPrBody({
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feat/add-user-dashboard",
      cwd: ctx.dir,
    });

    expect(body).not.toContain("## Learnings");
  });
});
