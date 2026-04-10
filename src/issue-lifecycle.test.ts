/**
 * Boundary tests for src/issue-lifecycle.ts — verifies every re-exported
 * function is accessible through the facade and delegates correctly.
 *
 * Pure functions are tested with representative inputs.
 * I/O functions use setExecImpl() to swap execSync with a mock.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { setExecImpl } from "./exec.ts";
import { useTempDir } from "./test-utils.ts";

// Import everything from the facade
import {
  // issues.ts (naming functions tested in issue-naming.test.ts)
  checkGhAvailable,
  detectIssueRepo,
  fetchBlockersViaGraphQL,
  buildIssuePlanContent,
  peekGithubIssues,
  peekPrdIssues,
  discoverParentPrd,
  fetchIssueWithLabels,
  discoverParentIssue,
  pullGithubIssues,
  pullPrdSubIssue,
  fetchPrdIssueByNumber,
  fetchPrdIssue,
  fetchIssueTitleByNumber,
  pullGithubIssueByNumber,
  checkAllPrdSubIssuesDone,
  // label-lifecycle.ts
  transitionPull,
  transitionDone,
  transitionStuck,
  transitionReset,
  prdTransitionInProgress,
  prdTransitionDone,
  prdTransitionStuck,
  // labels.ts
  IN_PROGRESS_LABEL,
  DONE_LABEL,
  STUCK_LABEL,
  STATE_LABELS,
  // issue-dispatch.ts
  classifyIssue,
  validateStandalone,
  validateSubissue,
  // prd-discovery.ts
  discoverPrdTarget,
  // prd-hitl.ts
  findHitlBlockers,
  formatPrdHitlSummary,
  // reset-labels.ts
  restoreIssueLabels,
} from "./issue-lifecycle.ts";

// Import types to verify they're re-exported
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
// Helper: make gh available (version + auth succeed)
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
// issues.ts re-exports — pure functions (naming tests in issue-naming.test.ts)
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: buildIssuePlanContent", () => {
  it("buildIssuePlanContent produces frontmatter + body", () => {
    const content = buildIssuePlanContent({
      issueNumber: "7",
      title: "Add tests",
      body: "We need tests.",
      url: "https://github.com/acme/repo/issues/7",
    });
    expect(content).toContain("source: github");
    expect(content).toContain("issue: 7");
    expect(content).toContain("# Add tests");
    expect(content).toContain("We need tests.");
  });

  it("buildIssuePlanContent includes prd and depends-on", () => {
    const content = buildIssuePlanContent({
      issueNumber: "10",
      title: "Sub task",
      body: "body",
      url: "https://github.com/acme/repo/issues/10",
      prd: 5,
      blockers: [3, 8],
    });
    expect(content).toContain("prd: 5");
    expect(content).toContain("depends-on: [gh-3, gh-8]");
  });
});

// ---------------------------------------------------------------------------
// issues.ts re-exports — I/O functions
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: detectIssueRepo", () => {
  it("returns config repo when provided", () => {
    const result = detectIssueRepo("/tmp", "acme/widgets");
    expect(result).toBe("acme/widgets");
  });

  it("returns null when no config and git remote fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    const result = detectIssueRepo("/tmp", "");
    expect(result).toBeNull();
  });
});

describe("issue-lifecycle facade: checkGhAvailable", () => {
  it("returns false when gh not found", () => {
    mockGhUnavailable();
    expect(checkGhAvailable()).toBe(false);
  });

  it("returns true when gh available and authed", () => {
    mockGhAvailable();
    expect(checkGhAvailable()).toBe(true);
  });
});

describe("issue-lifecycle facade: fetchBlockersViaGraphQL", () => {
  it("returns empty array on failure", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("network error");
    });
    const result = fetchBlockersViaGraphQL("acme/widgets", "42", "/tmp");
    expect(result).toEqual([]);
  });

  it("returns blocker numbers on success", () => {
    mockExecSync.mockReturnValue(
      JSON.stringify({
        data: {
          repository: {
            issue: { blockedBy: { nodes: [{ number: 10 }, { number: 5 }] } },
          },
        },
      }),
    );
    const result = fetchBlockersViaGraphQL("acme/widgets", "42", "/tmp");
    expect(result).toEqual([5, 10]);
  });
});

describe("issue-lifecycle facade: peekGithubIssues", () => {
  it("returns not found when issue source is not github", () => {
    const result = peekGithubIssues({
      cwd: "/tmp",
      issueSource: "local",
      standaloneLabel: "ralphai",
      issueRepo: "",
    });
    expect(result.found).toBe(false);
  });

  it("returns not found when gh unavailable", () => {
    mockGhUnavailable();
    const result = peekGithubIssues({
      cwd: "/tmp",
      issueSource: "github",
      standaloneLabel: "ralphai",
      issueRepo: "acme/repo",
    });
    expect(result.found).toBe(false);
    expect(result.message).toContain("gh CLI");
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

describe("issue-lifecycle facade: discoverParentPrd", () => {
  it("returns undefined when API call fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("404");
    });
    const result = discoverParentPrd("acme/repo", "42", "/tmp");
    expect(result).toBeUndefined();
  });

  it("returns parent number when parent has PRD label", () => {
    mockExecSync.mockReturnValue(
      JSON.stringify({
        number: 10,
        labels: [{ name: "ralphai-prd" }],
      }),
    );
    const result = discoverParentPrd("acme/repo", "42", "/tmp");
    expect(result).toBe(10);
  });
});

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

describe("issue-lifecycle facade: pullGithubIssues", () => {
  it("returns not pulled when issue source is not github", () => {
    const result = pullGithubIssues({
      backlogDir: "/tmp/backlog",
      cwd: "/tmp",
      issueSource: "local",
      standaloneLabel: "ralphai",
      issueRepo: "",
      issueCommentProgress: false,
    });
    expect(result.pulled).toBe(false);
  });
});

describe("issue-lifecycle facade: fetchPrdIssue", () => {
  it("throws when gh unavailable", () => {
    mockGhUnavailable();
    expect(() => fetchPrdIssue("acme/repo", "/tmp")).toThrow("gh CLI");
  });
});

describe("issue-lifecycle facade: fetchPrdIssueByNumber", () => {
  it("throws when gh unavailable", () => {
    mockGhUnavailable();
    expect(() => fetchPrdIssueByNumber("acme/repo", 5, "/tmp")).toThrow();
  });
});

describe("issue-lifecycle facade: fetchIssueTitleByNumber", () => {
  it("throws when gh unavailable", () => {
    mockGhUnavailable();
    expect(() => fetchIssueTitleByNumber("acme/repo", 5, "/tmp")).toThrow();
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

describe("issue-lifecycle facade: pullPrdSubIssue", () => {
  it("returns not pulled when issue source is not github", () => {
    const result = pullPrdSubIssue({
      backlogDir: "/tmp/backlog",
      cwd: "/tmp",
      issueSource: "local",
      standaloneLabel: "ralphai",
      issueRepo: "",
      issueCommentProgress: false,
    });
    expect(result.pulled).toBe(false);
  });
});

describe("issue-lifecycle facade: checkAllPrdSubIssuesDone", () => {
  it("returns true when all sub-issues are closed", () => {
    mockExecSync.mockReturnValue(
      JSON.stringify([{ number: 1, state: "closed" }]),
    );
    expect(checkAllPrdSubIssuesDone("acme/repo", 5, "/tmp")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// label-lifecycle.ts re-exports
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: label transitions", () => {
  const ISSUE: IssueMeta = { number: 42, repo: "acme/widgets" };

  it("transitionPull succeeds", () => {
    mockExecSync.mockReturnValue("");
    const r = transitionPull(ISSUE, "/tmp");
    expect(r.ok).toBe(true);
  });

  it("transitionPull dry-run skips", () => {
    const r = transitionPull(ISSUE, "/tmp", true);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it("transitionDone succeeds", () => {
    mockExecSync.mockReturnValue("");
    const r = transitionDone(ISSUE, "/tmp");
    expect(r.ok).toBe(true);
  });

  it("transitionStuck succeeds", () => {
    mockExecSync.mockReturnValue("");
    const r = transitionStuck(ISSUE, "/tmp");
    expect(r.ok).toBe(true);
  });

  it("transitionReset succeeds", () => {
    mockExecSync.mockReturnValue("");
    const r = transitionReset(ISSUE, "/tmp");
    expect(r.ok).toBe(true);
  });

  it("prdTransitionInProgress succeeds", () => {
    mockExecSync.mockReturnValue("");
    const r = prdTransitionInProgress(ISSUE, "/tmp");
    expect(r.ok).toBe(true);
  });

  it("prdTransitionDone succeeds", () => {
    mockExecSync.mockReturnValue("");
    const r = prdTransitionDone(ISSUE, "/tmp");
    expect(r.ok).toBe(true);
  });

  it("prdTransitionStuck succeeds", () => {
    mockExecSync.mockReturnValue("");
    const r = prdTransitionStuck(ISSUE, "/tmp");
    expect(r.ok).toBe(true);
  });

  it("transitions fail on gh error", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fail");
    });
    expect(transitionPull(ISSUE, "/tmp").ok).toBe(false);
    expect(transitionDone(ISSUE, "/tmp").ok).toBe(false);
    expect(transitionStuck(ISSUE, "/tmp").ok).toBe(false);
    expect(transitionReset(ISSUE, "/tmp").ok).toBe(false);
    expect(prdTransitionInProgress(ISSUE, "/tmp").ok).toBe(false);
    expect(prdTransitionDone(ISSUE, "/tmp").ok).toBe(false);
    expect(prdTransitionStuck(ISSUE, "/tmp").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// labels.ts re-exports
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: label constants", () => {
  it("exports correct label values", () => {
    expect(IN_PROGRESS_LABEL).toBe("in-progress");
    expect(DONE_LABEL).toBe("done");
    expect(STUCK_LABEL).toBe("stuck");
    expect(STATE_LABELS).toEqual(["in-progress", "done", "stuck"]);
  });
});

// ---------------------------------------------------------------------------
// issue-dispatch.ts re-exports
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: classifyIssue", () => {
  const config: LabelConfig = {
    standaloneLabel: "ralphai-standalone",
    subissueLabel: "ralphai-subissue",
    prdLabel: "ralphai-prd",
  };

  it("classifies standalone", () => {
    const r = classifyIssue(["ralphai-standalone"], config);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.family).toBe("standalone");
  });

  it("classifies subissue", () => {
    const r = classifyIssue(["ralphai-subissue"], config);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.family).toBe("subissue");
  });

  it("classifies prd", () => {
    const r = classifyIssue(["ralphai-prd"], config);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.family).toBe("prd");
  });

  it("returns no-label for unrecognized", () => {
    const r = classifyIssue(["bug"], config);
    expect(r.ok).toBe(false);
  });
});

describe("issue-lifecycle facade: validateStandalone", () => {
  it("passes when no parent", () => {
    expect(validateStandalone(1, undefined).valid).toBe(true);
  });

  it("fails when parent PRD exists", () => {
    const r = validateStandalone(1, 10);
    expect(r.valid).toBe(false);
  });
});

describe("issue-lifecycle facade: validateSubissue", () => {
  it("passes when parent with PRD label", () => {
    expect(validateSubissue(1, 10, true).valid).toBe(true);
  });

  it("fails when no parent", () => {
    expect(validateSubissue(1, undefined, false).valid).toBe(false);
  });

  it("fails when parent lacks PRD label", () => {
    expect(validateSubissue(1, 10, false).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// prd-discovery.ts re-exports
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: discoverPrdTarget", () => {
  it("throws when gh unavailable", () => {
    mockGhUnavailable();
    expect(() => discoverPrdTarget("acme/repo", 5, "/tmp")).toThrow("gh CLI");
  });

  it("returns non-PRD result for issue without label", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("gh --version")) return "gh 2.0.0";
      if (cmd.includes("gh auth status")) return "";
      if (cmd.includes("gh issue view"))
        return JSON.stringify({
          title: "Bug fix",
          body: "details",
          labels: [{ name: "bug" }],
        });
      throw new Error("unexpected");
    });
    const r = discoverPrdTarget("acme/repo", 5, "/tmp");
    expect(r.isPrd).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// prd-hitl.ts re-exports
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: findHitlBlockers", () => {
  it("returns matching HITL blockers", () => {
    const result = findHitlBlockers(["gh-42", "gh-99"], new Set([42]));
    expect(result).toEqual([42]);
  });

  it("returns empty when no matches", () => {
    expect(findHitlBlockers(["gh-1"], new Set([42]))).toEqual([]);
  });
});

describe("issue-lifecycle facade: formatPrdHitlSummary", () => {
  it("formats summary with all fields", () => {
    const lines = formatPrdHitlSummary({
      prdNumber: 5,
      totalSubIssues: 4,
      completedCount: 2,
      stuckSubIssues: [3],
      hitlSubIssues: [7],
      blockedSubIssues: [{ number: 8, blockedBy: [7] }],
    });
    expect(lines.some((l) => l.includes("PRD #5"))).toBe(true);
    expect(lines.some((l) => l.includes("2/4"))).toBe(true);
    expect(lines.some((l) => l.includes("#3"))).toBe(true);
    expect(lines.some((l) => l.includes("HITL"))).toBe(true);
    expect(lines.some((l) => l.includes("Blocked"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reset-labels.ts re-exports
// ---------------------------------------------------------------------------

describe("issue-lifecycle facade: restoreIssueLabels", () => {
  const tmpDir = useTempDir();

  it("returns not restored for non-github plan", () => {
    const planPath = join(tmpDir.dir, "plan.md");
    writeFileSync(planPath, "---\nsource: local\n---\n\n# Plan\n");
    const result = restoreIssueLabels({
      planPath,
      issueRepo: "acme/repo",
      cwd: tmpDir.dir,
    });
    expect(result.restored).toBe(false);
  });

  it("returns not restored when gh unavailable for github plan", () => {
    mockGhUnavailable();
    const planPath = join(tmpDir.dir, "plan.md");
    writeFileSync(
      planPath,
      "---\nsource: github\nissue: 42\nissue-url: https://github.com/acme/repo/issues/42\n---\n\n# Plan\n",
    );
    const result = restoreIssueLabels({
      planPath,
      issueRepo: "acme/repo",
      cwd: tmpDir.dir,
    });
    expect(result.restored).toBe(false);
    expect(result.message).toContain("gh CLI");
  });
});
