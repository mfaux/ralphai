/**
 * Unit tests for pullGithubIssueByNumber() — the entry point used by
 * `ralphai run <number>` for both standalone issues and PRD sub-issues.
 *
 * Uses mock.module to control `child_process.execSync` so we can verify
 * that the correct label family (standalone vs subissue) is used for
 * the transitionPull() call depending on whether the issue has a PRD parent.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { PullIssueOptions } from "./issues.ts";

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
    // Pass through non-gh commands
    return realExecSync(cmd, options as Parameters<typeof realExecSync>[1]);
  },
}));

// Import AFTER mocking so the module picks up the mock
const { pullGithubIssueByNumber } = await import("./issues.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ralphai-pull-by-number-"));
}

function defaultOptions(
  dir: string,
): PullIssueOptions & { issueNumber: number } {
  return {
    backlogDir: join(dir, ".ralphai", "pipeline", "backlog"),
    cwd: dir,
    issueSource: "github",
    standaloneLabel: "ralphai-standalone",
    standaloneInProgressLabel: "ralphai-standalone:in-progress",
    standaloneDoneLabel: "ralphai-standalone:done",
    standaloneStuckLabel: "ralphai-standalone:stuck",
    subissueLabel: "ralphai-subissue",
    subissueInProgressLabel: "ralphai-subissue:in-progress",
    subissueDoneLabel: "ralphai-subissue:done",
    subissueStuckLabel: "ralphai-subissue:stuck",
    issueRepo: "owner/repo",
    issueCommentProgress: false,
    issueNumber: 201,
  };
}

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

/** Return the list of gh issue edit commands that were called. */
function ghEditCalls(): string[] {
  return mockExecSync.mock.calls
    .filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    )
    .map((call: unknown[]) => call[0] as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecSync.mockReset();
});

// ---------------------------------------------------------------------------
// Cycle 1: Sub-issue (has PRD parent) should use subissue labels
// ---------------------------------------------------------------------------

describe("pullGithubIssueByNumber — sub-issue label selection", () => {
  it("uses subissue labels when issue has a PRD parent", () => {
    mockGhCommands({
      // fetchAndWriteIssuePlan fetches title, body, url
      'gh issue view 201 --repo "owner/repo" --json title --jq': () =>
        "Sub task A",
      'gh issue view 201 --repo "owner/repo" --json body --jq': () =>
        "Sub task body",
      'gh issue view 201 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/201",
      // Parent PRD discovery — issue has a parent with PRD label
      "gh api repos/owner/repo/issues/201/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "ralphai-prd" }],
        }),
      // GraphQL blockers
      "gh api graphql": () =>
        JSON.stringify({
          data: {
            repository: { issue: { blockedBy: { nodes: [] } } },
          },
        }),
      // Label swap
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullGithubIssueByNumber(defaultOptions(dir));
    expect(result.pulled).toBe(true);

    // Verify the transitionPull call used subissue labels, NOT standalone
    const editCalls = ghEditCalls();
    expect(editCalls.length).toBe(1);
    const cmd = editCalls[0]!;

    // Should use subissue labels
    expect(cmd).toContain('--add-label "ralphai-subissue:in-progress"');
    expect(cmd).toContain('--remove-label "ralphai-subissue"');

    // Should NOT contain standalone labels in the edit call
    expect(cmd).not.toContain("ralphai-standalone:in-progress");
    expect(cmd).not.toContain('--remove-label "ralphai-standalone"');
  });
});

// ---------------------------------------------------------------------------
// Cycle 2: Standalone issue (no PRD parent) should use standalone labels
// ---------------------------------------------------------------------------

describe("pullGithubIssueByNumber — standalone label selection", () => {
  it("uses standalone labels when issue has no PRD parent", () => {
    mockGhCommands({
      'gh issue view 42 --repo "owner/repo" --json title --jq': () =>
        "Standalone bug",
      'gh issue view 42 --repo "owner/repo" --json body --jq': () => "Bug body",
      'gh issue view 42 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/42",
      // No parent (API call fails/404)
      "gh api repos/owner/repo/issues/42/parent": () => {
        throw new Error("not found");
      },
      // GraphQL blockers
      "gh api graphql": () =>
        JSON.stringify({
          data: {
            repository: { issue: { blockedBy: { nodes: [] } } },
          },
        }),
      // Label swap
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const opts = { ...defaultOptions(dir), issueNumber: 42 };
    const result = pullGithubIssueByNumber(opts);
    expect(result.pulled).toBe(true);

    // Verify standalone labels were used
    const editCalls = ghEditCalls();
    expect(editCalls.length).toBe(1);
    const cmd = editCalls[0]!;

    expect(cmd).toContain('--add-label "ralphai-standalone:in-progress"');
    expect(cmd).toContain('--remove-label "ralphai-standalone"');

    // Should NOT contain subissue labels
    expect(cmd).not.toContain("ralphai-subissue");
  });
});
