/**
 * Unit tests for checkAllPrdSubIssuesDone() — verifies that the PRD
 * parent transitions to done only when ALL sub-issues have the done label.
 *
 * Uses setExecImpl() to swap execSync with a mock so we can test
 * the full flow without requiring a real GitHub repo or gh CLI.
 *
 * The shared "done" label is used for all issue families (standalone,
 * subissue, PRD). checkAllPrdSubIssuesDone checks for this fixed label.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { setExecImpl } from "./exec.ts";
import { checkAllPrdSubIssuesDone } from "./issues.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

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
  restoreExec = setExecImpl(mockExecSync as any);
  mockExecSync.mockReset();
});

afterEach(() => {
  restoreExec();
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
