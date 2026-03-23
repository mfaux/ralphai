import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { detectPlan, type PipelineDirs } from "./plan-detection.ts";

function makeDirs(base: string): PipelineDirs {
  const wipDir = join(base, "in-progress");
  const backlogDir = join(base, "backlog");
  const archiveDir = join(base, "out");
  mkdirSync(wipDir, { recursive: true });
  mkdirSync(backlogDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  return { wipDir, backlogDir, archiveDir };
}

describe("detectPlan with targetPlan", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-target-plan-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("selects the targeted plan from backlog", () => {
    const dirs = makeDirs(tmpDir);
    writeFileSync(join(dirs.backlogDir, "a-first.md"), "# A\n");
    writeFileSync(join(dirs.backlogDir, "b-second.md"), "# B\n");

    const result = detectPlan({ dirs, targetPlan: "b-second.md" });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("b-second");
    }
  });

  it("selects targeted plan without .md extension", () => {
    const dirs = makeDirs(tmpDir);
    writeFileSync(join(dirs.backlogDir, "my-plan.md"), "# My Plan\n");

    const result = detectPlan({ dirs, targetPlan: "my-plan" });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("my-plan");
    }
  });

  it("returns target-not-found when plan does not exist", () => {
    const dirs = makeDirs(tmpDir);
    writeFileSync(join(dirs.backlogDir, "other.md"), "# Other\n");

    const result = detectPlan({ dirs, targetPlan: "missing.md" });
    expect(result.detected).toBe(false);
    if (!result.detected) {
      expect(result.reason).toBe("target-not-found");
      expect(result.backlogCount).toBe(1);
    }
  });

  it("returns target-not-found when backlog is empty", () => {
    const dirs = makeDirs(tmpDir);

    const result = detectPlan({ dirs, targetPlan: "anything.md" });
    expect(result.detected).toBe(false);
    if (!result.detected) {
      expect(result.reason).toBe("empty-backlog");
    }
  });

  it("still resumes in-progress plans regardless of targetPlan", () => {
    const dirs = makeDirs(tmpDir);
    // In-progress plan exists
    const slugDir = join(dirs.wipDir, "active");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "active.md"), "# Active\n");
    // Targeted plan also exists in backlog
    writeFileSync(join(dirs.backlogDir, "new-plan.md"), "# New\n");

    const result = detectPlan({ dirs, targetPlan: "new-plan.md" });
    expect(result.detected).toBe(true);
    if (result.detected) {
      // In-progress takes priority over targetPlan
      expect(result.plan.planSlug).toBe("active");
      expect(result.plan.resumed).toBe(true);
    }
  });

  it("respects dependency readiness for targeted plan", () => {
    const dirs = makeDirs(tmpDir);
    writeFileSync(
      join(dirs.backlogDir, "blocked.md"),
      "---\ndepends-on: [prerequisite.md]\n---\n# Blocked\n",
    );
    writeFileSync(join(dirs.backlogDir, "ready.md"), "# Ready\n");

    const result = detectPlan({ dirs, targetPlan: "blocked.md" });
    expect(result.detected).toBe(false);
    if (!result.detected) {
      expect(result.reason).toBe("all-blocked");
    }
  });

  it("promotes targeted plan to in-progress", () => {
    const dirs = makeDirs(tmpDir);
    writeFileSync(join(dirs.backlogDir, "target.md"), "# Target\n");

    const result = detectPlan({ dirs, targetPlan: "target.md" });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("target");
      expect(result.plan.resumed).toBe(false);
      expect(existsSync(join(dirs.wipDir, "target", "target.md"))).toBe(true);
      expect(existsSync(join(dirs.backlogDir, "target.md"))).toBe(false);
    }
  });

  it("does not modify filesystem in dry-run mode", () => {
    const dirs = makeDirs(tmpDir);
    writeFileSync(join(dirs.backlogDir, "target.md"), "# Target\n");

    const result = detectPlan({ dirs, targetPlan: "target.md", dryRun: true });
    expect(result.detected).toBe(true);
    // File should still be in backlog
    expect(existsSync(join(dirs.backlogDir, "target.md"))).toBe(true);
  });

  it("without targetPlan picks first ready plan (default behavior)", () => {
    const dirs = makeDirs(tmpDir);
    writeFileSync(join(dirs.backlogDir, "a-plan.md"), "# A\n");
    writeFileSync(join(dirs.backlogDir, "b-plan.md"), "# B\n");

    const result = detectPlan({ dirs });
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.plan.planSlug).toBe("a-plan");
    }
  });
});
