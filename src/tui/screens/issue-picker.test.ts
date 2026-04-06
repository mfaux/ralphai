/**
 * Tests for the issue picker screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/issue-picker.tsx`:
 * - `buildIssuePickerItems` — PRD tree rendering with connectors (├/└),
 *   "(next up)" annotation on first open sub-issue, "N remaining" hint on
 *   PRDs, and disabled context rows for cursor skipping
 * - `issuePickerSelect` — maps a selected value to a DispatchResult
 */

import { describe, it, expect } from "bun:test";
import type { GithubIssueListItem } from "../../interactive/github-issues.ts";
import { buildIssuePickerItems, issuePickerSelect } from "./issue-picker.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(
  overrides?: Partial<GithubIssueListItem>,
): GithubIssueListItem {
  return {
    number: 1,
    title: "Test issue",
    labels: [],
    isPrd: false,
    subIssues: [],
    subIssueDetails: [],
    ...overrides,
  };
}

function makePrdIssue(
  overrides?: Partial<GithubIssueListItem>,
): GithubIssueListItem {
  return makeIssue({
    isPrd: true,
    labels: ["ralphai-prd"],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// buildIssuePickerItems
// ---------------------------------------------------------------------------

describe("buildIssuePickerItems", () => {
  it("returns empty array for empty input", () => {
    expect(buildIssuePickerItems([])).toEqual([]);
  });

  it("creates a selectable item for a regular issue", () => {
    const issues = [makeIssue({ number: 42, title: "Fix login bug" })];
    const items = buildIssuePickerItems(issues);

    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("42");
    expect(items[0]!.label).toBe("#42 Fix login bug");
    expect(items[0]!.disabled).toBeUndefined();
  });

  it("creates a selectable PRD parent with 'N remaining' hint", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "Auth Redesign",
        subIssues: [11, 12, 13],
        subIssueDetails: [
          { number: 11, title: "Add login", state: "open", node_id: "a" },
          { number: 12, title: "Add signup", state: "open", node_id: "b" },
          { number: 13, title: "Add reset", state: "open", node_id: "c" },
        ],
      }),
    ];
    const items = buildIssuePickerItems(issues);

    // First item is the PRD parent
    expect(items[0]!.value).toBe("10");
    expect(items[0]!.label).toBe("#10 Auth Redesign [PRD]");
    expect(items[0]!.hint).toBe("3 remaining");
    expect(items[0]!.disabled).toBeUndefined();
  });

  it("shows 'no sub-issues' hint when PRD has zero sub-issues", () => {
    const issues = [
      makePrdIssue({
        number: 5,
        title: "Empty PRD",
        subIssues: [],
        subIssueDetails: [],
      }),
    ];
    const items = buildIssuePickerItems(issues);

    expect(items[0]!.hint).toBe("no sub-issues");
  });

  it("renders sub-issues with tree connectors (├ for middle, └ for last)", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "PRD",
        subIssues: [11, 12, 13],
        subIssueDetails: [
          { number: 11, title: "First", state: "open", node_id: "a" },
          { number: 12, title: "Second", state: "open", node_id: "b" },
          { number: 13, title: "Third", state: "open", node_id: "c" },
        ],
      }),
    ];
    const items = buildIssuePickerItems(issues);

    // Sub-issues are items[1], items[2], items[3]
    expect(items[1]!.label).toContain("\u251C"); // ├ for first (not last)
    expect(items[2]!.label).toContain("\u251C"); // ├ for middle (not last)
    expect(items[3]!.label).toContain("\u2514"); // └ for last
  });

  it("annotates first open sub-issue with '(next up)'", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "PRD",
        subIssues: [11, 12],
        subIssueDetails: [
          { number: 11, title: "First", state: "open", node_id: "a" },
          { number: 12, title: "Second", state: "open", node_id: "b" },
        ],
      }),
    ];
    const items = buildIssuePickerItems(issues);

    // First sub-issue gets "(next up)"
    expect(items[1]!.label).toContain("(next up)");
    // Second sub-issue does NOT
    expect(items[2]!.label).not.toContain("(next up)");
  });

  it("marks sub-issue context rows as disabled (non-selectable)", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "PRD",
        subIssues: [11, 12],
        subIssueDetails: [
          { number: 11, title: "Sub A", state: "open", node_id: "a" },
          { number: 12, title: "Sub B", state: "open", node_id: "b" },
        ],
      }),
    ];
    const items = buildIssuePickerItems(issues);

    expect(items[1]!.disabled).toBe(true);
    expect(items[2]!.disabled).toBe(true);
  });

  it("uses __ctx__ prefix for sub-issue context row values", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "PRD",
        subIssues: [11],
        subIssueDetails: [
          { number: 11, title: "Sub", state: "open", node_id: "a" },
        ],
      }),
    ];
    const items = buildIssuePickerItems(issues);

    expect(items[1]!.value).toBe("__ctx__:11");
  });

  it("includes sub-issue title in context row label", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "PRD",
        subIssues: [11],
        subIssueDetails: [
          {
            number: 11,
            title: "Add login endpoint",
            state: "open",
            node_id: "a",
          },
        ],
      }),
    ];
    const items = buildIssuePickerItems(issues);

    expect(items[1]!.label).toContain("#11 Add login endpoint");
  });

  it("handles sub-issue with missing title from details", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "PRD",
        subIssues: [99],
        subIssueDetails: [], // no details for sub-issue 99
      }),
    ];
    const items = buildIssuePickerItems(issues);

    // Should still render with just the number
    expect(items[1]!.label).toContain("#99");
    expect(items[1]!.disabled).toBe(true);
  });

  it("places regular issues below PRD groups", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "PRD One",
        subIssues: [11],
        subIssueDetails: [
          { number: 11, title: "Sub", state: "open", node_id: "a" },
        ],
      }),
      makeIssue({ number: 20, title: "Regular issue" }),
    ];
    const items = buildIssuePickerItems(issues);

    // PRD parent + 1 sub-issue + regular issue = 3 items
    expect(items).toHaveLength(3);
    expect(items[0]!.value).toBe("10"); // PRD parent
    expect(items[1]!.value).toBe("__ctx__:11"); // sub-issue context
    expect(items[2]!.value).toBe("20"); // regular issue
    expect(items[2]!.disabled).toBeUndefined();
  });

  it("handles multiple PRDs and regular issues in correct order", () => {
    const issues = [
      makePrdIssue({
        number: 5,
        title: "PRD A",
        subIssues: [6],
        subIssueDetails: [
          { number: 6, title: "Sub A", state: "open", node_id: "a" },
        ],
      }),
      makePrdIssue({
        number: 10,
        title: "PRD B",
        subIssues: [11, 12],
        subIssueDetails: [
          { number: 11, title: "Sub B1", state: "open", node_id: "b" },
          { number: 12, title: "Sub B2", state: "open", node_id: "c" },
        ],
      }),
      makeIssue({ number: 20, title: "Standalone A" }),
      makeIssue({ number: 30, title: "Standalone B" }),
    ];
    const items = buildIssuePickerItems(issues);

    // PRD A (1) + sub (1) + PRD B (1) + subs (2) + regular (2) = 7
    expect(items).toHaveLength(7);

    const values = items.map((i) => i.value);
    expect(values).toEqual([
      "5", // PRD A parent
      "__ctx__:6", // PRD A sub-issue
      "10", // PRD B parent
      "__ctx__:11", // PRD B sub-issue 1
      "__ctx__:12", // PRD B sub-issue 2
      "20", // regular issue
      "30", // regular issue
    ]);
  });

  it("single sub-issue gets both └ connector and (next up)", () => {
    const issues = [
      makePrdIssue({
        number: 10,
        title: "PRD",
        subIssues: [11],
        subIssueDetails: [
          { number: 11, title: "Only sub", state: "open", node_id: "a" },
        ],
      }),
    ];
    const items = buildIssuePickerItems(issues);

    // Single sub-issue is both first (next up) and last (└)
    expect(items[1]!.label).toContain("\u2514"); // └
    expect(items[1]!.label).toContain("(next up)");
  });
});

// ---------------------------------------------------------------------------
// issuePickerSelect
// ---------------------------------------------------------------------------

describe("issuePickerSelect", () => {
  it("returns exit-to-runner with issue number for regular issue", () => {
    const result = issuePickerSelect("42");

    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "42"],
    });
  });

  it("returns exit-to-runner with PRD number for PRD issue", () => {
    const result = issuePickerSelect("10");

    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "10"],
    });
  });

  it("returns null for context row values (prefixed with __ctx__:)", () => {
    expect(issuePickerSelect("__ctx__:11")).toBeNull();
  });

  it("returns null for non-numeric values", () => {
    expect(issuePickerSelect("abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(issuePickerSelect("")).toBeNull();
  });

  it("passes issue number as string in args", () => {
    const result = issuePickerSelect("999");

    expect(result).toEqual({
      type: "exit-to-runner",
      args: ["run", "999"],
    });
    // Verify args values are strings (not numbers)
    const args = (result as { type: "exit-to-runner"; args: string[] }).args;
    expect(typeof args[1]).toBe("string");
  });
});
