/**
 * Tests for src/prd-hitl.ts — HITL dependency detection and summary formatting.
 *
 * These test the extracted helpers that power the HITL filtering logic inside
 * `runPrdIssueTarget()` (src/ralphai.ts). The helpers are pure functions that
 * don't require mocking gh or creating worktrees.
 */
import { describe, test, expect } from "bun:test";
import {
  findHitlBlockers,
  formatPrdHitlSummary,
  type BlockedSubIssue,
  type PrdHitlSummaryInput,
} from "./issue-lifecycle.ts";

// ---------------------------------------------------------------------------
// findHitlBlockers
// ---------------------------------------------------------------------------

describe("findHitlBlockers", () => {
  test("returns empty array when no deps match HITL set", () => {
    const deps = ["gh-10", "gh-20"];
    const hitl = new Set([42, 50]);
    expect(findHitlBlockers(deps, hitl)).toEqual([]);
  });

  test("returns matching HITL issue numbers", () => {
    const deps = ["gh-42", "gh-50", "gh-99"];
    const hitl = new Set([42, 50]);
    expect(findHitlBlockers(deps, hitl)).toEqual([42, 50]);
  });

  test("returns single blocker when only one dep is HITL", () => {
    const deps = ["gh-10", "gh-42", "gh-20"];
    const hitl = new Set([42]);
    expect(findHitlBlockers(deps, hitl)).toEqual([42]);
  });

  test("returns empty array when deps list is empty", () => {
    const hitl = new Set([42]);
    expect(findHitlBlockers([], hitl)).toEqual([]);
  });

  test("returns empty array when HITL set is empty", () => {
    const deps = ["gh-42", "gh-50"];
    expect(findHitlBlockers(deps, new Set())).toEqual([]);
  });

  test("ignores non-gh slugs (file-based deps)", () => {
    const deps = ["some-plan.md", "gh-42", "other-plan"];
    const hitl = new Set([42]);
    expect(findHitlBlockers(deps, hitl)).toEqual([42]);
  });

  test("ignores malformed gh slugs", () => {
    const deps = ["gh-", "gh-abc", "gh42", "gh-42-extra", "gh-42"];
    const hitl = new Set([42]);
    // Only exact "gh-42" matches, not "gh-42-extra"
    expect(findHitlBlockers(deps, hitl)).toEqual([42]);
  });

  test("handles large issue numbers", () => {
    const deps = ["gh-99999"];
    const hitl = new Set([99999]);
    expect(findHitlBlockers(deps, hitl)).toEqual([99999]);
  });
});

// ---------------------------------------------------------------------------
// formatPrdHitlSummary
// ---------------------------------------------------------------------------

describe("formatPrdHitlSummary", () => {
  test("includes header and completed count", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 100,
      totalSubIssues: 5,
      completedCount: 3,
      stuckSubIssues: [],
      hitlSubIssues: [],
      blockedSubIssues: [],
    });

    expect(lines).toContain("========================================");
    expect(lines).toContain("  PRD #100 — summary");
    expect(lines).toContain("Completed: 3/5 sub-issue(s)");
  });

  test("includes HITL line when HITL sub-issues exist", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 100,
      totalSubIssues: 5,
      completedCount: 2,
      stuckSubIssues: [],
      hitlSubIssues: [3, 5],
      blockedSubIssues: [],
    });

    expect(lines).toContain("HITL (waiting on human): #3, #5");
  });

  test("includes blocked-by-HITL lines when blocked sub-issues exist", () => {
    const blocked: BlockedSubIssue[] = [
      { number: 4, blockedBy: [3] },
      { number: 6, blockedBy: [3, 5] },
    ];
    const lines = formatPrdHitlSummary({
      prdNumber: 100,
      totalSubIssues: 6,
      completedCount: 1,
      stuckSubIssues: [],
      hitlSubIssues: [3, 5],
      blockedSubIssues: blocked,
    });

    expect(lines).toContain("Blocked by HITL: #4 (depends on #3)");
    expect(lines).toContain("Blocked by HITL: #6 (depends on #3, #5)");
  });

  test("includes stuck line when stuck sub-issues exist", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 100,
      totalSubIssues: 5,
      completedCount: 2,
      stuckSubIssues: [7, 8],
      hitlSubIssues: [],
      blockedSubIssues: [],
    });

    expect(lines).toContain("Stuck/skipped: #7, #8");
  });

  test("includes all sections when all types present", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 42,
      totalSubIssues: 10,
      completedCount: 3,
      stuckSubIssues: [7],
      hitlSubIssues: [3, 5],
      blockedSubIssues: [{ number: 4, blockedBy: [3] }],
    });

    expect(lines).toContain("  PRD #42 — summary");
    expect(lines).toContain("Completed: 3/10 sub-issue(s)");
    expect(lines).toContain("Stuck/skipped: #7");
    expect(lines).toContain("HITL (waiting on human): #3, #5");
    expect(lines).toContain("Blocked by HITL: #4 (depends on #3)");
  });

  test("omits HITL line when no HITL sub-issues", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 100,
      totalSubIssues: 3,
      completedCount: 3,
      stuckSubIssues: [],
      hitlSubIssues: [],
      blockedSubIssues: [],
    });

    const hitlLines = lines.filter((l) => l.includes("HITL"));
    expect(hitlLines).toHaveLength(0);
  });

  test("omits blocked line when no blocked sub-issues", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 100,
      totalSubIssues: 3,
      completedCount: 1,
      stuckSubIssues: [],
      hitlSubIssues: [2],
      blockedSubIssues: [],
    });

    const blockedLines = lines.filter((l) => l.includes("Blocked by HITL"));
    expect(blockedLines).toHaveLength(0);
  });

  test("omits stuck line when no stuck sub-issues", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 100,
      totalSubIssues: 3,
      completedCount: 3,
      stuckSubIssues: [],
      hitlSubIssues: [],
      blockedSubIssues: [],
    });

    const stuckLines = lines.filter((l) => l.includes("Stuck"));
    expect(stuckLines).toHaveLength(0);
  });

  test("single HITL sub-issue formats without trailing comma", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 100,
      totalSubIssues: 2,
      completedCount: 1,
      stuckSubIssues: [],
      hitlSubIssues: [3],
      blockedSubIssues: [],
    });

    expect(lines).toContain("HITL (waiting on human): #3");
  });
});
