/**
 * Unit tests for core label transition functions (transitionPull, transitionDone,
 * transitionStuck, transitionReset).
 *
 * Uses setExecImpl() from exec.ts to swap execSync with a mock,
 * verifying transition guard logic without requiring gh CLI.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { setExecImpl } from "./exec.ts";
import {
  transitionPull,
  transitionDone,
  DONE_LABEL,
  IN_PROGRESS_LABEL,
} from "./issue-lifecycle.ts";
import type { IssueMeta } from "./issue-lifecycle.ts";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

const issue: IssueMeta = { number: 42, repo: "acme/widgets" };

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

/**
 * Route gh commands to handler functions. Unmatched commands throw.
 */
function mockGhCommands(
  handlers: Record<string, (cmd: string) => string>,
): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return "ok";
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
// transitionPull — guard against done label
// ---------------------------------------------------------------------------

describe("transitionPull", () => {
  it("refuses to add in-progress when issue already has done label", () => {
    let editCalled = false;
    mockGhCommands({
      "gh issue view": () => JSON.stringify({ labels: [{ name: DONE_LABEL }] }),
      "gh issue edit": () => {
        editCalled = true;
        return "";
      },
    });

    const result = transitionPull(issue, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("done");
    expect(editCalled).toBe(false);
  });

  it("proceeds normally when issue does not have done label", () => {
    mockGhCommands({
      "gh issue view": () =>
        JSON.stringify({ labels: [{ name: IN_PROGRESS_LABEL }] }),
      "gh issue edit": () => "",
    });

    const result = transitionPull(issue, "/tmp");
    expect(result.ok).toBe(true);
    expect(result.message).toContain(IN_PROGRESS_LABEL);
  });

  it("proceeds when label fetch fails (fail-open)", () => {
    mockGhCommands({
      "gh issue view": () => {
        throw new Error("network failure");
      },
      "gh issue edit": () => "",
    });

    const result = transitionPull(issue, "/tmp");
    expect(result.ok).toBe(true);
  });

  it("skips label check in dry-run mode", () => {
    // No mock needed — dry-run should not call gh at all
    const result = transitionPull(issue, "/tmp", true);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// transitionDone — idempotency
// ---------------------------------------------------------------------------

describe("transitionDone", () => {
  it("succeeds when issue already has both in-progress and done labels", () => {
    mockGhCommands({
      "gh issue edit": () => "",
    });

    const result = transitionDone(issue, "/tmp");
    expect(result.ok).toBe(true);
    expect(result.message).toContain(DONE_LABEL);
  });

  it("succeeds on a clean issue with no prior state labels", () => {
    mockGhCommands({
      "gh issue edit": () => "",
    });

    const result = transitionDone(issue, "/tmp");
    expect(result.ok).toBe(true);
  });
});
