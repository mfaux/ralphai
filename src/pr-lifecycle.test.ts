import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  pushBranch,
  archiveRun,
  buildContinuousPrBody,
  buildPrdPrBody,
} from "./pr-lifecycle.ts";

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
      issueInProgressLabel: "ralphai:in-progress",
      issueDoneLabel: "ralphai:done",
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
      issueInProgressLabel: "ralphai:in-progress",
      issueDoneLabel: "ralphai:done",
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
      issueInProgressLabel: "ralphai:in-progress",
      issueDoneLabel: "ralphai:done",
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
      issueInProgressLabel: "ralphai:in-progress",
      issueDoneLabel: "ralphai:done",
      cwd: ctx.dir,
    });

    expect(result.archived).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildContinuousPrBody
// ---------------------------------------------------------------------------

describe("buildContinuousPrBody", () => {
  const ctx = useTempDir();

  it("includes completed plans as checked items", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBody(
      ["plan-a", "plan-b"],
      join(ctx.dir, "backlog"),
      "main",
      "main",
      ctx.dir,
    );
    expect(body).toContain("- [x] plan-a");
    expect(body).toContain("- [x] plan-b");
  });

  it("shows 'None yet' when no plans completed", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBody(
      [],
      join(ctx.dir, "backlog"),
      "main",
      "main",
      ctx.dir,
    );
    expect(body).toContain("_None yet._");
  });

  it("shows remaining backlog plans as unchecked items", () => {
    initRepo(ctx.dir);
    const backlogDir = join(ctx.dir, "backlog");
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(join(backlogDir, "remaining-plan.md"), "# Plan");

    const body = buildContinuousPrBody(
      ["done-plan"],
      backlogDir,
      "main",
      "main",
      ctx.dir,
    );
    expect(body).toContain("- [ ] remaining-plan.md");
  });

  it("shows backlog empty message when no remaining plans", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBody(
      ["done"],
      join(ctx.dir, "empty-backlog"),
      "main",
      "main",
      ctx.dir,
    );
    expect(body).toContain("_Backlog empty");
  });

  it("includes changes section", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBody(
      [],
      join(ctx.dir, "backlog"),
      "main",
      "main",
      ctx.dir,
    );
    expect(body).toContain("## Changes");
  });

  it("includes commits between base and head branch", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    writeFileSync(join(ctx.dir, "feature.txt"), "feature\n");
    execSync('git add -A && git commit -m "add feature"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    const body = buildContinuousPrBody(
      [],
      join(ctx.dir, "backlog"),
      "main",
      "feature",
      ctx.dir,
    );
    expect(body).toContain("add feature");
  });

  it("prepends Closes #N when prdNumber option is provided", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBody(
      ["plan-a"],
      join(ctx.dir, "backlog"),
      "main",
      "main",
      ctx.dir,
      { prdNumber: 146 },
    );
    expect(body).toContain("Closes #146");
    const closesIdx = body.indexOf("Closes #146");
    const plansIdx = body.indexOf("## Completed Plans");
    expect(closesIdx).toBeLessThan(plansIdx);
  });

  it("omits Closes line when prdNumber is not provided", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBody(
      ["plan-a"],
      join(ctx.dir, "backlog"),
      "main",
      "main",
      ctx.dir,
    );
    expect(body).not.toContain("Closes #");
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
});
