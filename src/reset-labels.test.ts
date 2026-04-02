/**
 * Unit tests for restoreIssueLabels() — GitHub label restoration on reset.
 *
 * Uses mock.module to control `child_process.execSync` so we can verify
 * `gh issue edit` calls without requiring a real GitHub repo.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";

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
const { restoreIssueLabels } = await import("./reset-labels.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make gh available (version + auth checks pass). */
function mockGhAvailable(): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    if (typeof cmd === "string" && cmd.includes("gh issue edit")) {
      // execQuiet uses encoding: "utf-8", so return a string
      return "ok";
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

function writePlanFile(dir: string, slug: string, content: string): string {
  const planPath = join(dir, `${slug}.md`);
  writeFileSync(planPath, content);
  return planPath;
}

function githubPlanContent(issueNumber: number, repo?: string): string {
  const url = repo
    ? `https://github.com/${repo}/issues/${issueNumber}`
    : `https://github.com/owner/repo/issues/${issueNumber}`;
  return `---\nsource: github\nissue: ${issueNumber}\nissue-url: ${url}\n---\n\n# Fix something\n\nBody text.\n`;
}

function localPlanContent(): string {
  return `---\nscope: packages/web\n---\n\n# Local feature\n\nBody text.\n`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ctx = useTempDir();

beforeEach(() => {
  mockExecSync.mockReset();
});

describe("restoreIssueLabels", () => {
  it("calls gh issue edit to restore intake label for a GitHub-sourced plan", () => {
    mockGhAvailable();

    const planPath = writePlanFile(
      ctx.dir,
      "gh-42-fix-bug",
      githubPlanContent(42),
    );

    const result = restoreIssueLabels({
      planPath,
      issueLabel: "ralphai",
      issueInProgressLabel: "ralphai:in-progress",
      issueRepo: "owner/repo",
      cwd: ctx.dir,
    });

    expect(result.restored).toBe(true);

    // Verify gh issue edit was called with correct label arguments
    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(1);
    const cmd = ghEditCalls[0]![0] as string;
    expect(cmd).toContain("gh issue edit 42");
    expect(cmd).toContain('--repo "owner/repo"');
    expect(cmd).toContain('--add-label "ralphai"');
    expect(cmd).toContain('--remove-label "ralphai:in-progress"');
  });

  it("does not call gh issue edit for a non-GitHub plan", () => {
    mockGhAvailable();

    const planPath = writePlanFile(
      ctx.dir,
      "local-feature",
      localPlanContent(),
    );

    const result = restoreIssueLabels({
      planPath,
      issueLabel: "ralphai",
      issueInProgressLabel: "ralphai:in-progress",
      issueRepo: "owner/repo",
      cwd: ctx.dir,
    });

    expect(result.restored).toBe(false);
    expect(result.message).toContain("not a GitHub-sourced plan");

    // No gh issue edit calls
    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(0);
  });

  it("is best-effort — gh issue edit failure does not throw", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue edit")) {
        throw new Error("network error");
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const planPath = writePlanFile(
      ctx.dir,
      "gh-99-broken",
      githubPlanContent(99),
    );

    const result = restoreIssueLabels({
      planPath,
      issueLabel: "ralphai",
      issueInProgressLabel: "ralphai:in-progress",
      issueRepo: "owner/repo",
      cwd: ctx.dir,
    });

    expect(result.restored).toBe(false);
    expect(result.message).toContain("failed");
  });

  it("skips when gh CLI is not available", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version") {
        throw new Error("not found");
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const planPath = writePlanFile(
      ctx.dir,
      "gh-10-skip",
      githubPlanContent(10),
    );

    const result = restoreIssueLabels({
      planPath,
      issueLabel: "ralphai",
      issueInProgressLabel: "ralphai:in-progress",
      issueRepo: "owner/repo",
      cwd: ctx.dir,
    });

    expect(result.restored).toBe(false);
    expect(result.message).toContain("gh CLI");
  });

  it("detects repo from issue-url when issueRepo is empty", () => {
    mockGhAvailable();

    const planPath = writePlanFile(
      ctx.dir,
      "gh-55-detect-repo",
      githubPlanContent(55, "acme/widgets"),
    );

    const result = restoreIssueLabels({
      planPath,
      issueLabel: "ralphai",
      issueInProgressLabel: "ralphai:in-progress",
      issueRepo: "",
      cwd: ctx.dir,
    });

    expect(result.restored).toBe(true);

    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(1);
    const cmd = ghEditCalls[0]![0] as string;
    expect(cmd).toContain('--repo "acme/widgets"');
  });

  it("skips when plan file does not exist", () => {
    mockGhAvailable();

    const result = restoreIssueLabels({
      planPath: join(ctx.dir, "nonexistent.md"),
      issueLabel: "ralphai",
      issueInProgressLabel: "ralphai:in-progress",
      issueRepo: "owner/repo",
      cwd: ctx.dir,
    });

    expect(result.restored).toBe(false);
  });
});
