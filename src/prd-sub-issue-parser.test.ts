import { describe, it, expect } from "bun:test";
import { parseSubIssues } from "./prd-sub-issue-parser.ts";

// ---------------------------------------------------------------------------
// Basic extraction
// ---------------------------------------------------------------------------

describe("parseSubIssues", () => {
  it("extracts issue number from #N shorthand", () => {
    expect(parseSubIssues("- [ ] #11")).toEqual([11]);
  });

  it("extracts issue number from full GitHub URL", () => {
    expect(
      parseSubIssues("- [ ] https://github.com/owner/repo/issues/14"),
    ).toEqual([14]);
  });

  it("excludes checked items", () => {
    expect(parseSubIssues("- [x] #13")).toEqual([]);
  });

  it("returns empty array for body with no task list items", () => {
    const body = [
      "## Overview",
      "",
      "This is a PRD with no tasks.",
      "",
      "Some more text.",
    ].join("\n");
    expect(parseSubIssues(body)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Empty / undefined / null input
  // ---------------------------------------------------------------------------

  it("returns empty array for empty string", () => {
    expect(parseSubIssues("")).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseSubIssues(undefined)).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(parseSubIssues(null)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Mixed checked and unchecked items
  // ---------------------------------------------------------------------------

  it("returns only unchecked issue numbers from mixed list", () => {
    const body = [
      "## Sub-issues",
      "",
      "- [x] #10",
      "- [ ] #11",
      "- [x] #12",
      "- [ ] #13",
      "- [x] #14",
    ].join("\n");
    expect(parseSubIssues(body)).toEqual([11, 13]);
  });

  // ---------------------------------------------------------------------------
  // Mixed formats in same body
  // ---------------------------------------------------------------------------

  it("handles mixed #N and URL formats in the same body", () => {
    const body = [
      "- [ ] #5",
      "- [ ] https://github.com/acme/project/issues/42",
      "- [ ] #99",
    ].join("\n");
    expect(parseSubIssues(body)).toEqual([5, 42, 99]);
  });

  // ---------------------------------------------------------------------------
  // Non-issue task list items
  // ---------------------------------------------------------------------------

  it("ignores unchecked items that are not issue references", () => {
    const body = [
      "- [ ] Implement the parser",
      "- [ ] #7",
      "- [ ] Write tests",
      "- [ ] https://github.com/org/repo/issues/8",
    ].join("\n");
    expect(parseSubIssues(body)).toEqual([7, 8]);
  });

  it("ignores items with text after the issue reference", () => {
    const body = "- [ ] #7 some extra text";
    expect(parseSubIssues(body)).toEqual([]);
  });

  it("ignores items with text before the issue reference", () => {
    const body = "- [ ] see #7";
    expect(parseSubIssues(body)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Malformed URLs
  // ---------------------------------------------------------------------------

  it("ignores malformed GitHub URLs missing issue number", () => {
    expect(
      parseSubIssues("- [ ] https://github.com/owner/repo/issues/"),
    ).toEqual([]);
  });

  it("ignores non-GitHub URLs", () => {
    expect(
      parseSubIssues("- [ ] https://gitlab.com/owner/repo/issues/5"),
    ).toEqual([]);
  });

  it("ignores GitHub URLs with wrong path structure", () => {
    expect(
      parseSubIssues("- [ ] https://github.com/owner/repo/pull/5"),
    ).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Preserves order
  // ---------------------------------------------------------------------------

  it("preserves the order of issues as they appear in the body", () => {
    const body = ["- [ ] #30", "- [ ] #10", "- [ ] #20"].join("\n");
    expect(parseSubIssues(body)).toEqual([30, 10, 20]);
  });

  // ---------------------------------------------------------------------------
  // Realistic PRD body
  // ---------------------------------------------------------------------------

  it("handles a realistic PRD body with prose and task lists", () => {
    const body = [
      "# Feature: User Authentication",
      "",
      "## Overview",
      "",
      "Implement user authentication with JWT tokens.",
      "",
      "## Sub-issues",
      "",
      "- [x] #1",
      "- [ ] #2",
      "- [ ] https://github.com/acme/app/issues/3",
      "- [x] https://github.com/acme/app/issues/4",
      "- [ ] #5",
      "",
      "## Notes",
      "",
      "Remember to add rate limiting.",
    ].join("\n");
    expect(parseSubIssues(body)).toEqual([2, 3, 5]);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it("handles trailing whitespace on lines", () => {
    expect(parseSubIssues("- [ ] #42   ")).toEqual([42]);
  });

  it("handles Windows-style line endings", () => {
    const body = "- [ ] #1\r\n- [ ] #2\r\n";
    expect(parseSubIssues(body)).toEqual([1, 2]);
  });

  it("handles single item with no trailing newline", () => {
    expect(parseSubIssues("- [ ] #7")).toEqual([7]);
  });

  it("ignores checkbox variants with uppercase X", () => {
    expect(parseSubIssues("- [X] #13")).toEqual([]);
  });
});
