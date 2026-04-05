/**
 * Unit tests for the label lifecycle module.
 *
 * Uses mock.module to control `child_process.execSync` so we can verify
 * `gh issue edit` calls without requiring a real GitHub repo.
 *
 * Tests verify correct `--add-label`/`--remove-label` arguments for each
 * transition (pull, done, stuck, reset) and for PRD parent propagation
 * (in-progress, done, stuck).
 *
 * All transition functions use shared state labels (in-progress, done,
 * stuck) — family labels are managed separately and never passed to
 * transition functions.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

const realChildProcess = require("child_process");
const realExecSync =
  realChildProcess.execSync as typeof import("child_process").execSync;

// ---------------------------------------------------------------------------
// Mock child_process.execSync — intercept gh commands only
// ---------------------------------------------------------------------------

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
const {
  transitionPull,
  transitionDone,
  transitionStuck,
  transitionReset,
  prdTransitionInProgress,
  prdTransitionDone,
  prdTransitionStuck,
} = await import("./label-lifecycle.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make all gh commands succeed by returning "ok". */
function mockGhSuccess(): void {
  mockExecSync.mockImplementation(() => "ok");
}

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
  mockExecSync.mockReset();
});

// ---------------------------------------------------------------------------
// transitionPull: add in-progress (family label stays)
// ---------------------------------------------------------------------------

describe("transitionPull", () => {
  it("calls gh issue edit to add in-progress label", () => {
    mockGhSuccess();

    const result = transitionPull(ISSUE, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 42");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "in-progress"');
    // Family label is not touched — no --remove-label
    expect(calls[0]).not.toContain("--remove-label");
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = transitionPull(ISSUE, "/tmp");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// transitionDone: in-progress → done
// ---------------------------------------------------------------------------

describe("transitionDone", () => {
  it("calls gh issue edit to add done and remove in-progress", () => {
    mockGhSuccess();

    const result = transitionDone(ISSUE, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 42");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "done"');
    expect(calls[0]).toContain('--remove-label "in-progress"');
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = transitionDone(ISSUE, "/tmp");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// transitionStuck: in-progress → stuck
// ---------------------------------------------------------------------------

describe("transitionStuck", () => {
  it("calls gh issue edit to add stuck and remove in-progress", () => {
    mockGhSuccess();

    const result = transitionStuck(ISSUE, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 42");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "stuck"');
    expect(calls[0]).toContain('--remove-label "in-progress"');
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = transitionStuck(ISSUE, "/tmp");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// transitionReset: remove in-progress + stuck
// ---------------------------------------------------------------------------

describe("transitionReset", () => {
  it("calls gh issue edit to remove in-progress and stuck labels", () => {
    mockGhSuccess();

    const result = transitionReset(ISSUE, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 42");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--remove-label "in-progress"');
    expect(calls[0]).toContain('--remove-label "stuck"');
    // No --add-label — family label stays untouched
    expect(calls[0]).not.toContain("--add-label");
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = transitionReset(ISSUE, "/tmp");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// prdTransitionInProgress: add in-progress to PRD parent
// ---------------------------------------------------------------------------

describe("prdTransitionInProgress", () => {
  it("calls gh issue edit to add in-progress label", () => {
    mockGhSuccess();

    const prdIssue = { number: 100, repo: "acme/widgets" };
    const result = prdTransitionInProgress(prdIssue, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 100");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "in-progress"');
    // Should NOT have --remove-label (additive only)
    expect(calls[0]).not.toContain("--remove-label");
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = prdTransitionInProgress(
      { number: 100, repo: "acme/widgets" },
      "/tmp",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed");
  });
});

// ---------------------------------------------------------------------------
// prdTransitionDone: in-progress → done on PRD parent
// ---------------------------------------------------------------------------

describe("prdTransitionDone", () => {
  it("calls gh issue edit to add done and remove in-progress", () => {
    mockGhSuccess();

    const prdIssue = { number: 100, repo: "acme/widgets" };
    const result = prdTransitionDone(prdIssue, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 100");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "done"');
    expect(calls[0]).toContain('--remove-label "in-progress"');
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = prdTransitionDone(
      { number: 100, repo: "acme/widgets" },
      "/tmp",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed");
  });
});

// ---------------------------------------------------------------------------
// prdTransitionStuck: add stuck to PRD parent
// ---------------------------------------------------------------------------

describe("prdTransitionStuck", () => {
  it("calls gh issue edit to add stuck label", () => {
    mockGhSuccess();

    const prdIssue = { number: 100, repo: "acme/widgets" };
    const result = prdTransitionStuck(prdIssue, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 100");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "stuck"');
    // Should NOT have --remove-label (additive only)
    expect(calls[0]).not.toContain("--remove-label");
  });

  it("returns ok: false on gh failure", () => {
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
// Shared state labels work the same regardless of issue family
// ---------------------------------------------------------------------------

describe("shared state labels across families", () => {
  it("transitionPull uses the same in-progress label for any issue", () => {
    mockGhSuccess();

    const result = transitionPull({ number: 7, repo: "org/repo" }, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('--add-label "in-progress"');
  });

  it("transitionDone uses the same done/in-progress labels for any issue", () => {
    mockGhSuccess();

    const result = transitionDone({ number: 7, repo: "org/repo" }, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('--add-label "done"');
    expect(calls[0]).toContain('--remove-label "in-progress"');
  });

  it("transitionStuck uses the same stuck/in-progress labels for any issue", () => {
    mockGhSuccess();

    const result = transitionStuck({ number: 201, repo: "org/repo" }, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 201");
    expect(calls[0]).toContain('--add-label "stuck"');
    expect(calls[0]).toContain('--remove-label "in-progress"');
  });

  it("transitionReset removes the same state labels for any issue", () => {
    mockGhSuccess();

    const result = transitionReset({ number: 201, repo: "org/repo" }, "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 201");
    expect(calls[0]).toContain('--remove-label "in-progress"');
    expect(calls[0]).toContain('--remove-label "stuck"');
  });
});

// ---------------------------------------------------------------------------
// Sub-issue stuck + PRD parent propagation pattern
// ---------------------------------------------------------------------------

describe("sub-issue stuck with PRD parent propagation", () => {
  it("sub-issue gets stuck label, PRD parent also gets stuck label", () => {
    mockGhSuccess();

    const subIssue = { number: 201, repo: "org/repo" };
    const prdIssue = { number: 100, repo: "org/repo" };

    // 1. Sub-issue transitions to stuck
    const stuckResult = transitionStuck(subIssue, "/tmp");
    expect(stuckResult.ok).toBe(true);

    // 2. PRD parent gets stuck label propagated
    const prdResult = prdTransitionStuck(prdIssue, "/tmp");
    expect(prdResult.ok).toBe(true);

    // Verify both calls happened
    const calls = ghEditCalls();
    expect(calls.length).toBe(2);

    // First call: sub-issue stuck
    expect(calls[0]).toContain("gh issue edit 201");
    expect(calls[0]).toContain('--add-label "stuck"');
    expect(calls[0]).toContain('--remove-label "in-progress"');

    // Second call: PRD parent gets stuck (additive only)
    expect(calls[1]).toContain("gh issue edit 100");
    expect(calls[1]).toContain('--add-label "stuck"');
    expect(calls[1]).not.toContain("--remove-label");
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

  it("dryRun=false (default) still executes gh calls", () => {
    mockGhSuccess();

    const result = transitionPull(ISSUE, "/tmp");

    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(ghEditCalls()).toHaveLength(1);
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
