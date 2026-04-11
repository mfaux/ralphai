/**
 * Unit tests for label transition functions with configurable state labels.
 *
 * Verifies that all transition functions (transitionPull, transitionDone,
 * transitionStuck, transitionReset, prdTransitionInProgress, prdTransitionDone,
 * prdTransitionStuck) use custom state label names when provided, and fall
 * back to hardcoded defaults when not.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { setExecImpl } from "./exec.ts";
import {
  transitionPull,
  transitionDone,
  transitionStuck,
  transitionReset,
  prdTransitionInProgress,
  prdTransitionDone,
  prdTransitionStuck,
  checkAllPrdSubIssuesDone,
  type StateLabelConfig,
  type IssueMeta,
  IN_PROGRESS_LABEL,
  DONE_LABEL,
  STUCK_LABEL,
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

const ISSUE: IssueMeta = { number: 42, repo: "acme/widgets" };
const CUSTOM: StateLabelConfig = {
  inProgressLabel: "wip",
  doneLabel: "completed",
  stuckLabel: "blocked",
};

/** Capture the command string passed to execSync. */
function captureCmd(): string | null {
  const calls = mockExecSync.mock.calls;
  if (calls.length === 0) return null;
  return calls[0]![0] as string;
}

// ---------------------------------------------------------------------------
// transitionPull
// ---------------------------------------------------------------------------

describe("transitionPull — custom state labels", () => {
  it("uses default in-progress label when stateLabels omitted", () => {
    mockExecSync.mockReturnValue("");
    transitionPull(ISSUE, "/tmp");
    expect(captureCmd()).toContain(`--add-label "${IN_PROGRESS_LABEL}"`);
  });

  it("uses custom in-progress label when stateLabels provided", () => {
    mockExecSync.mockReturnValue("");
    transitionPull(ISSUE, "/tmp", false, CUSTOM);
    expect(captureCmd()).toContain(`--add-label "wip"`);
  });

  it("includes custom label in dry-run message", () => {
    const result = transitionPull(ISSUE, "/tmp", true, CUSTOM);
    expect(result.message).toContain("wip");
    expect(result.skipped).toBe(true);
  });

  it("includes custom label in success message", () => {
    mockExecSync.mockReturnValue("");
    const result = transitionPull(ISSUE, "/tmp", false, CUSTOM);
    expect(result.message).toContain("wip");
  });

  it("includes custom label in failure message", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fail");
    });
    const result = transitionPull(ISSUE, "/tmp", false, CUSTOM);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("wip");
  });
});

// ---------------------------------------------------------------------------
// transitionDone
// ---------------------------------------------------------------------------

describe("transitionDone — custom state labels", () => {
  it("uses default labels when stateLabels omitted", () => {
    mockExecSync.mockReturnValue("");
    transitionDone(ISSUE, "/tmp");
    const cmd = captureCmd()!;
    expect(cmd).toContain(`--add-label "${DONE_LABEL}"`);
    expect(cmd).toContain(`--remove-label "${IN_PROGRESS_LABEL}"`);
    expect(cmd).toContain(`--remove-label "${STUCK_LABEL}"`);
  });

  it("uses custom labels when stateLabels provided", () => {
    mockExecSync.mockReturnValue("");
    transitionDone(ISSUE, "/tmp", false, CUSTOM);
    const cmd = captureCmd()!;
    expect(cmd).toContain(`--add-label "completed"`);
    expect(cmd).toContain(`--remove-label "wip"`);
    expect(cmd).toContain(`--remove-label "blocked"`);
  });

  it("includes custom labels in success message", () => {
    mockExecSync.mockReturnValue("");
    const result = transitionDone(ISSUE, "/tmp", false, CUSTOM);
    expect(result.message).toContain("wip");
    expect(result.message).toContain("completed");
  });
});

// ---------------------------------------------------------------------------
// transitionStuck
// ---------------------------------------------------------------------------

describe("transitionStuck — custom state labels", () => {
  it("uses custom labels when stateLabels provided", () => {
    mockExecSync.mockReturnValue("");
    transitionStuck(ISSUE, "/tmp", false, CUSTOM);
    const cmd = captureCmd()!;
    expect(cmd).toContain(`--add-label "blocked"`);
    expect(cmd).toContain(`--remove-label "wip"`);
  });

  it("includes custom labels in success message", () => {
    mockExecSync.mockReturnValue("");
    const result = transitionStuck(ISSUE, "/tmp", false, CUSTOM);
    expect(result.message).toContain("wip");
    expect(result.message).toContain("blocked");
  });
});

// ---------------------------------------------------------------------------
// transitionReset
// ---------------------------------------------------------------------------

describe("transitionReset — custom state labels", () => {
  it("uses custom labels when stateLabels provided", () => {
    mockExecSync.mockReturnValue("");
    transitionReset(ISSUE, "/tmp", false, CUSTOM);
    const cmd = captureCmd()!;
    expect(cmd).toContain(`--remove-label "wip"`);
    expect(cmd).toContain(`--remove-label "blocked"`);
  });
});

// ---------------------------------------------------------------------------
// PRD transitions
// ---------------------------------------------------------------------------

describe("prdTransitionInProgress — custom state labels", () => {
  it("uses custom in-progress label", () => {
    mockExecSync.mockReturnValue("");
    prdTransitionInProgress(ISSUE, "/tmp", false, CUSTOM);
    expect(captureCmd()).toContain(`--add-label "wip"`);
  });
});

describe("prdTransitionDone — custom state labels", () => {
  it("uses custom labels", () => {
    mockExecSync.mockReturnValue("");
    prdTransitionDone(ISSUE, "/tmp", false, CUSTOM);
    const cmd = captureCmd()!;
    expect(cmd).toContain(`--add-label "completed"`);
    expect(cmd).toContain(`--remove-label "wip"`);
    expect(cmd).toContain(`--remove-label "blocked"`);
  });
});

describe("prdTransitionStuck — custom state labels", () => {
  it("uses custom stuck label", () => {
    mockExecSync.mockReturnValue("");
    prdTransitionStuck(ISSUE, "/tmp", false, CUSTOM);
    expect(captureCmd()).toContain(`--add-label "blocked"`);
  });
});

// ---------------------------------------------------------------------------
// checkAllPrdSubIssuesDone — custom done label
// ---------------------------------------------------------------------------

describe("checkAllPrdSubIssuesDone — custom state labels", () => {
  it("checks for custom done label instead of default", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("gh api")) {
        return JSON.stringify([{ number: 201, state: "open" }]);
      }
      if (cmd.includes("gh issue view 201")) {
        return "completed";
      }
      throw new Error(`Unexpected: ${cmd}`);
    });

    const result = checkAllPrdSubIssuesDone(
      "acme/widgets",
      100,
      "/tmp",
      CUSTOM,
    );
    expect(result).toBe(true);
  });

  it("returns false when sub-issue has default done label but custom is configured", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("gh api")) {
        return JSON.stringify([{ number: 201, state: "open" }]);
      }
      if (cmd.includes("gh issue view 201")) {
        // Has the default "done" label, but config uses "completed"
        return "done";
      }
      throw new Error(`Unexpected: ${cmd}`);
    });

    const result = checkAllPrdSubIssuesDone(
      "acme/widgets",
      100,
      "/tmp",
      CUSTOM,
    );
    expect(result).toBe(false);
  });
});
