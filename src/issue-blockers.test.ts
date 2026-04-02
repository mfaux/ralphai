import { describe, it, expect } from "bun:test";
import {
  extractBlockersFromBody,
  issueDepSlug,
  buildIssuePlanContent,
} from "./issues.ts";

// ---------------------------------------------------------------------------
// extractBlockersFromBody — parses blocker references from GitHub issue bodies
// ---------------------------------------------------------------------------

describe("extractBlockersFromBody", () => {
  it("extracts a single 'Blocked by #N' reference", () => {
    const body =
      "This task is complex.\n\nBlocked by #42\n\nMore details here.";
    expect(extractBlockersFromBody(body)).toEqual([42]);
  });

  it("extracts 'Depends on #N' reference", () => {
    const body = "Depends on #15\n\nImplementation notes...";
    expect(extractBlockersFromBody(body)).toEqual([15]);
  });

  it("is case-insensitive", () => {
    const body = "blocked by #7\nDEPENDS ON #8";
    expect(extractBlockersFromBody(body)).toEqual([7, 8]);
  });

  it("extracts multiple comma-separated blockers", () => {
    const body = "Blocked by #10, #20, #30";
    expect(extractBlockersFromBody(body)).toEqual([10, 20, 30]);
  });

  it("extracts blockers from multiple lines", () => {
    const body = "Blocked by #10\nBlocked by #20\nDepends on #30";
    expect(extractBlockersFromBody(body)).toEqual([10, 20, 30]);
  });

  it("returns empty array when no blockers found", () => {
    const body = "This is a simple issue with no blocking references.";
    expect(extractBlockersFromBody(body)).toEqual([]);
  });

  it("returns empty array for empty body", () => {
    expect(extractBlockersFromBody("")).toEqual([]);
  });

  it("returns empty array for null/undefined body", () => {
    expect(extractBlockersFromBody(null as unknown as string)).toEqual([]);
    expect(extractBlockersFromBody(undefined as unknown as string)).toEqual([]);
  });

  it("deduplicates repeated issue numbers", () => {
    const body = "Blocked by #42\nDepends on #42";
    expect(extractBlockersFromBody(body)).toEqual([42]);
  });

  it("handles 'Blocked by #N and #M' syntax", () => {
    const body = "Blocked by #10 and #20";
    expect(extractBlockersFromBody(body)).toEqual([10, 20]);
  });

  it("ignores issue references not preceded by blocker keywords", () => {
    const body = "See #42 for context.\nRelated to #15.";
    expect(extractBlockersFromBody(body)).toEqual([]);
  });

  it("handles mixed content with blocker and non-blocker references", () => {
    const body = "See #99 for details.\n\nBlocked by #42\n\nRelated: #15, #20.";
    expect(extractBlockersFromBody(body)).toEqual([42]);
  });
});

// ---------------------------------------------------------------------------
// issueDepSlug — generates dependency slug from issue number
// ---------------------------------------------------------------------------

describe("issueDepSlug", () => {
  it("generates gh-N pattern for an issue number", () => {
    expect(issueDepSlug(42)).toBe("gh-42");
  });

  it("generates correct slug for single-digit issue", () => {
    expect(issueDepSlug(7)).toBe("gh-7");
  });

  it("generates correct slug for large issue number", () => {
    expect(issueDepSlug(9999)).toBe("gh-9999");
  });
});

// ---------------------------------------------------------------------------
// buildIssuePlanContent — generates plan file markdown from issue data
// ---------------------------------------------------------------------------

describe("buildIssuePlanContent", () => {
  it("includes depends-on when body has blockers", () => {
    const content = buildIssuePlanContent({
      issueNumber: "100",
      title: "Implement feature X",
      body: "Blocked by #42\n\nDetails here.",
      url: "https://github.com/org/repo/issues/100",
    });
    expect(content).toContain("depends-on: [gh-42]");
    expect(content).toContain("source: github");
    expect(content).toContain("issue: 100");
  });

  it("includes multiple depends-on entries", () => {
    const content = buildIssuePlanContent({
      issueNumber: "100",
      title: "Implement feature X",
      body: "Blocked by #10, #20\nDepends on #30",
      url: "https://github.com/org/repo/issues/100",
    });
    expect(content).toContain("depends-on: [gh-10, gh-20, gh-30]");
  });

  it("omits depends-on when body has no blockers", () => {
    const content = buildIssuePlanContent({
      issueNumber: "50",
      title: "Simple task",
      body: "No blockers here.",
      url: "https://github.com/org/repo/issues/50",
    });
    expect(content).not.toContain("depends-on");
    expect(content).toContain("source: github");
    expect(content).toContain("issue: 50");
  });

  it("omits depends-on when body is empty", () => {
    const content = buildIssuePlanContent({
      issueNumber: "50",
      title: "Simple task",
      body: "",
      url: "https://github.com/org/repo/issues/50",
    });
    expect(content).not.toContain("depends-on");
  });

  it("preserves issue body after frontmatter", () => {
    const content = buildIssuePlanContent({
      issueNumber: "50",
      title: "My task",
      body: "Some details\nMore info",
      url: "https://github.com/org/repo/issues/50",
    });
    expect(content).toContain("# My task");
    expect(content).toContain("Some details\nMore info");
  });
});
