/**
 * Unit tests for the label lifecycle module.
 *
 * Uses setExecImpl() from exec.ts to swap execSync with a mock,
 * verifying transition functions handle success and failure correctly.
 *
 * Tests focus on error paths, dry-run safety, and log output —
 * not on the exact gh CLI strings (which are trivial interpolation).
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
} from "./label-lifecycle.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make all gh commands fail. */
function mockGhFailure(): void {
  mockExecSync.mockImplementation(() => {
    throw new Error("network error");
  });
}

/** Return the list of gh issue edit commands that were called. */
function ghEditCalls(): string[] {
  return mockExecSync.mock.calls
    .filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    )
    .map((call: unknown[]) => call[0] as string);
}

const ISSUE = { number: 42, repo: "acme/widgets" };

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

// ---------------------------------------------------------------------------
// Error paths: each transition returns ok: false on gh failure
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("transitionPull returns ok: false on gh failure", () => {
    mockGhFailure();
    const result = transitionPull(ISSUE, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });

  it("transitionDone returns ok: false on gh failure", () => {
    mockGhFailure();
    const result = transitionDone(ISSUE, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });

  it("transitionStuck returns ok: false on gh failure", () => {
    mockGhFailure();
    const result = transitionStuck(ISSUE, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });

  it("transitionReset returns ok: false on gh failure", () => {
    mockGhFailure();
    const result = transitionReset(ISSUE, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });

  it("prdTransitionInProgress returns ok: false on gh failure", () => {
    mockGhFailure();
    const result = prdTransitionInProgress(
      { number: 100, repo: "acme/widgets" },
      "/tmp",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed");
  });

  it("prdTransitionDone returns ok: false on gh failure", () => {
    mockGhFailure();
    const result = prdTransitionDone(
      { number: 100, repo: "acme/widgets" },
      "/tmp",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed");
  });

  it("prdTransitionStuck returns ok: false on gh failure", () => {
    mockGhFailure();
    const result = prdTransitionStuck(
      { number: 100, repo: "acme/widgets" },
      "/tmp",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed");
  });
});

// ---------------------------------------------------------------------------
// Dry-run safety: no gh issue edit calls when dryRun=true
// ---------------------------------------------------------------------------

describe("dry-run safety — label lifecycle", () => {
  it("transitionPull skips gh call and returns skipped result", () => {
    const result = transitionPull(ISSUE, "/tmp", true);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("[dry-run]");
    expect(result.message).toContain("in-progress");
    expect(ghEditCalls()).toHaveLength(0);
  });

  it("transitionDone skips gh call and returns skipped result", () => {
    const result = transitionDone(ISSUE, "/tmp", true);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("[dry-run]");
    expect(result.message).toContain("in-progress");
    expect(result.message).toContain("done");
    expect(ghEditCalls()).toHaveLength(0);
  });

  it("transitionStuck skips gh call and returns skipped result", () => {
    const result = transitionStuck(ISSUE, "/tmp", true);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("[dry-run]");
    expect(result.message).toContain("in-progress");
    expect(result.message).toContain("stuck");
    expect(ghEditCalls()).toHaveLength(0);
  });

  it("transitionReset skips gh call and returns skipped result", () => {
    const result = transitionReset(ISSUE, "/tmp", true);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("[dry-run]");
    expect(ghEditCalls()).toHaveLength(0);
  });

  it("prdTransitionInProgress skips gh call and returns skipped result", () => {
    const result = prdTransitionInProgress(
      { number: 100, repo: "acme/widgets" },
      "/tmp",
      true,
    );

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("[dry-run]");
    expect(result.message).toContain("in-progress");
    expect(ghEditCalls()).toHaveLength(0);
  });

  it("prdTransitionDone skips gh call and returns skipped result", () => {
    const result = prdTransitionDone(
      { number: 100, repo: "acme/widgets" },
      "/tmp",
      true,
    );

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("[dry-run]");
    expect(result.message).toContain("in-progress");
    expect(result.message).toContain("done");
    expect(ghEditCalls()).toHaveLength(0);
  });

  it("prdTransitionStuck skips gh call and returns skipped result", () => {
    const result = prdTransitionStuck(
      { number: 100, repo: "acme/widgets" },
      "/tmp",
      true,
    );

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("[dry-run]");
    expect(result.message).toContain("stuck");
    expect(ghEditCalls()).toHaveLength(0);
  });

  it("dry-run logs describe the skipped operation", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      transitionStuck(ISSUE, "/tmp", true);
    } finally {
      console.log = origLog;
    }

    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("[dry-run] Would execute label operation");
    expect(logs[0]).toContain("Issue #42");
    expect(logs[0]).toContain("in-progress");
    expect(logs[0]).toContain("stuck");
  });
});

// ---------------------------------------------------------------------------
// Done transitions remove all other state labels
// ---------------------------------------------------------------------------

describe("done transitions remove all other state labels", () => {
  it("transitionDone removes both in-progress and stuck", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    transitionDone(ISSUE, "/tmp");

    const calls = ghEditCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('--add-label "done"');
    expect(calls[0]).toContain('--remove-label "in-progress"');
    expect(calls[0]).toContain('--remove-label "stuck"');
  });

  it("prdTransitionDone removes both in-progress and stuck", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    prdTransitionDone({ number: 100, repo: "acme/widgets" }, "/tmp");

    const calls = ghEditCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('--add-label "done"');
    expect(calls[0]).toContain('--remove-label "in-progress"');
    expect(calls[0]).toContain('--remove-label "stuck"');
  });
});
