/**
 * Boundary tests for src/issue-lifecycle.ts — verifies re-exported types
 * compile and tests functions not covered by dedicated test files.
 *
 * Most functions re-exported by the facade have their own test files
 * (e.g. issue-blockers.test.ts, label-lifecycle.test.ts, etc.) which
 * already import from issue-lifecycle.ts, implicitly proving the
 * re-exports work. This file covers only the remaining gaps.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { setExecImpl } from "./exec.ts";

// Import functions tested only here (no dedicated test file)
import {
  fetchIssueWithLabels,
  discoverParentIssue,
  peekPrdIssues,
  pullGithubIssueByNumber,
  fetchIssueTitleByNumber,
} from "./issue-lifecycle.ts";

// Import types to verify they're re-exported (compile-time check)
import type {
  PullIssueOptions,
  PullIssueResult,
  PeekIssueOptions,
  PeekIssueResult,
  BuildIssuePlanContentOptions,
  IssueWithLabels,
  ParentIssueResult,
  PrdIssue,
  IssueMeta,
  LabelTransitionResult,
  DispatchFamily,
  DispatchClassified,
  DispatchUnrecognized,
  DispatchResult,
  ValidationPassed,
  ValidationFailed,
  ValidationResult,
  LabelConfig,
  PrdSubIssue,
  PrdDiscoveryResultPrd,
  PrdDiscoveryResultIssue,
  PrdDiscoveryResult,
  BlockedSubIssue,
  PrdHitlSummaryInput,
  RestoreIssueLabelsOptions,
  RestoreIssueLabelsResult,
} from "./issue-lifecycle.ts";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

beforeEach(() => {
  restoreExec = setExecImpl(mockExecSync as any);
  mockExecSync.mockReset();
});

afterEach(() => {
  restoreExec();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockGhAvailable(): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (typeof cmd === "string" && cmd.includes("gh --version"))
      return "gh version 2.0.0";
    if (typeof cmd === "string" && cmd.includes("gh auth status")) return "";
    throw new Error("unknown command");
  });
}

function mockGhUnavailable(): void {
  mockExecSync.mockImplementation(() => {
    throw new Error("not found");
  });
}

// ---------------------------------------------------------------------------
// Functions only tested here (no dedicated test file)
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: fetchIssueWithLabels", () => {
  it("throws when gh unavailable", () => {
    mockGhUnavailable();
    expect(() => fetchIssueWithLabels("acme/repo", 42, "/tmp")).toThrow(
      "gh CLI",
    );
  });

  it("returns issue data on success", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("gh --version")) return "gh 2.0.0";
      if (cmd.includes("gh auth status")) return "";
      if (cmd.includes("gh issue view"))
        return JSON.stringify({
          title: "Fix bug",
          body: "Details",
          labels: [{ name: "bug" }],
        });
      throw new Error("unexpected");
    });
    const result = fetchIssueWithLabels("acme/repo", 42, "/tmp");
    expect(result.title).toBe("Fix bug");
    expect(result.labels).toEqual(["bug"]);
  });
});

describe("issue-lifecycle facade: discoverParentIssue", () => {
  it("returns hasParent false when API fails", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("gh --version")) return "gh 2.0.0";
      if (cmd.includes("gh auth status")) return "";
      throw new Error("404");
    });
    const result = discoverParentIssue("acme/repo", 42, "/tmp");
    expect(result.hasParent).toBe(false);
  });
});

describe("issue-lifecycle facade: peekPrdIssues", () => {
  it("returns not found when issue source is not github", () => {
    const result = peekPrdIssues({
      cwd: "/tmp",
      issueSource: "local",
      standaloneLabel: "ralphai",
      issueRepo: "",
    });
    expect(result.found).toBe(false);
  });
});

describe("issue-lifecycle facade: pullGithubIssueByNumber", () => {
  it("returns not pulled when issue source is not github", () => {
    const result = pullGithubIssueByNumber({
      backlogDir: "/tmp/backlog",
      cwd: "/tmp",
      issueSource: "local",
      standaloneLabel: "ralphai",
      issueRepo: "",
      issueCommentProgress: false,
      issueNumber: 1,
    });
    expect(result.pulled).toBe(false);
  });
});

describe("issue-lifecycle facade: fetchIssueTitleByNumber", () => {
  it("throws when gh unavailable", () => {
    mockGhUnavailable();
    expect(() => fetchIssueTitleByNumber("acme/repo", 5, "/tmp")).toThrow();
  });
});
