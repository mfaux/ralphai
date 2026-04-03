import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { execSync as realExecSync } from "child_process";
import * as realChildProcess from "child_process";
import { issueDepSlug, buildIssuePlanContent } from "./issues.ts";

// ---------------------------------------------------------------------------
// fetchBlockersViaGraphQL — queries GitHub GraphQL API for blocking issues
// ---------------------------------------------------------------------------

// Mock child_process so we can intercept `gh api graphql` calls.
const mockExecSync = mock();

mock.module("child_process", () => ({
  ...realChildProcess,
  execSync: (...args: Parameters<typeof realExecSync>) => {
    const [cmd] = args;
    if (typeof cmd === "string" && cmd.startsWith("gh ")) {
      return mockExecSync(...args);
    }
    return realExecSync(...args);
  },
}));

// Import AFTER mocking so the module picks up our mock.
const { fetchBlockersViaGraphQL } = await import("./issues.ts");

describe("fetchBlockersViaGraphQL", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  afterEach(() => {
    mockExecSync.mockReset();
  });

  it("returns blocker issue numbers from GraphQL response", () => {
    const graphqlResponse = JSON.stringify({
      data: {
        repository: {
          issue: {
            blockedBy: {
              nodes: [{ number: 42 }, { number: 15 }],
            },
          },
        },
      },
    });
    mockExecSync.mockReturnValue(graphqlResponse);

    const result = fetchBlockersViaGraphQL("org/repo", "100", "/tmp");
    expect(result).toEqual([15, 42]);
  });

  it("returns empty array when no blockers exist", () => {
    const graphqlResponse = JSON.stringify({
      data: {
        repository: {
          issue: {
            blockedBy: {
              nodes: [],
            },
          },
        },
      },
    });
    mockExecSync.mockReturnValue(graphqlResponse);

    const result = fetchBlockersViaGraphQL("org/repo", "100", "/tmp");
    expect(result).toEqual([]);
  });

  it("returns empty array when GraphQL query fails (fail-open)", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("gh api graphql failed");
    });

    const result = fetchBlockersViaGraphQL("org/repo", "100", "/tmp");
    expect(result).toEqual([]);
  });

  it("returns empty array when response is invalid JSON (fail-open)", () => {
    mockExecSync.mockReturnValue("not json");

    const result = fetchBlockersViaGraphQL("org/repo", "100", "/tmp");
    expect(result).toEqual([]);
  });

  it("returns empty array when response has no data field", () => {
    mockExecSync.mockReturnValue(
      JSON.stringify({ errors: [{ message: "not found" }] }),
    );

    const result = fetchBlockersViaGraphQL("org/repo", "100", "/tmp");
    expect(result).toEqual([]);
  });

  it("returns empty array for invalid repo format", () => {
    const result = fetchBlockersViaGraphQL("invalid-repo", "100", "/tmp");
    expect(result).toEqual([]);
    // Should not even call gh
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("returns sorted blocker numbers", () => {
    const graphqlResponse = JSON.stringify({
      data: {
        repository: {
          issue: {
            blockedBy: {
              nodes: [{ number: 30 }, { number: 10 }, { number: 20 }],
            },
          },
        },
      },
    });
    mockExecSync.mockReturnValue(graphqlResponse);

    const result = fetchBlockersViaGraphQL("org/repo", "100", "/tmp");
    expect(result).toEqual([10, 20, 30]);
  });

  it("handles single blocker", () => {
    const graphqlResponse = JSON.stringify({
      data: {
        repository: {
          issue: {
            blockedBy: {
              nodes: [{ number: 42 }],
            },
          },
        },
      },
    });
    mockExecSync.mockReturnValue(graphqlResponse);

    const result = fetchBlockersViaGraphQL("org/repo", "100", "/tmp");
    expect(result).toEqual([42]);
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
  it("includes depends-on when blockers are provided", () => {
    const content = buildIssuePlanContent({
      issueNumber: "100",
      title: "Implement feature X",
      body: "Details here.",
      url: "https://github.com/org/repo/issues/100",
      blockers: [42],
    });
    expect(content).toContain("depends-on: [gh-42]");
    expect(content).toContain("source: github");
    expect(content).toContain("issue: 100");
  });

  it("includes multiple depends-on entries", () => {
    const content = buildIssuePlanContent({
      issueNumber: "100",
      title: "Implement feature X",
      body: "Details here.",
      url: "https://github.com/org/repo/issues/100",
      blockers: [10, 20, 30],
    });
    expect(content).toContain("depends-on: [gh-10, gh-20, gh-30]");
  });

  it("omits depends-on when blockers array is empty", () => {
    const content = buildIssuePlanContent({
      issueNumber: "50",
      title: "Simple task",
      body: "No blockers here.",
      url: "https://github.com/org/repo/issues/50",
      blockers: [],
    });
    expect(content).not.toContain("depends-on");
    expect(content).toContain("source: github");
    expect(content).toContain("issue: 50");
  });

  it("omits depends-on when blockers is not provided", () => {
    const content = buildIssuePlanContent({
      issueNumber: "50",
      title: "Simple task",
      body: "",
      url: "https://github.com/org/repo/issues/50",
    });
    expect(content).not.toContain("depends-on");
  });

  it("body text with 'Blocked by #N' produces no depends-on without blockers param", () => {
    const content = buildIssuePlanContent({
      issueNumber: "100",
      title: "Implement feature X",
      body: "Blocked by #42\n\nDetails here.",
      url: "https://github.com/org/repo/issues/100",
    });
    expect(content).not.toContain("depends-on");
    // Body text is preserved but not parsed for blockers
    expect(content).toContain("Blocked by #42");
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

  it("includes prd field when prd number is provided", () => {
    const content = buildIssuePlanContent({
      issueNumber: "100",
      title: "Sub-issue of PRD",
      body: "Implement feature.",
      url: "https://github.com/org/repo/issues/100",
      prd: 245,
    });
    expect(content).toContain("prd: 245");
    expect(content).toContain("source: github");
    expect(content).toContain("issue: 100");
  });

  it("omits prd field when prd is not provided", () => {
    const content = buildIssuePlanContent({
      issueNumber: "50",
      title: "Regular issue",
      body: "No parent PRD.",
      url: "https://github.com/org/repo/issues/50",
    });
    expect(content).not.toContain("prd:");
  });

  it("omits prd field when prd is undefined", () => {
    const content = buildIssuePlanContent({
      issueNumber: "50",
      title: "Regular issue",
      body: "No parent PRD.",
      url: "https://github.com/org/repo/issues/50",
      prd: undefined,
    });
    expect(content).not.toContain("prd:");
  });

  it("includes both prd and depends-on when both are present", () => {
    const content = buildIssuePlanContent({
      issueNumber: "100",
      title: "Sub-issue with blockers",
      body: "Details here.",
      url: "https://github.com/org/repo/issues/100",
      prd: 245,
      blockers: [42],
    });
    expect(content).toContain("prd: 245");
    expect(content).toContain("depends-on: [gh-42]");
    // prd should appear before depends-on in frontmatter
    const prdIdx = content.indexOf("prd: 245");
    const depsIdx = content.indexOf("depends-on:");
    expect(prdIdx).toBeLessThan(depsIdx);
  });
});
