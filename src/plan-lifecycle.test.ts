/**
 * Tests for the plan-lifecycle module.
 *
 * Consolidated behavioral tests covering frontmatter extraction,
 * plan detection & dependency resolution, receipt handling,
 * global state (repo identity, pipeline dirs), and pipeline state gathering.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { useTempDir, useTempGitDir, runCliInProcess } from "./test-utils.ts";

import {
  // frontmatter
  extractScope,
  extractDependsOn,
  extractIssueFrontmatter,
  extractFeedbackScope,
  parseFrontmatter,
  // plan detection
  collectBacklogPlans,
  checkDependencyStatus,
  planReadiness,
  detectPlan,
  getPlanDescription,
  listPlanFolders,
  listPlanSlugs,
  countPlanTasks,
  countCompletedTasks,
  // receipt
  parseReceipt,
  initReceipt,
  updateReceiptTasks,
  updateReceiptPrUrl,
  resolveReceiptPath,
  checkReceiptSource,
  findPlansByBranch,
  // global state
  getRalphaiHome,
  getRepoId,
  resolveRepoStateDir,
  ensureRepoStateDir,
  getRepoPipelineDirs,
  // pipeline state
  gatherPipelineState,
  // types
  type PipelineDirs,
  type Receipt,
} from "./plan-lifecycle.ts";

// =========================================================================
// Frontmatter tests
// =========================================================================

// ---------------------------------------------------------------------------
// extractDependsOn
// ---------------------------------------------------------------------------

describe("extractDependsOn", () => {
  const ctx = useTempDir();

  it("returns inline array deps", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [a.md, b.md]\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["a.md", "b.md"]);
  });

  it("returns single inline dep", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [setup.md]\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["setup.md"]);
  });

  it("returns multiline YAML list deps", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - plan-a.md\n  - plan-b.md\n---\n\n# Plan\n",
    );
    expect(extractDependsOn(p)).toEqual(["plan-a.md", "plan-b.md"]);
  });

  it("returns single multiline dep", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on:\n  - only-one.md\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["only-one.md"]);
  });

  it("stops multiline collection at next key", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - dep-a.md\nscope: packages/web\n---\n\n# Plan\n",
    );
    expect(extractDependsOn(p)).toEqual(["dep-a.md"]);
  });

  it("returns empty array when no depends-on", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual([]);
  });

  it("returns empty array for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Plan: No Frontmatter\n");
    expect(extractDependsOn(p)).toEqual([]);
  });

  it("returns empty array for nonexistent file", () => {
    expect(extractDependsOn(join(ctx.dir, "nope.md"))).toEqual([]);
  });

  it("strips quotes from inline deps", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [\"a.md\", 'b.md']\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["a.md", "b.md"]);
  });

  it("strips quotes from multiline deps", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - \"quoted.md\"\n  - 'single.md'\n---\n\n# Plan\n",
    );
    expect(extractDependsOn(p)).toEqual(["quoted.md", "single.md"]);
  });

  it("handles trailing whitespace on inline values", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [a.md , b.md ]\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["a.md", "b.md"]);
  });

  it("handles trailing whitespace on multiline values", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - dep-a.md   \n  - dep-b.md  \n---\n\n# Plan\n",
    );
    expect(extractDependsOn(p)).toEqual(["dep-a.md", "dep-b.md"]);
  });
});

// ---------------------------------------------------------------------------
// extractIssueFrontmatter
// ---------------------------------------------------------------------------

describe("extractIssueFrontmatter", () => {
  const ctx = useTempDir();

  it("extracts all issue fields", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\nsource: github\nissue: 42\nissue-url: https://github.com/org/repo/issues/42\n---\n\n# Fix bug\n",
    );
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("github");
    expect(result.issue).toBe(42);
    expect(result.issueUrl).toBe("https://github.com/org/repo/issues/42");
  });

  it("returns defaults when no issue fields", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\n---\n\n# Plan\n");
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("");
    expect(result.issue).toBeUndefined();
    expect(result.issueUrl).toBe("");
  });

  it("returns defaults for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Plan: No Frontmatter\n");
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("");
    expect(result.issue).toBeUndefined();
    expect(result.issueUrl).toBe("");
  });

  it("returns defaults for nonexistent file", () => {
    const result = extractIssueFrontmatter(join(ctx.dir, "nope.md"));
    expect(result.source).toBe("");
    expect(result.issue).toBeUndefined();
    expect(result.issueUrl).toBe("");
  });

  it("handles partial issue fields (source only)", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nsource: manual\n---\n\n# Plan\n");
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("manual");
    expect(result.issue).toBeUndefined();
    expect(result.issueUrl).toBe("");
  });

  it("handles trailing whitespace on values", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\nsource: github   \nissue: 7   \nissue-url: https://example.com   \n---\n\n# Plan\n",
    );
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("github");
    expect(result.issue).toBe(7);
    expect(result.issueUrl).toBe("https://example.com");
  });

  it("extracts prd field when present", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\nsource: github\nissue: 42\nprd: 30\n---\n\n# Fix bug\n",
    );
    const result = extractIssueFrontmatter(p);
    expect(result.prd).toBe(30);
    expect(result.issue).toBe(42);
  });

  it("returns undefined prd when not present", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nsource: github\nissue: 42\n---\n\n# Fix bug\n");
    const result = extractIssueFrontmatter(p);
    expect(result.prd).toBeUndefined();
  });

  it("returns undefined prd for non-numeric value", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nprd: not-a-number\n---\n\n# Plan\n");
    const result = extractIssueFrontmatter(p);
    expect(result.prd).toBeUndefined();
  });

  it("handles prd with trailing whitespace", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nprd: 15   \n---\n\n# Plan\n");
    const result = extractIssueFrontmatter(p);
    expect(result.prd).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// extractFeedbackScope
// ---------------------------------------------------------------------------

describe("extractFeedbackScope", () => {
  const ctx = useTempDir();

  it("extracts feedback-scope value", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nfeedback-scope: src/components\n---\n\n# Plan\n");
    expect(extractFeedbackScope(p)).toBe("src/components");
  });

  it("returns empty string when feedback-scope is absent", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\n---\n\n# Plan\n");
    expect(extractFeedbackScope(p)).toBe("");
  });

  it("returns empty string for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Plan: No Frontmatter\n");
    expect(extractFeedbackScope(p)).toBe("");
  });

  it("returns empty string for nonexistent file", () => {
    expect(extractFeedbackScope(join(ctx.dir, "nope.md"))).toBe("");
  });

  it("handles trailing whitespace on value", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nfeedback-scope: src/utils   \n---\n\n# Plan\n");
    expect(extractFeedbackScope(p)).toBe("src/utils");
  });

  it("returns empty string for empty frontmatter block", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\n---\n\n# Plan\n");
    expect(extractFeedbackScope(p)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  const ctx = useTempDir();

  it("parses all fields from a complete plan", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      [
        "---",
        "source: github",
        "issue: 99",
        "issue-url: https://github.com/org/repo/issues/99",
        "scope: packages/api",
        "feedback-scope: src/components",
        "depends-on: [setup.md, infra.md]",
        "prd: 50",
        "---",
        "",
        "# Full plan",
        "",
      ].join("\n"),
    );
    const fm = parseFrontmatter(p);
    expect(fm.source).toBe("github");
    expect(fm.issue).toBe(99);
    expect(fm.issueUrl).toBe("https://github.com/org/repo/issues/99");
    expect(fm.scope).toBe("packages/api");
    expect(fm.feedbackScope).toBe("src/components");
    expect(fm.dependsOn).toEqual(["setup.md", "infra.md"]);
    expect(fm.prd).toBe(50);
  });

  it("parses with multiline depends-on", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      [
        "---",
        "scope: lib",
        "depends-on:",
        "  - alpha.md",
        "  - beta.md",
        "---",
        "",
        "# Multiline plan",
        "",
      ].join("\n"),
    );
    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("lib");
    expect(fm.dependsOn).toEqual(["alpha.md", "beta.md"]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
  });

  it("returns defaults for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Just a heading\n");
    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("");
    expect(fm.feedbackScope).toBe("");
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
    expect(fm.prd).toBeUndefined();
  });

  it("returns defaults for nonexistent file", () => {
    const fm = parseFrontmatter(join(ctx.dir, "nope.md"));
    expect(fm.scope).toBe("");
    expect(fm.feedbackScope).toBe("");
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
    expect(fm.prd).toBeUndefined();
  });

  it("returns defaults for empty frontmatter block", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\n---\n\n# Plan\n");
    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("");
    expect(fm.feedbackScope).toBe("");
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
    expect(fm.prd).toBeUndefined();
  });

  it("handles mixed fields with only some present", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\nissue: 12\n---\n\n# Partial\n");
    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("packages/web");
    expect(fm.issue).toBe(12);
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issueUrl).toBe("");
  });
});

// =========================================================================
// Plan detection tests
// =========================================================================

function makeDirs(base: string): PipelineDirs {
  const wipDir = join(base, "in-progress");
  const backlogDir = join(base, "backlog");
  const archiveDir = join(base, "out");
  mkdirSync(wipDir, { recursive: true });
  mkdirSync(backlogDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  return { wipDir, backlogDir, archiveDir };
}

function writePlan(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("collectBacklogPlans", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-plan-det-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for non-existent directory", () => {
    expect(collectBacklogPlans(join(tmpDir, "nope"))).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    const dir = join(tmpDir, "empty");
    mkdirSync(dir);
    expect(collectBacklogPlans(dir)).toEqual([]);
  });

  it("returns sorted .md files", () => {
    const dir = join(tmpDir, "backlog");
    mkdirSync(dir);
    writeFileSync(join(dir, "z-plan.md"), "# Z\n");
    writeFileSync(join(dir, "a-plan.md"), "# A\n");
    writeFileSync(join(dir, "m-plan.md"), "# M\n");
    writeFileSync(join(dir, "not-a-plan.txt"), "nope");

    const result = collectBacklogPlans(dir);
    expect(result).toEqual([
      join(dir, "a-plan.md"),
      join(dir, "m-plan.md"),
      join(dir, "z-plan.md"),
    ]);
  });

  it("ignores subdirectories", () => {
    const dir = join(tmpDir, "backlog");
    mkdirSync(dir);
    mkdirSync(join(dir, "subdir"));
    writeFileSync(join(dir, "subdir", "nested.md"), "# Nested\n");
    writeFileSync(join(dir, "top.md"), "# Top\n");

    const result = collectBacklogPlans(dir);
    expect(result).toEqual([join(dir, "top.md")]);
  });
});

describe("checkDependencyStatus", () => {
  let tmpDir: string;
  let dirs: PipelineDirs;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-dep-"));
    dirs = makeDirs(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 'done' when archived", () => {
    mkdirSync(join(dirs.archiveDir, "my-dep"));
    expect(checkDependencyStatus("my-dep", dirs)).toBe("done");
  });

  it("returns 'done' when dep slug has .md extension", () => {
    mkdirSync(join(dirs.archiveDir, "my-dep"));
    expect(checkDependencyStatus("my-dep.md", dirs)).toBe("done");
  });

  it("returns 'pending' when in-progress", () => {
    mkdirSync(join(dirs.wipDir, "my-dep"));
    expect(checkDependencyStatus("my-dep", dirs)).toBe("pending");
  });

  it("returns 'pending' when in backlog", () => {
    writeFileSync(join(dirs.backlogDir, "my-dep.md"), "# dep\n");
    expect(checkDependencyStatus("my-dep", dirs)).toBe("pending");
  });

  it("returns 'missing' when not found", () => {
    expect(checkDependencyStatus("nonexistent", dirs)).toBe("missing");
  });

  it("prefers 'done' over 'pending'", () => {
    mkdirSync(join(dirs.archiveDir, "my-dep"));
    mkdirSync(join(dirs.wipDir, "my-dep"));
    expect(checkDependencyStatus("my-dep", dirs)).toBe("done");
  });
});

describe("planReadiness", () => {
  let tmpDir: string;
  let dirs: PipelineDirs;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-ready-"));
    dirs = makeDirs(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns ready for plan with no dependencies", () => {
    const planPath = join(dirs.backlogDir, "no-deps.md");
    writeFileSync(planPath, "# Plan: No Deps\n\nSome content.\n");
    expect(planReadiness(planPath, dirs)).toEqual({ ready: true });
  });

  it("returns ready when all dependencies are archived", () => {
    mkdirSync(join(dirs.archiveDir, "dep-a"));
    mkdirSync(join(dirs.archiveDir, "dep-b"));
    const planPath = join(dirs.backlogDir, "child.md");
    writeFileSync(
      planPath,
      "---\ndepends-on: [dep-a.md, dep-b.md]\n---\n# Plan: Child\n",
    );
    expect(planReadiness(planPath, dirs)).toEqual({ ready: true });
  });

  it("returns blocked when dependency is pending", () => {
    writeFileSync(join(dirs.backlogDir, "dep-a.md"), "# dep\n");
    const planPath = join(dirs.backlogDir, "child.md");
    writeFileSync(
      planPath,
      "---\ndepends-on: [dep-a.md]\n---\n# Plan: Child\n",
    );
    const result = planReadiness(planPath, dirs);
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.reasons).toContain("pending:dep-a.md");
    }
  });

  it("returns blocked when dependency is missing", () => {
    const planPath = join(dirs.backlogDir, "child.md");
    writeFileSync(
      planPath,
      "---\ndepends-on: [nonexistent.md]\n---\n# Plan: Child\n",
    );
    const result = planReadiness(planPath, dirs);
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.reasons).toContain("missing:nonexistent.md");
    }
  });

  it("detects self-dependency", () => {
    const planPath = join(dirs.backlogDir, "self-ref.md");
    writeFileSync(
      planPath,
      "---\ndepends-on: [self-ref.md]\n---\n# Plan: Self\n",
    );
    const result = planReadiness(planPath, dirs);
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.reasons).toContain("self:self-ref.md");
    }
  });
});

describe("getPlanDescription", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-desc-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts heading from plan file", () => {
    const p = join(tmpDir, "plan.md");
    writeFileSync(p, "# Plan: My Great Feature\n\nSome body text.\n");
    expect(getPlanDescription(p)).toBe("Plan: My Great Feature");
  });

  it("extracts first heading when there are multiple", () => {
    const p = join(tmpDir, "plan.md");
    writeFileSync(p, "# First\n\n## Second\n\n### Third\n");
    expect(getPlanDescription(p)).toBe("First");
  });

  it("handles frontmatter before heading", () => {
    const p = join(tmpDir, "plan.md");
    writeFileSync(
      p,
      "---\nscope: packages/web\n---\n# Plan: Scoped\n\nContent.\n",
    );
    expect(getPlanDescription(p)).toBe("Plan: Scoped");
  });

  it("returns default for nonexistent file", () => {
    expect(getPlanDescription(join(tmpDir, "nope.md"))).toBe("ralphai task");
  });

  it("returns default for file with no heading", () => {
    const p = join(tmpDir, "plan.md");
    writeFileSync(p, "No heading here.\n");
    expect(getPlanDescription(p)).toBe("ralphai task");
  });
});

describe("detectPlan", () => {
  let tmpDir: string;
  let dirs: PipelineDirs;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-detect-"));
    dirs = makeDirs(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns not-detected for empty backlog and no in-progress", () => {
    const result = detectPlan({ dirs });
    expect(result.detected).toBe(false);
    if (!result.detected) {
      expect(result.reason).toBe("empty-backlog");
    }
  });

  it("picks single plan from backlog", () => {
    writeFileSync(join(dirs.backlogDir, "my-plan.md"), "# Plan: My Plan\n");

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("my-plan");
      expect(result.plan.resumed).toBe(false);
    }
    // Plan should have been promoted to in-progress
    expect(existsSync(join(dirs.wipDir, "my-plan", "my-plan.md"))).toBe(true);
    // Backlog file should be gone
    expect(existsSync(join(dirs.backlogDir, "my-plan.md"))).toBe(false);
  });

  it("resumes in-progress plan", () => {
    const slugDir = join(dirs.wipDir, "existing");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "existing.md"), "# Plan: Existing\n");

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("existing");
      expect(result.plan.resumed).toBe(true);
    }
  });

  it("prefers in-progress over backlog", () => {
    // In-progress plan
    const slugDir = join(dirs.wipDir, "active");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "active.md"), "# Plan: Active\n");
    // Backlog plan
    writeFileSync(join(dirs.backlogDir, "waiting.md"), "# Plan: Waiting\n");

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("active");
      expect(result.plan.resumed).toBe(true);
    }
  });

  it("skips plan with unmet dependency, picks ready plan", () => {
    writeFileSync(
      join(dirs.backlogDir, "blocked.md"),
      "---\ndepends-on: [prerequisite.md]\n---\n# Plan: Blocked\n",
    );
    writeFileSync(join(dirs.backlogDir, "ready.md"), "# Plan: Ready\n");

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("ready");
    }
  });

  it("picks plan when dependency is met", () => {
    mkdirSync(join(dirs.archiveDir, "prerequisite"));
    writeFileSync(
      join(dirs.backlogDir, "child.md"),
      "---\ndepends-on: [prerequisite.md]\n---\n# Plan: Child\n",
    );

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("child");
    }
  });

  it("dry-run does not move files", () => {
    writeFileSync(join(dirs.backlogDir, "plan.md"), "# Plan: Dry Run\n");

    const result = detectPlan({ dirs, dryRun: true });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("plan");
    }
    // File should still be in backlog
    expect(existsSync(join(dirs.backlogDir, "plan.md"))).toBe(true);
    // No in-progress folder created
    expect(existsSync(join(dirs.wipDir, "plan"))).toBe(false);
  });

  it("worktree mode only considers matching branch", () => {
    // Two in-progress plans
    const slugA = join(dirs.wipDir, "plan-a");
    mkdirSync(slugA, { recursive: true });
    writeFileSync(join(slugA, "plan-a.md"), "# A\n");

    const slugB = join(dirs.wipDir, "plan-b");
    mkdirSync(slugB, { recursive: true });
    writeFileSync(join(slugB, "plan-b.md"), "# B\n");

    const result = detectPlan({
      dirs,
      worktreeBranch: "ralphai/plan-b",
    });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("plan-b");
      expect(result.plan.resumed).toBe(true);
    }
  });

  it("worktree mode falls through to backlog when branch has no in-progress plan", () => {
    writeFileSync(join(dirs.backlogDir, "new-work.md"), "# New Work\n");

    const result = detectPlan({
      dirs,
      worktreeBranch: "ralphai/no-match",
    });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("new-work");
      expect(result.plan.resumed).toBe(false);
    }
  });

  it("respects skippedSlugs", () => {
    writeFileSync(join(dirs.backlogDir, "skip-me.md"), "# Skip\n");
    writeFileSync(join(dirs.backlogDir, "take-me.md"), "# Take\n");

    const result = detectPlan({
      dirs,
      skippedSlugs: new Set(["skip-me"]),
    });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("take-me");
    }
  });

  it("returns all-blocked when all backlog plans have unmet deps", () => {
    writeFileSync(
      join(dirs.backlogDir, "blocked.md"),
      "---\ndepends-on: [missing.md]\n---\n# Blocked\n",
    );

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(false);
    if (!result.detected) {
      expect(result.reason).toBe("all-blocked");
      expect(result.backlogCount).toBe(1);
      expect(result.blocked).toHaveLength(1);
      expect(result.blocked[0]!.slug).toBe("blocked");
    }
  });

  it("skips in-progress plan with a live runner process", () => {
    // In-progress plan with a "live" runner
    const slugDir = join(dirs.wipDir, "active");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "active.md"), "# Plan: Active\n");

    const result = detectPlan({
      dirs,
      isRunnerAlive: () => true, // simulate live runner
    });

    // Should not resume the in-progress plan — falls through to empty backlog
    expect(result.detected).toBe(false);
    if (!result.detected) {
      expect(result.reason).toBe("empty-backlog");
    }
  });

  it("skips in-progress plan with live runner and picks backlog instead", () => {
    // In-progress plan with a live runner
    const slugDir = join(dirs.wipDir, "active");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "active.md"), "# Plan: Active\n");
    // Backlog plan available
    writeFileSync(join(dirs.backlogDir, "new-work.md"), "# Plan: New Work\n");

    const result = detectPlan({
      dirs,
      isRunnerAlive: () => true,
    });

    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("new-work");
      expect(result.plan.resumed).toBe(false);
    }
  });

  it("resumes in-progress plan with stale runner PID (dead process)", () => {
    const slugDir = join(dirs.wipDir, "stale");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "stale.md"), "# Plan: Stale\n");

    const result = detectPlan({
      dirs,
      isRunnerAlive: () => false, // simulate dead/stale runner
    });

    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("stale");
      expect(result.plan.resumed).toBe(true);
    }
  });

  it("resumes in-progress plan with no runner PID file", () => {
    const slugDir = join(dirs.wipDir, "no-pid");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "no-pid.md"), "# Plan: No PID\n");

    // Default isRunnerAlive reads runner.pid — no file means not alive
    const result = detectPlan({ dirs });

    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("no-pid");
      expect(result.plan.resumed).toBe(true);
    }
  });

  it("liveness check only applies in normal mode, not worktree mode", () => {
    // Worktree mode should NOT apply liveness check because the worktree
    // runner IS the process working on this plan.
    const slugDir = join(dirs.wipDir, "my-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "my-plan.md"), "# Plan\n");

    const result = detectPlan({
      dirs,
      worktreeBranch: "ralphai/my-plan",
      isRunnerAlive: () => true, // even with live runner, worktree mode resumes
    });

    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("my-plan");
      expect(result.plan.resumed).toBe(true);
    }
  });
});

describe("listPlanFolders", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-folders-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty for non-existent dir", () => {
    expect(listPlanFolders(join(tmpDir, "nope"))).toEqual([]);
  });

  it("lists only directories", () => {
    mkdirSync(join(tmpDir, "dir-a"));
    mkdirSync(join(tmpDir, "dir-b"));
    writeFileSync(join(tmpDir, "file.txt"), "not a dir");
    const result = listPlanFolders(tmpDir);
    expect(result).toContain("dir-a");
    expect(result).toContain("dir-b");
    expect(result).not.toContain("file.txt");
  });
});

describe("listPlanSlugs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-slugs-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds slug-folder plans", () => {
    mkdirSync(join(tmpDir, "my-plan"));
    writeFileSync(join(tmpDir, "my-plan", "my-plan.md"), "# Plan\n");
    const result = listPlanSlugs(tmpDir);
    expect(result).toContain("my-plan");
  });

  it("finds flat .md files", () => {
    writeFileSync(join(tmpDir, "flat.md"), "# Flat\n");
    const result = listPlanSlugs(tmpDir);
    expect(result).toContain("flat");
  });

  it("deduplicates slug-folder and flat file", () => {
    mkdirSync(join(tmpDir, "dup"));
    writeFileSync(join(tmpDir, "dup", "dup.md"), "# Dup folder\n");
    writeFileSync(join(tmpDir, "dup.md"), "# Dup flat\n");
    const result = listPlanSlugs(tmpDir);
    expect(result.filter((s) => s === "dup")).toHaveLength(1);
  });

  it("flatOnly skips slug-folders", () => {
    mkdirSync(join(tmpDir, "folder"));
    writeFileSync(join(tmpDir, "folder", "folder.md"), "# Folder\n");
    writeFileSync(join(tmpDir, "flat.md"), "# Flat\n");
    const result = listPlanSlugs(tmpDir, true);
    expect(result).toContain("flat");
    expect(result).not.toContain("folder");
  });
});

describe("countPlanTasks / countCompletedTasks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-count-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts task headings in plan", () => {
    const p = join(tmpDir, "plan.md");
    writeFileSync(
      p,
      "# Plan\n\n### Task 1: First\n\n### Task 2: Second\n\n### Task 3: Third\n",
    );
    expect(countPlanTasks(p)).toBe(3);
  });

  it("returns undefined for nonexistent file", () => {
    expect(countPlanTasks(join(tmpDir, "nope.md"))).toBeUndefined();
  });

  it("returns undefined for plan with no tasks", () => {
    const p = join(tmpDir, "plan.md");
    writeFileSync(p, "# Plan\n\nJust some prose.\n");
    expect(countPlanTasks(p)).toBeUndefined();
  });

  it("counts checkbox tasks in plan", () => {
    const p = join(tmpDir, "plan.md");
    writeFileSync(
      p,
      "# Plan\n\n- [ ] First task\n- [ ] Second task\n- [x] Third task (done)\n",
    );
    expect(countPlanTasks(p)).toBe(3);
  });

  it("counts completed tasks in progress file", () => {
    const p = join(tmpDir, "progress.md");
    writeFileSync(
      p,
      "### Task 1: First\n**Status:** Complete\n\n### Task 2: Second\n**Status:** Complete\n",
    );
    expect(countCompletedTasks(p, "tasks")).toBe(2);
  });

  it("returns 0 for nonexistent progress file", () => {
    expect(countCompletedTasks(join(tmpDir, "nope.md"), "tasks")).toBe(0);
  });
});

// =========================================================================
// Receipt tests
// =========================================================================

// ---------------------------------------------------------------------------
// resolveReceiptPath
// ---------------------------------------------------------------------------

describe("resolveReceiptPath", () => {
  it("returns correct path for a plan slug", () => {
    const result = resolveReceiptPath("/repo/.ralphai", "my-plan");
    expect(result).toBe(
      join(
        "/repo/.ralphai",
        "pipeline",
        "in-progress",
        "my-plan",
        "receipt.txt",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// parseReceipt
// ---------------------------------------------------------------------------

describe("parseReceipt", () => {
  const ctx = useTempDir();

  it("returns null for missing file", () => {
    expect(parseReceipt(join(ctx.dir, "nonexistent.txt"))).toBeNull();
  });

  it("parses a valid receipt file", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-06-15T10:30:00Z",
        "worktree_path=/tmp/wt",
        "branch=feat/dark-mode",
        "slug=dark-mode",
        "plan_file=dark-mode.md",
        "tasks_completed=2",
        "outcome=success",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.started_at).toBe("2025-06-15T10:30:00Z");
    expect(receipt!.worktree_path).toBe("/tmp/wt");
    expect(receipt!.branch).toBe("feat/dark-mode");
    expect(receipt!.slug).toBe("dark-mode");
    expect(receipt!.plan_file).toBe("dark-mode.md");
    expect(receipt!.tasks_completed).toBe(2);
    expect(receipt!.outcome).toBe("success");
  });

  it("handles malformed lines gracefully", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-01-01T00:00:00Z",
        "no-equals-sign-here",
        "",
        "slug=test",
        "=empty-key-ignored",
      ].join("\n"),
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.started_at).toBe("2025-01-01T00:00:00Z");
    expect(receipt!.slug).toBe("test");
    expect(receipt!.branch).toBe("");
    expect(receipt!.tasks_completed).toBe(0);
  });

  it("returns tasks_completed: 0 for non-numeric values (NaN guard)", () => {
    const receiptPath = join(ctx.dir, "receipt-nan.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-01-01T00:00:00Z",
        "branch=main",
        "slug=test",
        "tasks_completed=abc",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.tasks_completed).toBe(0);
  });

  it("handles receipt without optional fields", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-01-01T00:00:00Z",
        "branch=main",
        "slug=test",
        "tasks_completed=0",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.worktree_path).toBeUndefined();
    expect(receipt!.plan_file).toBeUndefined();
    expect(receipt!.outcome).toBeUndefined();
    expect(receipt!.pr_url).toBeUndefined();
    expect(receipt!.sandbox).toBeUndefined();
  });

  it("parses pr_url when present", () => {
    const receiptPath = join(ctx.dir, "receipt-pr.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-06-15T10:30:00Z",
        "branch=feat/dark-mode",
        "slug=dark-mode",
        "tasks_completed=3",
        "pr_url=https://github.com/user/repo/pull/42",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.pr_url).toBe("https://github.com/user/repo/pull/42");
  });

  it("parses sandbox when present", () => {
    const receiptPath = join(ctx.dir, "receipt-sandbox.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-06-15T10:30:00Z",
        "branch=feat/docker-test",
        "slug=docker-test",
        "tasks_completed=1",
        "sandbox=docker",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.sandbox).toBe("docker");
  });

  it("parses sandbox=none when present", () => {
    const receiptPath = join(ctx.dir, "receipt-sandbox-none.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-06-15T10:30:00Z",
        "branch=feat/local-test",
        "slug=local-test",
        "tasks_completed=0",
        "sandbox=none",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.sandbox).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// initReceipt
// ---------------------------------------------------------------------------

describe("initReceipt", () => {
  const ctx = useTempDir();

  it("creates a valid receipt file", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      branch: "feat/my-feature",
      slug: "my-feature",
      plan_file: "my-feature.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("started_at=");
    expect(content).toContain("branch=feat/my-feature");
    expect(content).toContain("slug=my-feature");
    expect(content).toContain("plan_file=my-feature.md");
    expect(content).toContain("tasks_completed=0");
  });

  it("includes worktree_path when provided", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      worktree_path: "/tmp/my-worktree",
      branch: "feat/wt",
      slug: "wt-plan",
      plan_file: "wt-plan.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("worktree_path=/tmp/my-worktree");
  });

  it("omits worktree_path when not provided", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      branch: "main",
      slug: "test",
      plan_file: "test.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).not.toContain("worktree_path=");
  });

  it("includes sandbox when provided", () => {
    const receiptPath = join(ctx.dir, "receipt-sandbox.txt");
    initReceipt(receiptPath, {
      branch: "feat/docker",
      slug: "docker-plan",
      plan_file: "docker-plan.md",
      sandbox: "docker",
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("sandbox=docker");
  });

  it("omits sandbox when not provided", () => {
    const receiptPath = join(ctx.dir, "receipt-no-sandbox.txt");
    initReceipt(receiptPath, {
      branch: "main",
      slug: "test",
      plan_file: "test.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).not.toContain("sandbox=");
  });

  it("generates a valid ISO timestamp", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      branch: "main",
      slug: "test",
      plan_file: "test.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    const match = content.match(/^started_at=(.+)$/m);
    expect(match).not.toBeNull();
    // Should be a valid ISO date ending in Z (no milliseconds)
    expect(match![1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

// ---------------------------------------------------------------------------
// Receipt round-trip
// ---------------------------------------------------------------------------

describe("receipt round-trip", () => {
  const ctx = useTempDir();

  it("init then parse returns matching fields", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      worktree_path: "/home/user/wt",
      branch: "feat/round-trip",
      slug: "round-trip",
      plan_file: "round-trip.md",
    });

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.worktree_path).toBe("/home/user/wt");
    expect(receipt!.branch).toBe("feat/round-trip");
    expect(receipt!.slug).toBe("round-trip");
    expect(receipt!.plan_file).toBe("round-trip.md");
    expect(receipt!.tasks_completed).toBe(0);
    expect(receipt!.outcome).toBeUndefined();
  });

  it("round-trips sandbox field", () => {
    const receiptPath = join(ctx.dir, "receipt-sandbox-rt.txt");
    initReceipt(receiptPath, {
      worktree_path: "/home/user/wt",
      branch: "feat/docker-rt",
      slug: "docker-rt",
      plan_file: "docker-rt.md",
      sandbox: "docker",
    });

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.sandbox).toBe("docker");
    expect(receipt!.slug).toBe("docker-rt");
  });
});

// ---------------------------------------------------------------------------
// updateReceiptTasks
// ---------------------------------------------------------------------------

describe("updateReceiptTasks", () => {
  const ctx = useTempDir();

  it("counts individual Status Complete markers", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    writeFileSync(
      progressPath,
      [
        "## Progress",
        "",
        "### Task 1: A",
        "**Status:** Complete",
        "",
        "### Task 2: B",
        "**Status:** Complete",
      ].join("\n"),
    );

    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("tasks_completed=2");
  });

  it("does not count Tasks X-Y in prose body text", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    writeFileSync(
      progressPath,
      [
        "## Progress",
        "",
        "### Task 1: Refactor",
        "**Status:** Complete",
        "",
        "Refactored validation. CLI parsing moves in Tasks 3-4.",
        "",
        "### Task 2: Extract",
        "**Status:** Complete",
        "",
        "Remaining size includes show-config which moves in Tasks 3-4.",
      ].join("\n"),
    );

    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    // Only 2 individual completions, prose mentions should be ignored
    expect(content).toContain("tasks_completed=2");
  });

  it("appends tasks_completed when field is missing from receipt", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "slug=test\n");
    writeFileSync(progressPath, "### Task 1: Done\n**Status:** Complete\n");

    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("tasks_completed=1");
  });

  it("is a no-op when receipt file does not exist", () => {
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(progressPath, "### Task 1\n**Status:** Complete\n");
    // Should not throw
    updateReceiptTasks(join(ctx.dir, "missing.txt"), progressPath);
  });

  it("is a no-op when progress file does not exist", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    // Should not throw
    updateReceiptTasks(receiptPath, join(ctx.dir, "missing.md"));
    // tasks_completed should remain 0
    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("tasks_completed=0");
  });

  it("counts checked checkboxes when format is 'checkboxes'", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    writeFileSync(
      progressPath,
      [
        "# Progress",
        "",
        "- [x] First task done",
        "- [ ] Second task pending",
        "- [x] Third task done",
        "- [x] Fourth task done",
      ].join("\n"),
    );

    updateReceiptTasks(receiptPath, progressPath, "checkboxes");

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("tasks_completed=3");
  });

  it("defaults to 'tasks' format when format is not specified", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    writeFileSync(
      progressPath,
      [
        "### Task 1: A",
        "**Status:** Complete",
        "",
        "### Task 2: B",
        "**Status:** Complete",
      ].join("\n"),
    );

    // No format argument — should default to "tasks"
    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("tasks_completed=2");
  });
});

// ---------------------------------------------------------------------------
// updateReceiptPrUrl
// ---------------------------------------------------------------------------

describe("updateReceiptPrUrl", () => {
  const ctx = useTempDir();

  it("appends pr_url to receipt without one", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(receiptPath, "slug=test\ntasks_completed=2\n");

    updateReceiptPrUrl(receiptPath, "https://github.com/user/repo/pull/99");

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("pr_url=https://github.com/user/repo/pull/99");
  });

  it("updates existing pr_url in receipt", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      "slug=test\npr_url=https://old-url\ntasks_completed=2\n",
    );

    updateReceiptPrUrl(receiptPath, "https://github.com/user/repo/pull/100");

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("pr_url=https://github.com/user/repo/pull/100");
    expect(content).not.toContain("https://old-url");
  });

  it("is a no-op when receipt file does not exist", () => {
    // Should not throw
    updateReceiptPrUrl(join(ctx.dir, "missing.txt"), "https://example.com");
  });

  it("is a no-op when URL is empty", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(receiptPath, "slug=test\n");

    updateReceiptPrUrl(receiptPath, "");

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).not.toContain("pr_url=");
  });

  it("round-trips through parseReceipt", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-06-15T10:30:00Z",
        "branch=feat/test",
        "slug=test",
        "tasks_completed=3",
      ].join("\n") + "\n",
    );

    updateReceiptPrUrl(receiptPath, "https://github.com/user/repo/pull/7");

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.pr_url).toBe("https://github.com/user/repo/pull/7");
    expect(receipt!.slug).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// checkReceiptSource
// ---------------------------------------------------------------------------

describe("checkReceiptSource", () => {
  const ctx = useTempDir();

  it("returns true when wip directory does not exist", () => {
    expect(checkReceiptSource(join(ctx.dir, "nonexistent"), false)).toBe(true);
  });

  it("returns true when receipt has no worktree_path and running from main", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "slug=test-plan\nbranch=main\n",
    );

    expect(checkReceiptSource(wipDir, false)).toBe(true);
  });

  it("returns true when receipt has worktree_path and running in worktree", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "slug=test-plan\nbranch=feat/x\nworktree_path=/tmp/wt\n",
    );

    expect(checkReceiptSource(wipDir, true)).toBe(true);
  });

  it("blocks when receipt has worktree_path but running from main", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      [
        "slug=test-plan",
        "branch=feat/x",
        "worktree_path=/tmp/wt",
        "started_at=2025-01-01T00:00:00Z",
      ].join("\n") + "\n",
    );

    // Suppress console.error output during test
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const result = checkReceiptSource(wipDir, false);
    spy.mockRestore();

    expect(result).toBe(false);
  });

  it("returns true when receipt has no source conflict", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "plan-a");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "receipt.txt"), "slug=plan-a\nbranch=main\n");

    // Running from main, receipt says main: no conflict
    expect(checkReceiptSource(wipDir, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findPlansByBranch
// ---------------------------------------------------------------------------

describe("findPlansByBranch", () => {
  const ctx = useTempDir();

  it("returns empty array when in-progress directory does not exist", () => {
    const result = findPlansByBranch(
      join(ctx.dir, "nonexistent"),
      "feat/prd-x",
    );
    expect(result).toEqual([]);
  });

  it("returns empty array when no receipts exist", () => {
    const wipDir = join(ctx.dir, "in-progress");
    mkdirSync(wipDir, { recursive: true });

    const result = findPlansByBranch(wipDir, "feat/prd-x");
    expect(result).toEqual([]);
  });

  it("returns matching slug for one matching receipt", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "plan-a");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "slug=plan-a\nbranch=feat/prd-x\n",
    );

    const result = findPlansByBranch(wipDir, "feat/prd-x");
    expect(result).toEqual(["plan-a"]);
  });

  it("returns multiple matching slugs for the same branch", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const dirA = join(wipDir, "plan-a");
    const dirB = join(wipDir, "plan-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(
      join(dirA, "receipt.txt"),
      "slug=plan-a\nbranch=feat/prd-shared\n",
    );
    writeFileSync(
      join(dirB, "receipt.txt"),
      "slug=plan-b\nbranch=feat/prd-shared\n",
    );

    const result = findPlansByBranch(wipDir, "feat/prd-shared");
    expect(result).toHaveLength(2);
    expect(result).toContain("plan-a");
    expect(result).toContain("plan-b");
  });

  it("returns empty array when no receipts match the branch", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "plan-c");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "slug=plan-c\nbranch=ralphai/plan-c\n",
    );

    const result = findPlansByBranch(wipDir, "feat/other-branch");
    expect(result).toEqual([]);
  });

  it("filters correctly with mixed receipts", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const dirA = join(wipDir, "plan-a");
    const dirB = join(wipDir, "plan-b");
    const dirC = join(wipDir, "plan-c");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    mkdirSync(dirC, { recursive: true });
    writeFileSync(
      join(dirA, "receipt.txt"),
      "slug=plan-a\nbranch=feat/prd-target\n",
    );
    writeFileSync(
      join(dirB, "receipt.txt"),
      "slug=plan-b\nbranch=ralphai/plan-b\n",
    );
    writeFileSync(
      join(dirC, "receipt.txt"),
      "slug=plan-c\nbranch=feat/prd-target\n",
    );

    const result = findPlansByBranch(wipDir, "feat/prd-target");
    expect(result).toHaveLength(2);
    expect(result).toContain("plan-a");
    expect(result).toContain("plan-c");
  });

  it("skips directories without receipt files", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const dirA = join(wipDir, "plan-a");
    const dirB = join(wipDir, "plan-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(
      join(dirA, "receipt.txt"),
      "slug=plan-a\nbranch=feat/prd-x\n",
    );
    // plan-b has no receipt file

    const result = findPlansByBranch(wipDir, "feat/prd-x");
    expect(result).toEqual(["plan-a"]);
  });
});

// =========================================================================
// Global state tests
// =========================================================================

describe("getRalphaiHome", () => {
  it("returns $RALPHAI_HOME when set", () => {
    expect(getRalphaiHome({ RALPHAI_HOME: "/custom/home" })).toBe(
      "/custom/home",
    );
  });

  it("returns ~/.ralphai when RALPHAI_HOME is not set", () => {
    expect(getRalphaiHome({})).toBe(join(homedir(), ".ralphai"));
  });

  it("ignores empty RALPHAI_HOME", () => {
    expect(getRalphaiHome({ RALPHAI_HOME: "" })).toBe(
      join(homedir(), ".ralphai"),
    );
  });
});

describe("getRepoId", () => {
  const ctx = useTempGitDir();

  it("slugifies an HTTPS remote URL", () => {
    execSync('git remote add origin "https://github.com/mfaux/ralphai.git"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    expect(getRepoId(ctx.dir)).toBe("github-com-mfaux-ralphai");
  });

  it("slugifies an SSH remote URL", () => {
    execSync('git remote add origin "git@github.com:mfaux/ralphai.git"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    expect(getRepoId(ctx.dir)).toBe("github-com-mfaux-ralphai");
  });

  it("falls back to _path-<hash> when no remote exists", () => {
    const id = getRepoId(ctx.dir);
    expect(id).toMatch(/^_path-[a-f0-9]{12}$/);
  });

  it("produces stable path-based IDs for the same directory", () => {
    const id1 = getRepoId(ctx.dir);
    const id2 = getRepoId(ctx.dir);
    expect(id1).toBe(id2);
  });

  it("uses the same path fallback ID in a git worktree and main repo", () => {
    execSync("git config user.name 'Test'", { cwd: ctx.dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    execSync("git commit --allow-empty -m init", {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    const worktreeDir = join(ctx.dir, "wt-id-test");
    execSync(`git worktree add "${worktreeDir}" -b wt-id-test`, {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    try {
      expect(getRepoId(worktreeDir)).toBe(getRepoId(ctx.dir));
    } finally {
      execSync(`git worktree remove "${worktreeDir}" --force`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
      if (existsSync(worktreeDir)) {
        rmSync(worktreeDir, { recursive: true, force: true });
      }
    }
  });

  it("slugifies ssh:// protocol URLs", () => {
    execSync('git remote add origin "ssh://git@github.com/mfaux/ralphai.git"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    expect(getRepoId(ctx.dir)).toBe("github-com-mfaux-ralphai");
  });

  it("handles URLs without .git suffix", () => {
    execSync('git remote add origin "https://github.com/mfaux/ralphai"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    expect(getRepoId(ctx.dir)).toBe("github-com-mfaux-ralphai");
  });
});

describe("resolveRepoStateDir", () => {
  const ctx = useTempDir();

  it("returns a path under RALPHAI_HOME without creating it", () => {
    const home = join(ctx.dir, "ralphai-home-resolve");
    const dir = resolveRepoStateDir(ctx.dir, { RALPHAI_HOME: home });
    expect(dir).toContain(join("repos", "_path-"));
    expect(existsSync(dir)).toBe(false);
  });
});

describe("ensureRepoStateDir", () => {
  const ctx = useTempDir();

  it("creates the repo state directory under RALPHAI_HOME", () => {
    const home = join(ctx.dir, "ralphai-home");
    const dir = ensureRepoStateDir(ctx.dir, { RALPHAI_HOME: home });
    expect(dir).toMatch(new RegExp(`^${home.replace(/[/\\]/g, ".")}`));
    expect(existsSync(dir)).toBe(true);
  });

  it("nests under repos/<repoId>", () => {
    const home = join(ctx.dir, "ralphai-home");
    const dir = ensureRepoStateDir(ctx.dir, { RALPHAI_HOME: home });
    expect(dir).toContain(join("repos", "_path-"));
  });

  it("uses the same state dir in a git worktree and main repo", () => {
    const repoDir = join(ctx.dir, "repo");
    mkdirSync(repoDir, { recursive: true });
    execSync("git init", { cwd: repoDir, stdio: "ignore" });
    execSync("git config user.name 'Test'", { cwd: repoDir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: repoDir,
      stdio: "ignore",
    });
    execSync("git commit --allow-empty -m init", {
      cwd: repoDir,
      stdio: "ignore",
    });

    const worktreeDir = join(ctx.dir, "repo-wt");
    execSync(`git worktree add "${worktreeDir}" -b wt-state-test`, {
      cwd: repoDir,
      stdio: "ignore",
    });

    const home = join(ctx.dir, "ralphai-home");
    try {
      expect(ensureRepoStateDir(worktreeDir, { RALPHAI_HOME: home })).toBe(
        ensureRepoStateDir(repoDir, { RALPHAI_HOME: home }),
      );
    } finally {
      execSync(`git worktree remove "${worktreeDir}" --force`, {
        cwd: repoDir,
        stdio: "ignore",
      });
      if (existsSync(worktreeDir)) {
        rmSync(worktreeDir, { recursive: true, force: true });
      }
    }
  });
});

describe("getRepoPipelineDirs", () => {
  const ctx = useTempDir();

  it("creates backlog, in-progress, and out directories", () => {
    const home = join(ctx.dir, "ralphai-home");
    const dirs = getRepoPipelineDirs(ctx.dir, { RALPHAI_HOME: home });
    expect(existsSync(dirs.backlogDir)).toBe(true);
    expect(existsSync(dirs.wipDir)).toBe(true);
    expect(existsSync(dirs.archiveDir)).toBe(true);
    expect(dirs.backlogDir).toContain(join("pipeline", "backlog"));
    expect(dirs.wipDir).toContain(join("pipeline", "in-progress"));
    expect(dirs.archiveDir).toContain(join("pipeline", "out"));
  });
});

// ---------------------------------------------------------------------------
// No global state leak to real ~/.ralphai
// ---------------------------------------------------------------------------

describe("no global state leak to real ~/.ralphai", () => {
  const ctx = useTempGitDir();

  /** Snapshot entry names in the real repos directory. */
  function snapshotRealRepos(): Set<string> {
    const realReposDir = join(homedir(), ".ralphai", "repos");
    if (!existsSync(realReposDir)) return new Set();
    return new Set(readdirSync(realReposDir));
  }

  it("ensureRepoStateDir with RALPHAI_HOME does not write to ~/.ralphai", () => {
    const before = snapshotRealRepos();

    const home = join(ctx.dir, "ralphai-home-leak-test");
    ensureRepoStateDir(ctx.dir, { RALPHAI_HOME: home });

    const after = snapshotRealRepos();
    const leaked = [...after].filter((e) => !before.has(e));
    expect(leaked).toEqual([]);
  });

  it("getRepoPipelineDirs with RALPHAI_HOME does not write to ~/.ralphai", () => {
    const before = snapshotRealRepos();

    const home = join(ctx.dir, "ralphai-home-leak-test");
    getRepoPipelineDirs(ctx.dir, { RALPHAI_HOME: home });

    const after = snapshotRealRepos();
    const leaked = [...after].filter((e) => !before.has(e));
    expect(leaked).toEqual([]);
  });

  it("runCliInProcess init --yes with RALPHAI_HOME does not leak to ~/.ralphai", async () => {
    const before = snapshotRealRepos();

    const home = join(ctx.dir, "ralphai-home-leak-test");
    await runCliInProcess(["init", "--yes"], ctx.dir, {
      RALPHAI_HOME: home,
    });

    const after = snapshotRealRepos();
    const leaked = [...after].filter((e) => !before.has(e));
    expect(leaked).toEqual([]);
  });
});

// =========================================================================
// Pipeline state tests
// =========================================================================

describe("gatherPipelineState", () => {
  const ctx = useTempDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Ensure pipeline directories exist and return them. */
  function setupPipeline() {
    return getRepoPipelineDirs(ctx.dir, testEnv());
  }

  /** Create a backlog plan file (flat .md in backlog dir). */
  function createBacklogPlan(
    backlogDir: string,
    slug: string,
    opts?: { scope?: string; dependsOn?: string[] },
  ): void {
    const lines: string[] = [];
    if (opts?.scope || opts?.dependsOn) {
      lines.push("---");
      if (opts.scope) lines.push(`scope: ${opts.scope}`);
      if (opts.dependsOn && opts.dependsOn.length > 0) {
        lines.push(`depends-on: [${opts.dependsOn.join(", ")}]`);
      }
      lines.push("---");
    }
    lines.push(`# ${slug}`);
    lines.push("");
    lines.push("### Task 1: Do something");
    lines.push("### Task 2: Do another thing");
    writeFileSync(join(backlogDir, `${slug}.md`), lines.join("\n") + "\n");
  }

  /** Create an in-progress plan with slug-folder structure. */
  function createInProgressPlan(
    ipDir: string,
    slug: string,
    opts?: {
      pid?: string;
      outcome?: string;
      scope?: string;
      tasksCompleted?: number;
      worktreePath?: string;
      taskCount?: number;
    },
  ): void {
    const planDir = join(ipDir, slug);
    mkdirSync(planDir, { recursive: true });

    const planLines: string[] = [];
    if (opts?.scope) {
      planLines.push("---");
      planLines.push(`scope: ${opts.scope}`);
      planLines.push("---");
    }
    planLines.push(`# ${slug}`);
    planLines.push("");
    const taskCount = opts?.taskCount ?? 3;
    for (let i = 1; i <= taskCount; i++) {
      planLines.push(`### Task ${i}: Task ${i}`);
    }
    writeFileSync(join(planDir, `${slug}.md`), planLines.join("\n") + "\n");

    const receiptLines = [
      "started_at=2026-03-07T12:00:00Z",
      `branch=ralphai/${slug}`,
      `slug=${slug}`,
      `plan_file=${slug}.md`,
      `tasks_completed=${opts?.tasksCompleted ?? 0}`,
    ];
    if (opts?.outcome) {
      receiptLines.push(`outcome=${opts.outcome}`);
    }
    if (opts?.worktreePath) {
      receiptLines.push(`worktree_path=${opts.worktreePath}`);
    }
    writeFileSync(join(planDir, "receipt.txt"), receiptLines.join("\n") + "\n");

    if (opts?.pid !== undefined) {
      writeFileSync(join(planDir, "runner.pid"), opts.pid);
    }
  }

  /** Create a completed plan (slug-folder in archive dir). */
  function createCompletedPlan(archiveDir: string, slug: string): void {
    const planDir = join(archiveDir, slug);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, `${slug}.md`), `# ${slug}\n`);
  }

  it("returns structured data with plans in all directories", () => {
    const { backlogDir, wipDir: ipDir, archiveDir } = setupPipeline();

    createBacklogPlan(backlogDir, "plan-a", { scope: "packages/web" });
    createBacklogPlan(backlogDir, "plan-b", {
      dependsOn: ["plan-a.md"],
    });
    createInProgressPlan(ipDir, "plan-c", {
      scope: "packages/api",
      tasksCompleted: 1,
    });
    createCompletedPlan(archiveDir, "plan-d");

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    // Backlog
    expect(state.backlog).toHaveLength(2);
    const planA = state.backlog.find((p) => p.filename === "plan-a.md");
    const planB = state.backlog.find((p) => p.filename === "plan-b.md");
    expect(planA).toBeDefined();
    expect(planA!.scope).toBe("packages/web");
    expect(planA!.dependsOn).toEqual([]);
    expect(planB).toBeDefined();
    expect(planB!.dependsOn).toEqual(["plan-a.md"]);

    // In progress
    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.filename).toBe("plan-c.md");
    expect(state.inProgress[0]!.slug).toBe("plan-c");
    expect(state.inProgress[0]!.scope).toBe("packages/api");
    expect(state.inProgress[0]!.totalTasks).toBe(3);
    expect(state.inProgress[0]!.tasksCompleted).toBe(1);

    // Completed
    expect(state.completedSlugs).toEqual(["plan-d"]);

    // No worktrees passed
    expect(state.worktrees).toEqual([]);

    // No problems
    expect(state.problems).toEqual([]);
  });

  it("shows running liveness when PID is alive", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "live-plan", {
      pid: String(process.pid),
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.liveness).toEqual({
      tag: "running",
      pid: process.pid,
    });
  });

  it("shows stalled liveness when PID is dead", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "dead-plan", {
      pid: "999999999",
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.liveness).toEqual({ tag: "stalled" });
  });

  it("shows in_progress liveness when no runner.pid exists", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "no-pid-plan");

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.liveness).toEqual({ tag: "in_progress" });
  });

  it("uses outcome from receipt over PID liveness", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "stuck-plan", {
      pid: String(process.pid),
      outcome: "stuck",
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.liveness).toEqual({
      tag: "outcome",
      outcome: "stuck",
    });
  });

  it("extracts scope from backlog and in-progress plans", () => {
    const { backlogDir, wipDir: ipDir } = setupPipeline();

    createBacklogPlan(backlogDir, "scoped-backlog", {
      scope: "packages/core",
    });
    createInProgressPlan(ipDir, "scoped-wip", {
      scope: "packages/web",
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.backlog[0]!.scope).toBe("packages/core");
    expect(state.inProgress[0]!.scope).toBe("packages/web");
  });

  it("extracts dependency info from backlog plans", () => {
    const { backlogDir } = setupPipeline();

    createBacklogPlan(backlogDir, "dep-plan", {
      dependsOn: ["prereq-a.md", "prereq-b.md"],
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.backlog[0]!.dependsOn).toEqual(["prereq-a.md", "prereq-b.md"]);
  });

  it("counts total tasks and completed tasks", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "task-plan", {
      taskCount: 5,
      tasksCompleted: 3,
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress[0]!.totalTasks).toBe(5);
    expect(state.inProgress[0]!.tasksCompleted).toBe(3);
  });

  it("determines worktree active plan state", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "active-wt", {});

    const state = gatherPipelineState(ctx.dir, {
      env: testEnv(),
      worktrees: [
        { path: "/tmp/wt-active", branch: "ralphai/active-wt" },
        { path: "/tmp/wt-idle", branch: "ralphai/no-such-plan" },
      ],
    });

    expect(state.worktrees).toHaveLength(2);
    expect(state.worktrees[0]!.hasActivePlan).toBe(true);
    expect(state.worktrees[1]!.hasActivePlan).toBe(false);
  });

  it("sets hasWorktree from receipt worktree_path", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "wt-plan", {
      worktreePath: "/tmp/some-worktree",
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress[0]!.hasWorktree).toBe(true);
  });

  it("sets hasWorktree to false when no worktree_path in receipt", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "no-wt-plan", {});

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress[0]!.hasWorktree).toBe(false);
  });

  it("detects orphaned receipts (receipt without matching plan file)", () => {
    const { wipDir: ipDir } = setupPipeline();

    // Create a slug folder with receipt but no plan file
    const slug = "orphan-plan";
    const planDir = join(ipDir, slug);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        `branch=ralphai/${slug}`,
        `slug=${slug}`,
        `plan_file=${slug}.md`,
        "tasks_completed=0",
      ].join("\n") + "\n",
    );
    // No plan file created — this is the orphaned case

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.problems.length).toBeGreaterThanOrEqual(1);
    expect(state.problems[0]!.message).toContain("Orphaned receipt");
    expect(state.problems[0]!.message).toContain(slug);
  });

  it("detects missing worktree directories", () => {
    setupPipeline();

    const state = gatherPipelineState(ctx.dir, {
      env: testEnv(),
      worktrees: [
        {
          path: "/tmp/definitely-does-not-exist-12345",
          branch: "ralphai/missing-wt",
        },
      ],
    });

    expect(state.problems.length).toBeGreaterThanOrEqual(1);
    const wtProblem = state.problems.find((p) =>
      p.message.includes("Missing worktree directory"),
    );
    expect(wtProblem).toBeDefined();
    expect(wtProblem!.message).toContain(
      "/tmp/definitely-does-not-exist-12345",
    );
  });

  it("returns empty state when pipeline has no plans", () => {
    setupPipeline();

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.backlog).toEqual([]);
    expect(state.inProgress).toEqual([]);
    expect(state.completedSlugs).toEqual([]);
    expect(state.worktrees).toEqual([]);
    expect(state.problems).toEqual([]);
  });

  it("returns completed slugs sorted alphabetically", () => {
    const { archiveDir } = setupPipeline();

    createCompletedPlan(archiveDir, "zebra");
    createCompletedPlan(archiveDir, "alpha");
    createCompletedPlan(archiveDir, "mango");

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.completedSlugs).toEqual(["alpha", "mango", "zebra"]);
  });
});
