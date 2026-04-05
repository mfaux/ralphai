/**
 * Unit tests for checkAllPrdSubIssuesDone() — verifies that the PRD
 * parent transitions to done only when ALL sub-issues have the done label.
 *
 * Uses mock.module to control `child_process.execSync` so we can test
 * the full flow without requiring a real GitHub repo or gh CLI.
 *
 * The shared "done" label is used for all issue families (standalone,
 * subissue, PRD). checkAllPrdSubIssuesDone checks for this fixed label.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock child_process.execSync
// ---------------------------------------------------------------------------

const realChildProcess = require("child_process");
const realExecSync =
  realChildProcess.execSync as typeof import("child_process").execSync;

const mockExecSync = mock();

mock.module("child_process", () => ({
  ...realChildProcess,
  execSync: (...args: Parameters<typeof realExecSync>) => {
    const [cmd, options] = args;
    if (typeof cmd === "string" && cmd.startsWith("gh ")) {
      return mockExecSync(...args);
    }
    return realExecSync(cmd, options as Parameters<typeof realExecSync>[1]);
  },
}));

// Import AFTER mocking so the module picks up the mock
const { checkAllPrdSubIssuesDone } = await import("./issues.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO = "acme/widgets";
const PRD_NUMBER = 100;

/**
 * Build a command router that dispatches gh calls to handler functions.
 * Unmatched commands throw.
 */
function mockGhCommands(
  handlers: Record<string, (cmd: string) => string | Buffer>,
): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (cmd.includes(pattern)) {
        return handler(cmd);
      }
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecSync.mockReset();
});

describe("checkAllPrdSubIssuesDone", () => {
  it("returns true when all sub-issues are closed", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify([
          { number: 201, state: "closed" },
          { number: 202, state: "closed" },
        ]),
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(true);
  });

  it("returns true when all open sub-issues have the done label", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify([
          { number: 201, state: "open" },
          { number: 202, state: "open" },
        ]),
      "gh issue view 201": () => "done",
      "gh issue view 202": () => "done",
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(true);
  });

  it("returns true when mix of closed and done-labeled open sub-issues", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify([
          { number: 201, state: "closed" },
          { number: 202, state: "open" },
        ]),
      "gh issue view 202": () => "done",
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(true);
  });

  it("returns false when an open sub-issue lacks the done label", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify([
          { number: 201, state: "open" },
          { number: 202, state: "open" },
        ]),
      "gh issue view 201": () => "done",
      "gh issue view 202": () => "in-progress",
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(false);
  });

  it("returns false when an open sub-issue has no labels", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify([{ number: 201, state: "open" }]),
      "gh issue view 201": () => "",
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(false);
  });

  it("returns false when sub-issues API fails", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () => {
        throw new Error("API error");
      },
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(false);
  });

  it("returns false when sub-issues API returns invalid JSON", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () => "not json",
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(false);
  });

  it("returns false when sub-issues API returns empty array", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify([]),
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(false);
  });

  it("returns false when sub-issues API returns non-array", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify({ error: "not found" }),
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(false);
  });

  it("returns false when label check API fails for an open sub-issue", () => {
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify([{ number: 201, state: "open" }]),
      "gh issue view 201": () => {
        throw new Error("label check failed");
      },
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(false);
  });

  it("short-circuits on first non-done open sub-issue", () => {
    // Issue 202 should NOT be checked because 201 is not done
    let issue202Checked = false;
    mockGhCommands({
      "gh api repos/acme/widgets/issues/100/sub_issues": () =>
        JSON.stringify([
          { number: 201, state: "open" },
          { number: 202, state: "open" },
        ]),
      "gh issue view": (cmd: string) => {
        if (cmd.includes("201")) return "in-progress";
        if (cmd.includes("202")) {
          issue202Checked = true;
          return "done";
        }
        throw new Error(`Unexpected: ${cmd}`);
      },
    });

    const result = checkAllPrdSubIssuesDone(REPO, PRD_NUMBER, "/tmp");
    expect(result).toBe(false);
    expect(issue202Checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stuck stickiness: reset sub-issue does NOT clear PRD parent stuck label
// ---------------------------------------------------------------------------

describe("stuck stickiness — design verification", () => {
  it("transitionReset only operates on the sub-issue, not the PRD parent", async () => {
    // Reset the mock for this test
    mockExecSync.mockReset();
    mockExecSync.mockImplementation(() => "ok");

    const { transitionReset } = await import("./label-lifecycle.ts");

    const subIssue = { number: 201, repo: "org/repo" };

    // Reset the sub-issue: removes shared state labels
    const result = transitionReset(subIssue, "/tmp");
    expect(result.ok).toBe(true);

    // Verify only ONE gh issue edit call was made — for the sub-issue
    const ghCalls = mockExecSync.mock.calls
      .filter(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("gh issue edit"),
      )
      .map((call: unknown[]) => call[0] as string);

    expect(ghCalls).toHaveLength(1);
    // The call targets the sub-issue (#201), NOT the PRD parent
    expect(ghCalls[0]).toContain("gh issue edit 201");
    // It removes shared state labels
    expect(ghCalls[0]).toContain('--remove-label "in-progress"');
    expect(ghCalls[0]).toContain('--remove-label "stuck"');
    // PRD labels are NOT touched
    expect(ghCalls[0]).not.toContain("ralphai-prd");
  });
});
