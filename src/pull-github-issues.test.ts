/**
 * Unit tests for pullGithubIssues() — the auto-drain entry point that discovers
 * standalone issues from GitHub.
 *
 * Uses setExecImpl() from exec.ts to swap execSync with a mock,
 * verifying the full flow (issue listing → label filtering → plan write)
 * without requiring a real GitHub repo or gh CLI.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { PullIssueOptions } from "./issue-lifecycle.ts";
import { setExecImpl } from "./exec.ts";
import { pullGithubIssues } from "./issue-lifecycle.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ralphai-standalone-pull-"));
}

function defaultOptions(dir: string): PullIssueOptions {
  return {
    backlogDir: join(dir, ".ralphai", "pipeline", "backlog"),
    cwd: dir,
    issueSource: "github",
    standaloneLabel: "ralphai-standalone",
    issueRepo: "owner/repo",
    issueCommentProgress: false,
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
// State-label filtering
// ---------------------------------------------------------------------------

describe("pullGithubIssues — state-label filtering", () => {
  it("skips an issue with in-progress label and returns pulled:false", () => {
    mockGhCommands({
      "gh issue list": () => JSON.stringify([{ number: 42 }]),
      // Label check for #42 — has in-progress
      'gh issue view 42 --repo "owner/repo" --json labels': () => "in-progress",
    });

    const dir = makeTempDir();
    const result = pullGithubIssues(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("in-progress");
  });

  it("skips an issue with done label and returns pulled:false", () => {
    mockGhCommands({
      "gh issue list": () => JSON.stringify([{ number: 42 }]),
      'gh issue view 42 --repo "owner/repo" --json labels': () => "done",
    });

    const dir = makeTempDir();
    const result = pullGithubIssues(defaultOptions(dir));
    expect(result.pulled).toBe(false);
  });

  it("skips an issue with stuck label and returns pulled:false", () => {
    mockGhCommands({
      "gh issue list": () => JSON.stringify([{ number: 42 }]),
      'gh issue view 42 --repo "owner/repo" --json labels': () => "stuck",
    });

    const dir = makeTempDir();
    const result = pullGithubIssues(defaultOptions(dir));
    expect(result.pulled).toBe(false);
  });

  it("selects next eligible issue when oldest has in-progress", () => {
    // gh issue list returns newest first, so [99, 50, 42] → oldest is 42
    mockGhCommands({
      "gh issue list": () =>
        JSON.stringify([{ number: 99 }, { number: 50 }, { number: 42 }]),
      // #42 (oldest) has in-progress
      'gh issue view 42 --repo "owner/repo" --json labels': () => "in-progress",
      // #50 (next oldest) has no skip labels — eligible
      'gh issue view 50 --repo "owner/repo" --json labels': () => "",
      'gh issue view 50 --repo "owner/repo" --json title --jq': () =>
        "Eligible issue",
      'gh issue view 50 --repo "owner/repo" --json body --jq': () =>
        "Issue body",
      'gh issue view 50 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/50",
      "gh api repos/owner/repo/issues/50/parent": () => {
        throw new Error("404");
      },
      "gh api graphql": () =>
        JSON.stringify({
          data: {
            repository: { issue: { blockedBy: { nodes: [] } } },
          },
        }),
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullGithubIssues(defaultOptions(dir));
    expect(result.pulled).toBe(true);
    expect(result.message).toContain("#50");
  });

  it("returns pulled:false when all candidates have state labels", () => {
    mockGhCommands({
      "gh issue list": () => JSON.stringify([{ number: 50 }, { number: 42 }]),
      'gh issue view 42 --repo "owner/repo" --json labels': () => "in-progress",
      'gh issue view 50 --repo "owner/repo" --json labels': () => "done",
    });

    const dir = makeTempDir();
    const result = pullGithubIssues(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("already");
  });
});
