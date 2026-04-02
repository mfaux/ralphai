import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkDependencyStatus, planReadiness } from "./plan-detection.ts";
import type { PipelineDirs } from "./plan-detection.ts";
import { buildIssuePlanContent } from "./issues.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDirs(root: string): PipelineDirs {
  const backlogDir = join(root, "pipeline", "backlog");
  const wipDir = join(root, "pipeline", "in-progress");
  const archiveDir = join(root, "pipeline", "out");
  mkdirSync(backlogDir, { recursive: true });
  mkdirSync(wipDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  return { backlogDir, wipDir, archiveDir };
}

// ---------------------------------------------------------------------------
// checkDependencyStatus with gh-N issue-based dependency slugs
// ---------------------------------------------------------------------------

describe("checkDependencyStatus with issue dep slugs", () => {
  let tmpDir: string;
  let dirs: PipelineDirs;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-issue-dep-"));
    dirs = makeDirs(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 'done' for gh-N slug when archived plan matches prefix", () => {
    // Issue #42 was pulled and completed → archived as gh-42-add-dark-mode
    mkdirSync(join(dirs.archiveDir, "gh-42-add-dark-mode"));
    expect(checkDependencyStatus("gh-42", dirs)).toBe("done");
  });

  it("returns 'pending' for gh-N slug when plan is in backlog", () => {
    writeFileSync(join(dirs.backlogDir, "gh-42-add-dark-mode.md"), "# Plan\n");
    expect(checkDependencyStatus("gh-42", dirs)).toBe("pending");
  });

  it("returns 'pending' for gh-N slug when plan is in-progress", () => {
    mkdirSync(join(dirs.wipDir, "gh-42-add-dark-mode"));
    expect(checkDependencyStatus("gh-42", dirs)).toBe("pending");
  });

  it("returns 'missing' for gh-N slug when no matching plan exists", () => {
    expect(checkDependencyStatus("gh-42", dirs)).toBe("missing");
  });

  it("prefers 'done' over 'pending' for gh-N slugs", () => {
    mkdirSync(join(dirs.archiveDir, "gh-42-add-dark-mode"));
    writeFileSync(join(dirs.backlogDir, "gh-42-add-dark-mode.md"), "# Plan\n");
    expect(checkDependencyStatus("gh-42", dirs)).toBe("done");
  });

  it("does not match gh-4 against gh-42 (prefix must match whole number)", () => {
    mkdirSync(join(dirs.archiveDir, "gh-42-add-dark-mode"));
    expect(checkDependencyStatus("gh-4", dirs)).toBe("missing");
  });
});

// ---------------------------------------------------------------------------
// planReadiness end-to-end: GitHub issue with blockers is not ready
// ---------------------------------------------------------------------------

describe("planReadiness with GitHub issue blockers", () => {
  let tmpDir: string;
  let dirs: PipelineDirs;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-plan-ready-"));
    dirs = makeDirs(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("blocked plan from GitHub issue is not ready when dependency is pending", () => {
    // Issue #100 depends on #42 — write the plan for #100
    const planContent = buildIssuePlanContent({
      issueNumber: "100",
      title: "Implement feature X",
      body: "Details here.",
      url: "https://github.com/org/repo/issues/100",
      blockers: [42],
    });
    const planPath = join(dirs.backlogDir, "gh-100-implement-feature-x.md");
    writeFileSync(planPath, planContent);

    // Issue #42 is still in the backlog (not archived)
    writeFileSync(
      join(dirs.backlogDir, "gh-42-add-dark-mode.md"),
      "# Add dark mode\n",
    );

    const result = planReadiness(planPath, dirs);
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.reasons).toContain("pending:gh-42");
    }
  });

  it("blocked plan becomes ready when dependency is archived", () => {
    const planContent = buildIssuePlanContent({
      issueNumber: "100",
      title: "Implement feature X",
      body: "Details here.",
      url: "https://github.com/org/repo/issues/100",
      blockers: [42],
    });
    const planPath = join(dirs.backlogDir, "gh-100-implement-feature-x.md");
    writeFileSync(planPath, planContent);

    // Issue #42 has been archived (completed)
    mkdirSync(join(dirs.archiveDir, "gh-42-add-dark-mode"));

    const result = planReadiness(planPath, dirs);
    expect(result.ready).toBe(true);
  });

  it("plan with multiple blockers is not ready until all are archived", () => {
    const planContent = buildIssuePlanContent({
      issueNumber: "100",
      title: "Implement feature X",
      body: "Details here.",
      url: "https://github.com/org/repo/issues/100",
      blockers: [10, 20],
    });
    const planPath = join(dirs.backlogDir, "gh-100-implement-feature-x.md");
    writeFileSync(planPath, planContent);

    // Only #10 is archived, #20 is still pending
    mkdirSync(join(dirs.archiveDir, "gh-10-setup-infra"));
    writeFileSync(
      join(dirs.backlogDir, "gh-20-configure-auth.md"),
      "# Configure auth\n",
    );

    const result = planReadiness(planPath, dirs);
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.reasons).toContain("pending:gh-20");
    }
  });

  it("plan without blockers is immediately ready", () => {
    const planContent = buildIssuePlanContent({
      issueNumber: "50",
      title: "Simple task",
      body: "No blockers here.",
      url: "https://github.com/org/repo/issues/50",
    });
    const planPath = join(dirs.backlogDir, "gh-50-simple-task.md");
    writeFileSync(planPath, planContent);

    const result = planReadiness(planPath, dirs);
    expect(result.ready).toBe(true);
  });
});
