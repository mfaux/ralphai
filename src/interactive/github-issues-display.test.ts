/**
 * Tests for buildGithubPickList() — display list building for the GitHub picker.
 *
 * Pure unit tests — no filesystem, no subprocess, no mocking needed.
 * These test the tree rendering, connector characters, sub-issue ordering,
 * and "Back" option behavior.
 */

import { describe, it, expect } from "bun:test";
import {
  buildGithubPickList,
  type GithubIssueListItem,
} from "./github-issues.ts";
import type { PrdSubIssue } from "../issue-lifecycle.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSubIssue(
  number: number,
  title: string,
  state: string = "open",
): PrdSubIssue {
  return { number, title, state, node_id: `node_${number}` };
}

function makeIssue(
  number: number,
  title: string,
  opts?: {
    isPrd?: boolean;
    subIssues?: number[];
    subIssueDetails?: PrdSubIssue[];
  },
): GithubIssueListItem {
  const subIssues = opts?.subIssues ?? [];
  // Auto-generate subIssueDetails from subIssues if not explicitly provided
  const subIssueDetails =
    opts?.subIssueDetails ?? subIssues.map((n) => makeSubIssue(n, ""));
  return {
    number,
    title,
    labels: opts?.isPrd ? ["ralphai-prd"] : ["ralphai"],
    isPrd: opts?.isPrd ?? false,
    subIssues,
    subIssueDetails,
  };
}

// ---------------------------------------------------------------------------
// Empty & single-item cases
// ---------------------------------------------------------------------------

describe("buildGithubPickList", () => {
  it("returns only Back option when no issues provided", () => {
    const items = buildGithubPickList([]);
    expect(items.length).toBe(1);
    expect(items[0]!.value).toBe("__back__");
    expect(items[0]!.label).toBe("Back");
  });

  it("renders a single regular issue with Back option", () => {
    const issues = [makeIssue(14, "Fix dashboard bug")];
    const items = buildGithubPickList(issues);

    expect(items.length).toBe(2);
    expect(items[0]!.value).toBe("14");
    expect(items[0]!.label).toBe("#14 Fix dashboard bug");
    expect(items[0]!.hint).toBeUndefined();
    expect(items[1]!.value).toBe("__back__");
  });

  // ---------------------------------------------------------------------------
  // Regular issues
  // ---------------------------------------------------------------------------

  it("renders multiple regular issues in order", () => {
    const issues = [
      makeIssue(14, "Fix dashboard bug"),
      makeIssue(20, "Add search feature"),
    ];
    const items = buildGithubPickList(issues);

    expect(items.length).toBe(3); // 2 issues + Back
    expect(items[0]!.value).toBe("14");
    expect(items[1]!.value).toBe("20");
    expect(items[2]!.value).toBe("__back__");
  });

  // ---------------------------------------------------------------------------
  // PRD with sub-issues
  // ---------------------------------------------------------------------------

  it("renders PRD with [PRD] tag and remaining count hint", () => {
    const issues = [
      makeIssue(10, "Auth Redesign", { isPrd: true, subIssues: [11, 12, 13] }),
    ];
    const items = buildGithubPickList(issues);

    const prdItem = items[0]!;
    expect(prdItem.value).toBe("10");
    expect(prdItem.label).toBe("#10 Auth Redesign [PRD]");
    expect(prdItem.hint).toBe("3 remaining");
  });

  it("shows 'no sub-issues' hint for PRD with empty sub-issues", () => {
    const issues = [makeIssue(10, "Empty PRD", { isPrd: true, subIssues: [] })];
    const items = buildGithubPickList(issues);

    expect(items[0]!.hint).toBe("no sub-issues");
  });

  it("renders sub-issue context lines with correct connector characters", () => {
    const issues = [
      makeIssue(10, "Auth Redesign", { isPrd: true, subIssues: [11, 12, 13] }),
    ];
    const items = buildGithubPickList(issues);

    // PRD parent + 3 sub-issues + Back = 5 items
    expect(items.length).toBe(5);

    // First sub-issue: ├ connector
    expect(items[1]!.label).toContain("\u251C");
    expect(items[1]!.label).toContain("#11");

    // Middle sub-issue: ├ connector
    expect(items[2]!.label).toContain("\u251C");
    expect(items[2]!.label).toContain("#12");

    // Last sub-issue: └ connector
    expect(items[3]!.label).toContain("\u2514");
    expect(items[3]!.label).toContain("#13");
  });

  it("uses └ connector for single sub-issue (both first and last)", () => {
    const issues = [
      makeIssue(10, "Solo sub", { isPrd: true, subIssues: [11] }),
    ];
    const items = buildGithubPickList(issues);

    expect(items[1]!.label).toContain("\u2514");
    expect(items[1]!.label).toContain("#11");
  });

  it("marks first sub-issue with (next up)", () => {
    const issues = [
      makeIssue(10, "Auth Redesign", { isPrd: true, subIssues: [11, 12] }),
    ];
    const items = buildGithubPickList(issues);

    expect(items[1]!.label).toContain("(next up)");
    expect(items[2]!.label).not.toContain("(next up)");
  });

  it("sub-issue context lines use __ctx__: value prefix", () => {
    const issues = [
      makeIssue(10, "Auth PRD", { isPrd: true, subIssues: [11, 12] }),
    ];
    const items = buildGithubPickList(issues);

    expect(items[1]!.value).toBe("__ctx__:11");
    expect(items[2]!.value).toBe("__ctx__:12");
  });

  // ---------------------------------------------------------------------------
  // Sub-issue title resolution (from subIssueDetails)
  // ---------------------------------------------------------------------------

  it("includes sub-issue titles from subIssueDetails", () => {
    const issues = [
      makeIssue(10, "Auth PRD", {
        isPrd: true,
        subIssues: [11, 12],
        subIssueDetails: [
          makeSubIssue(11, "Add login endpoint"),
          makeSubIssue(12, "Add signup endpoint"),
        ],
      }),
    ];
    const items = buildGithubPickList(issues);

    expect(items[1]!.label).toContain("Add login endpoint");
    expect(items[2]!.label).toContain("Add signup endpoint");
  });

  it("shows only issue number when subIssueDetails has no title", () => {
    const issues = [
      makeIssue(10, "Auth PRD", {
        isPrd: true,
        subIssues: [11],
        subIssueDetails: [makeSubIssue(11, "")],
      }),
    ];
    const items = buildGithubPickList(issues);

    // Should have #11 but no title text after it (besides next up)
    expect(items[1]!.label).toMatch(/#11/);
    expect(items[1]!.label).not.toContain("undefined");
  });

  // ---------------------------------------------------------------------------
  // Combined list: PRDs + regular issues
  // ---------------------------------------------------------------------------

  it("renders PRDs and regular issues in provided order", () => {
    const issues = [
      makeIssue(5, "PRD A", { isPrd: true, subIssues: [6] }),
      makeIssue(10, "PRD B", { isPrd: true, subIssues: [11, 12] }),
      makeIssue(15, "Bug fix"),
      makeIssue(20, "Feature request"),
    ];
    const items = buildGithubPickList(issues);

    // PRD A (1) + sub (1) + PRD B (1) + subs (2) + bug (1) + feature (1) + Back (1) = 8
    expect(items.length).toBe(8);

    const values = items.map((i) => i.value);
    expect(values).toEqual([
      "5",
      "__ctx__:6",
      "10",
      "__ctx__:11",
      "__ctx__:12",
      "15",
      "20",
      "__back__",
    ]);
  });

  it("Back option is always last", () => {
    const issues = [
      makeIssue(1, "Issue A"),
      makeIssue(2, "Issue B", { isPrd: true, subIssues: [3] }),
    ];
    const items = buildGithubPickList(issues);
    const lastItem = items[items.length - 1]!;

    expect(lastItem.value).toBe("__back__");
    expect(lastItem.label).toBe("Back");
  });

  it("PRD with 1 remaining shows singular count", () => {
    const issues = [
      makeIssue(10, "Solo PRD", { isPrd: true, subIssues: [11] }),
    ];
    const items = buildGithubPickList(issues);

    expect(items[0]!.hint).toBe("1 remaining");
  });
});
