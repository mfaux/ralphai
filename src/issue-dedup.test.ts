/**
 * Tests for pipeline de-duplication guard in fetchAndWriteIssuePlan().
 *
 * Verifies that pulling an issue that already exists in the pipeline
 * (backlog or in-progress) is rejected, while archived issues can be
 * re-pulled.
 *
 * Uses setExecImpl() to swap execSync with a mock, and real temp dirs
 * to exercise the filesystem guard.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { PullIssueOptions } from "./issue-lifecycle.ts";
import { setExecImpl } from "./exec.ts";
import {
  pullGithubIssues,
  pullGithubIssueByNumber,
  pullPrdSubIssue,
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

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ralphai-dedup-"));
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Build a command router that dispatches gh calls to handler functions.
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

/** Mock gh commands for a successful single-issue fetch (standalone). */
function mockIssue42Fetch(): void {
  mockGhCommands({
    "gh issue list": () => JSON.stringify([{ number: 42 }]),
    'gh issue view 42 --repo "owner/repo" --json labels': () => "",
    'gh issue view 42 --repo "owner/repo" --json title --jq': () =>
      "Fix the widget",
    'gh issue view 42 --repo "owner/repo" --json body --jq': () =>
      "Widget is broken",
    'gh issue view 42 --repo "owner/repo" --json url --jq': () =>
      "https://github.com/owner/repo/issues/42",
    "gh api repos/owner/repo/issues/42/parent": () => {
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
}

/** Mock gh commands for pullGithubIssueByNumber (no label filtering step). */
function mockIssue42FetchDirect(): void {
  mockGhCommands({
    'gh issue view 42 --repo "owner/repo" --json title --jq': () =>
      "Fix the widget",
    'gh issue view 42 --repo "owner/repo" --json body --jq': () =>
      "Widget is broken",
    'gh issue view 42 --repo "owner/repo" --json url --jq': () =>
      "https://github.com/owner/repo/issues/42",
    "gh api repos/owner/repo/issues/42/parent": () => {
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
}

function defaultOptions(dir: string): PullIssueOptions {
  return {
    backlogDir: join(dir, "pipeline", "backlog"),
    wipDir: join(dir, "pipeline", "in-progress"),
    cwd: dir,
    issueSource: "github",
    standaloneLabel: "ralphai-standalone",
    issueRepo: "owner/repo",
    issueCommentProgress: false,
  };
}

// ---------------------------------------------------------------------------
// Cycle 1: duplicate rejection when plan exists in in-progress
// ---------------------------------------------------------------------------

describe("pipeline de-duplication — in-progress guard", () => {
  it("rejects pull when plan for same issue exists in in-progress (slug-folder)", () => {
    mockIssue42Fetch();

    const dir = makeTempDir();
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);

    // Create existing in-progress slug-folder for issue #42
    const wipSlugDir = join(opts.wipDir!, "gh-42-fix-the-widget");
    ensureDir(wipSlugDir);
    writeFileSync(
      join(wipSlugDir, "gh-42-fix-the-widget.md"),
      "---\nissue: 42\n---\n# Fix the widget\n",
    );

    const result = pullGithubIssues(opts);
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("42");
    expect(result.message).toContain("already");
  });

  it("rejects pull when plan for same issue exists in in-progress (flat file)", () => {
    mockIssue42Fetch();

    const dir = makeTempDir();
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);
    ensureDir(opts.wipDir!);

    // Create flat file in wip dir (edge case)
    writeFileSync(
      join(opts.wipDir!, "gh-42-fix-the-widget.md"),
      "---\nissue: 42\n---\n# Fix the widget\n",
    );

    const result = pullGithubIssues(opts);
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("42");
    expect(result.message).toContain("already");
  });
});

// ---------------------------------------------------------------------------
// Cycle 2: duplicate rejection when plan exists in backlog
// ---------------------------------------------------------------------------

describe("pipeline de-duplication — backlog guard", () => {
  it("rejects pull when plan for same issue already exists in backlog", () => {
    mockIssue42Fetch();

    const dir = makeTempDir();
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);
    ensureDir(opts.wipDir!);

    // Create existing backlog plan for issue #42
    writeFileSync(
      join(opts.backlogDir, "gh-42-fix-the-widget.md"),
      "---\nissue: 42\n---\n# Fix the widget\n",
    );

    const result = pullGithubIssues(opts);
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("42");
    expect(result.message).toContain("already");
  });
});

// ---------------------------------------------------------------------------
// Cycle 3: explicit-target path (pullGithubIssueByNumber) respects guard
// ---------------------------------------------------------------------------

describe("pipeline de-duplication — pullGithubIssueByNumber", () => {
  it("rejects when issue is already in-progress", () => {
    mockIssue42FetchDirect();

    const dir = makeTempDir();
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);

    // Create existing in-progress plan
    const wipSlugDir = join(opts.wipDir!, "gh-42-fix-the-widget");
    ensureDir(wipSlugDir);
    writeFileSync(
      join(wipSlugDir, "gh-42-fix-the-widget.md"),
      "---\nissue: 42\n---\n",
    );

    const result = pullGithubIssueByNumber({ ...opts, issueNumber: 42 });
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("42");
    expect(result.message).toContain("already");
  });

  it("rejects when issue is already in backlog", () => {
    mockIssue42FetchDirect();

    const dir = makeTempDir();
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);
    ensureDir(opts.wipDir!);

    writeFileSync(
      join(opts.backlogDir, "gh-42-fix-the-widget.md"),
      "---\nissue: 42\n---\n",
    );

    const result = pullGithubIssueByNumber({ ...opts, issueNumber: 42 });
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("42");
    expect(result.message).toContain("already");
  });
});

// ---------------------------------------------------------------------------
// Cycle 4: archived issues can be re-pulled
// ---------------------------------------------------------------------------

describe("pipeline de-duplication — archive does NOT block", () => {
  it("allows re-pulling an issue that only exists in archive", () => {
    mockIssue42FetchDirect();

    const dir = makeTempDir();
    const archiveDir = join(dir, "pipeline", "out");
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);
    ensureDir(opts.wipDir!);
    ensureDir(archiveDir);

    // Create archived plan for issue #42 (slug-folder in out/)
    const archiveSlugDir = join(archiveDir, "gh-42-fix-the-widget");
    ensureDir(archiveSlugDir);
    writeFileSync(
      join(archiveSlugDir, "gh-42-fix-the-widget.md"),
      "---\nissue: 42\n---\n",
    );

    // Should succeed — archive does not block
    const result = pullGithubIssueByNumber({ ...opts, issueNumber: 42 });
    expect(result.pulled).toBe(true);
    expect(result.planPath).toBeDefined();
  });

  it("allows re-pulling via pullGithubIssues when only in archive", () => {
    mockIssue42Fetch();

    const dir = makeTempDir();
    const archiveDir = join(dir, "pipeline", "out");
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);
    ensureDir(opts.wipDir!);
    ensureDir(archiveDir);

    // Archived plan
    const archiveSlugDir = join(archiveDir, "gh-42-fix-the-widget");
    ensureDir(archiveSlugDir);
    writeFileSync(
      join(archiveSlugDir, "gh-42-fix-the-widget.md"),
      "---\nissue: 42\n---\n",
    );

    const result = pullGithubIssues(opts);
    expect(result.pulled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Slug mismatch: different title same issue number
// ---------------------------------------------------------------------------

describe("pipeline de-duplication — slug mismatch", () => {
  it("rejects pull even when existing plan has a different slug for same issue number", () => {
    mockIssue42FetchDirect();

    const dir = makeTempDir();
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);
    ensureDir(opts.wipDir!);

    // Existing backlog plan has different slug (title changed)
    writeFileSync(
      join(opts.backlogDir, "gh-42-old-title.md"),
      "---\nissue: 42\n---\n# Old title\n",
    );

    const result = pullGithubIssueByNumber({ ...opts, issueNumber: 42 });
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("42");
    expect(result.message).toContain("already");
  });

  it("rejects pull when existing in-progress slug-folder has different name for same issue", () => {
    mockIssue42Fetch();

    const dir = makeTempDir();
    const opts = defaultOptions(dir);
    ensureDir(opts.backlogDir);

    // In-progress slug-folder with different slug
    const wipSlugDir = join(opts.wipDir!, "gh-42-original-name");
    ensureDir(wipSlugDir);
    writeFileSync(
      join(wipSlugDir, "gh-42-original-name.md"),
      "---\nissue: 42\n---\n",
    );

    const result = pullGithubIssues(opts);
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("42");
  });
});
