/**
 * Unit tests for the label lifecycle module.
 *
 * Uses mock.module to control `child_process.execSync` so we can verify
 * `gh issue edit` calls without requiring a real GitHub repo.
 *
 * Tests verify correct `--add-label`/`--remove-label` arguments for each
 * transition (pull, done, stuck, reset) and for PRD parent propagation
 * (in-progress, done, stuck).
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
// transitionPull: intake → in-progress
// ---------------------------------------------------------------------------

describe("transitionPull", () => {
  it("calls gh issue edit with correct add/remove labels", () => {
    mockGhSuccess();

    const result = transitionPull(
      ISSUE,
      "ralphai-standalone",
      "ralphai-standalone:in-progress",
      "/tmp",
    );

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 42");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "ralphai-standalone:in-progress"');
    expect(calls[0]).toContain('--remove-label "ralphai-standalone"');
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = transitionPull(
      ISSUE,
      "ralphai-standalone",
      "ralphai-standalone:in-progress",
      "/tmp",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// transitionDone: in-progress → done
// ---------------------------------------------------------------------------

describe("transitionDone", () => {
  it("calls gh issue edit with correct add/remove labels", () => {
    mockGhSuccess();

    const result = transitionDone(
      ISSUE,
      "ralphai-standalone:in-progress",
      "ralphai-standalone:done",
      "/tmp",
    );

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 42");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "ralphai-standalone:done"');
    expect(calls[0]).toContain(
      '--remove-label "ralphai-standalone:in-progress"',
    );
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = transitionDone(
      ISSUE,
      "ralphai-standalone:in-progress",
      "ralphai-standalone:done",
      "/tmp",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// transitionStuck: in-progress → stuck
// ---------------------------------------------------------------------------

describe("transitionStuck", () => {
  it("calls gh issue edit with correct add/remove labels", () => {
    mockGhSuccess();

    const result = transitionStuck(
      ISSUE,
      "ralphai-standalone:in-progress",
      "ralphai-standalone:stuck",
      "/tmp",
    );

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 42");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "ralphai-standalone:stuck"');
    expect(calls[0]).toContain(
      '--remove-label "ralphai-standalone:in-progress"',
    );
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = transitionStuck(
      ISSUE,
      "ralphai-standalone:in-progress",
      "ralphai-standalone:stuck",
      "/tmp",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// transitionReset: in-progress/stuck → intake
// ---------------------------------------------------------------------------

describe("transitionReset", () => {
  it("calls gh issue edit to add intake and remove in-progress + stuck", () => {
    mockGhSuccess();

    const result = transitionReset(
      ISSUE,
      "ralphai-standalone",
      "ralphai-standalone:in-progress",
      "ralphai-standalone:stuck",
      "/tmp",
    );

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 42");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "ralphai-standalone"');
    expect(calls[0]).toContain(
      '--remove-label "ralphai-standalone:in-progress"',
    );
    expect(calls[0]).toContain('--remove-label "ralphai-standalone:stuck"');
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = transitionReset(
      ISSUE,
      "ralphai-standalone",
      "ralphai-standalone:in-progress",
      "ralphai-standalone:stuck",
      "/tmp",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// prdTransitionInProgress: add in-progress to PRD parent
// ---------------------------------------------------------------------------

describe("prdTransitionInProgress", () => {
  it("calls gh issue edit to add prd in-progress label", () => {
    mockGhSuccess();

    const prdIssue = { number: 100, repo: "acme/widgets" };
    const result = prdTransitionInProgress(
      prdIssue,
      "ralphai-prd:in-progress",
      "/tmp",
    );

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 100");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "ralphai-prd:in-progress"');
    // Should NOT have --remove-label (additive only)
    expect(calls[0]).not.toContain("--remove-label");
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = prdTransitionInProgress(
      { number: 100, repo: "acme/widgets" },
      "ralphai-prd:in-progress",
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
    const result = prdTransitionDone(
      prdIssue,
      "ralphai-prd:in-progress",
      "ralphai-prd:done",
      "/tmp",
    );

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 100");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "ralphai-prd:done"');
    expect(calls[0]).toContain('--remove-label "ralphai-prd:in-progress"');
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = prdTransitionDone(
      { number: 100, repo: "acme/widgets" },
      "ralphai-prd:in-progress",
      "ralphai-prd:done",
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
  it("calls gh issue edit to add prd stuck label", () => {
    mockGhSuccess();

    const prdIssue = { number: 100, repo: "acme/widgets" };
    const result = prdTransitionStuck(prdIssue, "ralphai-prd:stuck", "/tmp");

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("gh issue edit 100");
    expect(calls[0]).toContain('--repo "acme/widgets"');
    expect(calls[0]).toContain('--add-label "ralphai-prd:stuck"');
    // Should NOT have --remove-label (additive only)
    expect(calls[0]).not.toContain("--remove-label");
  });

  it("returns ok: false on gh failure", () => {
    mockGhFailure();

    const result = prdTransitionStuck(
      { number: 100, repo: "acme/widgets" },
      "ralphai-prd:stuck",
      "/tmp",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed");
  });
});

// ---------------------------------------------------------------------------
// Cross-family: works with subissue labels too
// ---------------------------------------------------------------------------

describe("cross-family labels", () => {
  it("transitionPull works with subissue labels", () => {
    mockGhSuccess();

    const result = transitionPull(
      { number: 7, repo: "org/repo" },
      "ralphai-subissue",
      "ralphai-subissue:in-progress",
      "/tmp",
    );

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('--add-label "ralphai-subissue:in-progress"');
    expect(calls[0]).toContain('--remove-label "ralphai-subissue"');
  });

  it("transitionDone works with custom label base names", () => {
    mockGhSuccess();

    const result = transitionDone(
      { number: 7, repo: "org/repo" },
      "my-custom:in-progress",
      "my-custom:done",
      "/tmp",
    );

    expect(result.ok).toBe(true);

    const calls = ghEditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('--add-label "my-custom:done"');
    expect(calls[0]).toContain('--remove-label "my-custom:in-progress"');
  });
});
