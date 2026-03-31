import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  collectBacklogPlans,
  checkDependencyStatus,
  planReadiness,
  detectPlan,
  getPlanDescription,
  listPlanFolders,
  listPlanSlugs,
  countPlanTasks,
  countCompletedTasks,
  type PipelineDirs,
} from "./plan-detection.ts";

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
    expect(countCompletedTasks(p)).toBe(2);
  });

  it("counts batch task headings (range only, no Status line)", () => {
    const p = join(tmpDir, "progress.md");
    // Batch entry: the range 1-3 contributes 3, with no separate Status line
    writeFileSync(p, "### Tasks 1\u20133: Batch work\nDid things.\n");
    expect(countCompletedTasks(p)).toBe(3);
  });

  it("returns 0 for nonexistent progress file", () => {
    expect(countCompletedTasks(join(tmpDir, "nope.md"))).toBe(0);
  });
});
