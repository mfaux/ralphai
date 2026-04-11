/**
 * Tests for plan priority sorting and tag filtering.
 *
 * Covers: extractPriority, extractTags, priority-based collectBacklogPlans
 * sorting, tag filtering in detectPlan, --tags CLI flag, and interactions.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { useTempDir } from "./test-utils.ts";
import { buildPlanMarkdown } from "./plan-lifecycle.fixtures.ts";

import {
  extractPriority,
  extractTags,
  parseFrontmatter,
  collectBacklogPlans,
  detectPlan,
  type PipelineDirs,
} from "./plan-lifecycle.ts";

// =========================================================================
// extractPriority
// =========================================================================

describe("extractPriority", () => {
  const ctx = useTempDir();

  it("returns 0 for missing file", () => {
    expect(extractPriority(join(ctx.dir, "nope.md"))).toBe(0);
  });

  it("returns 0 when no priority frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: web\n---\n\n# Plan\n");
    expect(extractPriority(p)).toBe(0);
  });

  it("returns 0 when no frontmatter at all", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Plan\n");
    expect(extractPriority(p)).toBe(0);
  });

  it("parses positive integer priority", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\npriority: 10\n---\n\n# Plan\n");
    expect(extractPriority(p)).toBe(10);
  });

  it("parses negative priority", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\npriority: -5\n---\n\n# Plan\n");
    expect(extractPriority(p)).toBe(-5);
  });

  it("parses zero priority", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\npriority: 0\n---\n\n# Plan\n");
    expect(extractPriority(p)).toBe(0);
  });

  it("returns 0 for non-numeric priority", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\npriority: high\n---\n\n# Plan\n");
    expect(extractPriority(p)).toBe(0);
  });
});

// =========================================================================
// extractTags
// =========================================================================

describe("extractTags", () => {
  const ctx = useTempDir();

  it("returns [] for missing file", () => {
    expect(extractTags(join(ctx.dir, "nope.md"))).toEqual([]);
  });

  it("returns [] when no tags frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: web\n---\n\n# Plan\n");
    expect(extractTags(p)).toEqual([]);
  });

  it("returns [] when no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Plan\n");
    expect(extractTags(p)).toEqual([]);
  });

  it("parses inline array tags", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ntags: [frontend, auth]\n---\n\n# Plan\n");
    expect(extractTags(p)).toEqual(["frontend", "auth"]);
  });

  it("parses single inline tag", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ntags: [backend]\n---\n\n# Plan\n");
    expect(extractTags(p)).toEqual(["backend"]);
  });

  it("parses multiline YAML list tags", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ntags:\n  - frontend\n  - auth\n---\n\n# Plan\n");
    expect(extractTags(p)).toEqual(["frontend", "auth"]);
  });

  it("handles empty inline array", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ntags: []\n---\n\n# Plan\n");
    expect(extractTags(p)).toEqual([]);
  });

  it("strips quotes from tags", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ntags: [\"frontend\", 'auth']\n---\n\n# Plan\n");
    expect(extractTags(p)).toEqual(["frontend", "auth"]);
  });
});

// =========================================================================
// parseFrontmatter with priority and tags
// =========================================================================

describe("parseFrontmatter (priority + tags)", () => {
  const ctx = useTempDir();

  it("includes priority and tags defaults", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: web\n---\n\n# Plan\n");
    const fm = parseFrontmatter(p);
    expect(fm.priority).toBe(0);
    expect(fm.tags).toEqual([]);
  });

  it("parses priority and tags together", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\npriority: 5\ntags: [frontend, auth]\n---\n\n# Plan\n",
    );
    const fm = parseFrontmatter(p);
    expect(fm.priority).toBe(5);
    expect(fm.tags).toEqual(["frontend", "auth"]);
  });

  it("returns priority 0 and empty tags for nonexistent file", () => {
    const fm = parseFrontmatter(join(ctx.dir, "nope.md"));
    expect(fm.priority).toBe(0);
    expect(fm.tags).toEqual([]);
  });
});

// =========================================================================
// collectBacklogPlans priority sorting
// =========================================================================

describe("collectBacklogPlans (priority sorting)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-prio-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sorts by priority then filename", () => {
    const dir = join(tmpDir, "backlog");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "z-plan.md"),
      buildPlanMarkdown({ title: "Z", priority: 1 }),
    );
    writeFileSync(
      join(dir, "a-plan.md"),
      buildPlanMarkdown({ title: "A", priority: 2 }),
    );
    writeFileSync(
      join(dir, "m-plan.md"),
      buildPlanMarkdown({ title: "M", priority: 1 }),
    );

    const result = collectBacklogPlans(dir);
    expect(result).toEqual([
      join(dir, "m-plan.md"), // priority 1, 'm' < 'z'
      join(dir, "z-plan.md"), // priority 1, 'z'
      join(dir, "a-plan.md"), // priority 2
    ]);
  });

  it("same priority falls back to alphabetical", () => {
    const dir = join(tmpDir, "backlog");
    mkdirSync(dir);
    writeFileSync(join(dir, "c-plan.md"), buildPlanMarkdown({ title: "C" }));
    writeFileSync(join(dir, "a-plan.md"), buildPlanMarkdown({ title: "A" }));
    writeFileSync(join(dir, "b-plan.md"), buildPlanMarkdown({ title: "B" }));

    const result = collectBacklogPlans(dir);
    // All priority 0 (implicit), so alphabetical
    expect(result).toEqual([
      join(dir, "a-plan.md"),
      join(dir, "b-plan.md"),
      join(dir, "c-plan.md"),
    ]);
  });

  it("no priority = implicit 0, sorted before higher values", () => {
    const dir = join(tmpDir, "backlog");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "later.md"),
      buildPlanMarkdown({ title: "Later", priority: 10 }),
    );
    writeFileSync(
      join(dir, "first.md"),
      buildPlanMarkdown({ title: "First" }), // no priority = 0
    );

    const result = collectBacklogPlans(dir);
    expect(result).toEqual([
      join(dir, "first.md"), // priority 0 (implicit)
      join(dir, "later.md"), // priority 10
    ]);
  });

  it("drains in priority order across multiple values", () => {
    const dir = join(tmpDir, "backlog");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "p3.md"),
      buildPlanMarkdown({ title: "P3", priority: 3 }),
    );
    writeFileSync(
      join(dir, "p1.md"),
      buildPlanMarkdown({ title: "P1", priority: 1 }),
    );
    writeFileSync(
      join(dir, "p2.md"),
      buildPlanMarkdown({ title: "P2", priority: 2 }),
    );
    writeFileSync(
      join(dir, "p0.md"),
      buildPlanMarkdown({ title: "P0" }), // implicit 0
    );

    const result = collectBacklogPlans(dir);
    expect(result).toEqual([
      join(dir, "p0.md"),
      join(dir, "p1.md"),
      join(dir, "p2.md"),
      join(dir, "p3.md"),
    ]);
  });
});

// =========================================================================
// detectPlan tag filtering
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

describe("detectPlan (tag filtering)", () => {
  let tmpDir: string;
  let dirs: PipelineDirs;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-tags-"));
    dirs = makeDirs(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("filters plans matching any specified tag (OR semantics)", () => {
    writeFileSync(
      join(dirs.backlogDir, "fe-plan.md"),
      buildPlanMarkdown({ title: "Frontend", tags: ["frontend"] }),
    );
    writeFileSync(
      join(dirs.backlogDir, "be-plan.md"),
      buildPlanMarkdown({ title: "Backend", tags: ["backend"] }),
    );

    const result = detectPlan({
      dirs,
      dryRun: true,
      filterTags: ["frontend"],
    });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("fe-plan");
    }
  });

  it("skips plans that don't match any tag", () => {
    writeFileSync(
      join(dirs.backlogDir, "be-plan.md"),
      buildPlanMarkdown({ title: "Backend", tags: ["backend"] }),
    );

    const result = detectPlan({
      dirs,
      dryRun: true,
      filterTags: ["frontend"],
    });
    expect(result.detected).toBe(false);
  });

  it("skips plans without tags when --tags is specified", () => {
    writeFileSync(
      join(dirs.backlogDir, "no-tags.md"),
      buildPlanMarkdown({ title: "No Tags" }), // no tags = skipped
    );
    writeFileSync(
      join(dirs.backlogDir, "tagged.md"),
      buildPlanMarkdown({ title: "Tagged", tags: ["frontend"] }),
    );

    const result = detectPlan({
      dirs,
      dryRun: true,
      filterTags: ["frontend"],
    });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("tagged");
    }
  });

  it("no --tags means all plans are eligible (backward compat)", () => {
    writeFileSync(
      join(dirs.backlogDir, "no-tags.md"),
      buildPlanMarkdown({ title: "No Tags" }),
    );
    writeFileSync(
      join(dirs.backlogDir, "tagged.md"),
      buildPlanMarkdown({ title: "Tagged", tags: ["frontend"] }),
    );

    const result = detectPlan({
      dirs,
      dryRun: true,
    });
    expect(result.detected).toBe(true);
    // Should pick first alphabetically (both priority 0)
    if (result.detected) {
      expect(result.plan.planSlug).toBe("no-tags");
    }
  });

  it("OR semantics: matches plan with any of the specified tags", () => {
    writeFileSync(
      join(dirs.backlogDir, "auth-plan.md"),
      buildPlanMarkdown({ title: "Auth", tags: ["auth"] }),
    );
    writeFileSync(
      join(dirs.backlogDir, "fe-plan.md"),
      buildPlanMarkdown({ title: "Frontend", tags: ["frontend"] }),
    );
    writeFileSync(
      join(dirs.backlogDir, "unrelated.md"),
      buildPlanMarkdown({ title: "Unrelated", tags: ["infra"] }),
    );

    const result = detectPlan({
      dirs,
      dryRun: true,
      filterTags: ["frontend", "auth"],
    });
    expect(result.detected).toBe(true);
    if (result.detected) {
      // Both auth-plan and fe-plan match; auth-plan is first alphabetically
      expect(result.plan.planSlug).toBe("auth-plan");
    }
  });

  it("priority sorting applies within tag-filtered set", () => {
    writeFileSync(
      join(dirs.backlogDir, "low-prio.md"),
      buildPlanMarkdown({
        title: "Low Prio",
        tags: ["frontend"],
        priority: 10,
      }),
    );
    writeFileSync(
      join(dirs.backlogDir, "high-prio.md"),
      buildPlanMarkdown({
        title: "High Prio",
        tags: ["frontend"],
        priority: 1,
      }),
    );
    writeFileSync(
      join(dirs.backlogDir, "excluded.md"),
      buildPlanMarkdown({
        title: "Excluded",
        tags: ["backend"],
        priority: 0,
      }),
    );

    const result = detectPlan({
      dirs,
      dryRun: true,
      filterTags: ["frontend"],
    });
    expect(result.detected).toBe(true);
    if (result.detected) {
      // high-prio (priority 1) before low-prio (priority 10)
      expect(result.plan.planSlug).toBe("high-prio");
    }
  });

  it("returns all-blocked when all tag-filtered plans have unmet deps", () => {
    writeFileSync(
      join(dirs.backlogDir, "blocked.md"),
      buildPlanMarkdown({
        title: "Blocked",
        tags: ["frontend"],
        dependsOn: ["missing.md"],
      }),
    );

    const result = detectPlan({
      dirs,
      dryRun: true,
      filterTags: ["frontend"],
    });
    expect(result.detected).toBe(false);
    if (!result.detected) {
      expect(result.reason).toBe("all-blocked");
    }
  });

  it("empty filterTags array means all plans eligible", () => {
    writeFileSync(
      join(dirs.backlogDir, "plan.md"),
      buildPlanMarkdown({ title: "Plan" }),
    );

    const result = detectPlan({
      dirs,
      dryRun: true,
      filterTags: [],
    });
    expect(result.detected).toBe(true);
  });
});

// =========================================================================
// buildPlanMarkdown fixture with priority and tags
// =========================================================================

describe("buildPlanMarkdown (priority + tags)", () => {
  it("includes priority in frontmatter", () => {
    const md = buildPlanMarkdown({ title: "Test", priority: 5 });
    expect(md).toContain("priority: 5");
  });

  it("includes tags in frontmatter", () => {
    const md = buildPlanMarkdown({ title: "Test", tags: ["a", "b"] });
    expect(md).toContain("tags: [a, b]");
  });

  it("omits priority when undefined", () => {
    const md = buildPlanMarkdown({ title: "Test" });
    expect(md).not.toContain("priority:");
  });

  it("omits tags when empty", () => {
    const md = buildPlanMarkdown({ title: "Test", tags: [] });
    expect(md).not.toContain("tags:");
  });
});
