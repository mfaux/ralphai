/**
 * Tests for plan-lifecycle fixture builders.
 *
 * Verifies that each builder returns structurally valid objects and
 * that overrides work correctly.
 */
import { describe, it, expect } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import {
  makePlanFrontmatter,
  makeIssueFrontmatter,
  makeReceipt,
  makeInitReceiptFields,
  makeBacklogPlan,
  makeInProgressPlan,
  makeWorktreeEntry,
  makeWorktreeState,
  makePipelineState,
  makePlanFormatResult,
  buildPlanMarkdown,
} from "./plan-lifecycle.fixtures.ts";
import { parseFrontmatter, extractDependsOn } from "./plan-lifecycle.ts";
import { useTempDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Frontmatter fixtures
// ---------------------------------------------------------------------------

describe("makePlanFrontmatter", () => {
  it("returns defaults", () => {
    const fm = makePlanFrontmatter();
    expect(fm.scope).toBe("");
    expect(fm.feedbackScope).toBe("");
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
    expect(fm.prd).toBeUndefined();
    expect(fm.priority).toBe(0);
    expect(fm.tags).toEqual([]);
  });

  it("applies overrides", () => {
    const fm = makePlanFrontmatter({
      scope: "api",
      issue: 42,
      dependsOn: ["dep-a"],
    });
    expect(fm.scope).toBe("api");
    expect(fm.issue).toBe(42);
    expect(fm.dependsOn).toEqual(["dep-a"]);
    // non-overridden fields keep defaults
    expect(fm.feedbackScope).toBe("");
  });
});

describe("makeIssueFrontmatter", () => {
  it("returns defaults", () => {
    const fm = makeIssueFrontmatter();
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
    expect(fm.prd).toBeUndefined();
  });

  it("applies overrides", () => {
    const fm = makeIssueFrontmatter({ source: "github", issue: 10 });
    expect(fm.source).toBe("github");
    expect(fm.issue).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Receipt fixtures
// ---------------------------------------------------------------------------

describe("makeReceipt", () => {
  it("returns defaults", () => {
    const r = makeReceipt();
    expect(r.started_at).toBe("2025-01-01T00:00:00.000Z");
    expect(r.branch).toBe("feat/test-plan");
    expect(r.slug).toBe("test-plan");
    expect(r.tasks_completed).toBe(0);
  });

  it("applies overrides", () => {
    const r = makeReceipt({ tasks_completed: 5, pr_url: "https://pr" });
    expect(r.tasks_completed).toBe(5);
    expect(r.pr_url).toBe("https://pr");
  });
});

describe("makeInitReceiptFields", () => {
  it("returns defaults", () => {
    const f = makeInitReceiptFields();
    expect(f.branch).toBe("feat/test-plan");
    expect(f.slug).toBe("test-plan");
    expect(f.plan_file).toBe("plan.md");
  });

  it("applies overrides", () => {
    const f = makeInitReceiptFields({ sandbox: "docker" });
    expect(f.sandbox).toBe("docker");
  });
});

// ---------------------------------------------------------------------------
// Pipeline state fixtures
// ---------------------------------------------------------------------------

describe("makeBacklogPlan", () => {
  it("returns defaults", () => {
    const p = makeBacklogPlan();
    expect(p.filename).toBe("plan-1.md");
    expect(p.scope).toBe("");
    expect(p.dependsOn).toEqual([]);
  });

  it("applies overrides", () => {
    const p = makeBacklogPlan({ filename: "custom.md", scope: "api" });
    expect(p.filename).toBe("custom.md");
    expect(p.scope).toBe("api");
  });
});

describe("makeInProgressPlan", () => {
  it("returns defaults", () => {
    const p = makeInProgressPlan();
    expect(p.slug).toBe("plan-1");
    expect(p.tasksCompleted).toBe(0);
    expect(p.hasWorktree).toBe(false);
    expect(p.liveness).toEqual({ tag: "in_progress" });
  });

  it("applies overrides", () => {
    const p = makeInProgressPlan({
      slug: "my-plan",
      liveness: { tag: "running", pid: 1234 },
    });
    expect(p.slug).toBe("my-plan");
    expect(p.liveness).toEqual({ tag: "running", pid: 1234 });
  });
});

describe("makeWorktreeEntry", () => {
  it("returns defaults", () => {
    const e = makeWorktreeEntry();
    expect(e.path).toBe("/tmp/worktree");
    expect(e.branch).toBe("feat/test");
  });
});

describe("makeWorktreeState", () => {
  it("returns defaults", () => {
    const s = makeWorktreeState();
    expect(s.entry.path).toBe("/tmp/worktree");
    expect(s.hasActivePlan).toBe(false);
  });

  it("accepts entry override", () => {
    const s = makeWorktreeState({
      entry: makeWorktreeEntry({ branch: "fix/bug" }),
      hasActivePlan: true,
    });
    expect(s.entry.branch).toBe("fix/bug");
    expect(s.hasActivePlan).toBe(true);
  });
});

describe("makePipelineState", () => {
  it("returns empty defaults", () => {
    const s = makePipelineState();
    expect(s.backlog).toEqual([]);
    expect(s.inProgress).toEqual([]);
    expect(s.completedSlugs).toEqual([]);
    expect(s.worktrees).toEqual([]);
    expect(s.problems).toEqual([]);
  });

  it("applies overrides", () => {
    const s = makePipelineState({
      backlog: [makeBacklogPlan()],
      completedSlugs: ["done-1"],
    });
    expect(s.backlog).toHaveLength(1);
    expect(s.completedSlugs).toEqual(["done-1"]);
  });
});

describe("makePlanFormatResult", () => {
  it("returns defaults", () => {
    const r = makePlanFormatResult();
    expect(r.format).toBe("tasks");
    expect(r.totalTasks).toBe(0);
  });

  it("applies overrides", () => {
    const r = makePlanFormatResult({ format: "checkboxes", totalTasks: 5 });
    expect(r.format).toBe("checkboxes");
    expect(r.totalTasks).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------

describe("buildPlanMarkdown", () => {
  const ctx = useTempDir();

  it("builds minimal plan without frontmatter", () => {
    const md = buildPlanMarkdown();
    expect(md).toContain("# Test Plan");
    expect(md).not.toContain("---");
  });

  it("builds plan with frontmatter and parses correctly", () => {
    const md = buildPlanMarkdown({
      title: "My Feature",
      scope: "api",
      dependsOn: ["dep-a", "dep-b"],
      source: "github",
      issue: 42,
      issueUrl: "https://github.com/o/r/issues/42",
      prd: 10,
    });

    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, md);

    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("api");
    expect(fm.source).toBe("github");
    expect(fm.issue).toBe(42);
    expect(fm.prd).toBe(10);

    const deps = extractDependsOn(p);
    expect(deps).toEqual(["dep-a", "dep-b"]);
  });

  it("includes body text", () => {
    const md = buildPlanMarkdown({ body: "Some description here." });
    expect(md).toContain("Some description here.");
  });
});
