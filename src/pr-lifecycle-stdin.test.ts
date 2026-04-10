/**
 * Tests for PR body shell-safety in pr-lifecycle.ts.
 *
 * Verifies that `createPr`, and `createPrdPr` pipe the PR body via stdin
 * (`--body-file -`) instead of interpolating it into a shell command.
 *
 * This prevents shell metacharacters (backticks, `$`, etc.) in
 * agent-generated PR summaries from being interpreted by the shell.
 *
 * Uses setExecImpl() to swap execSync with a mock so we can inspect
 * the commands and stdin input without hitting real git/gh.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { execSync as realExecSync } from "child_process";
import { setExecImpl } from "./exec.ts";
import { initRepoWithRemoteAndBranch, useTempDir } from "./test-utils.ts";
import { createPr, createPrdPr } from "./pr-lifecycle.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ctx = useTempDir();

/** Body containing shell metacharacters that would break interpolation. */
const DANGEROUS_BODY =
  "Fix Bun feedback command detection so Ralphai uses a project's intended " +
  "test script instead of bypassing it with bare `bun test`. Also handles " +
  '$(whoami) and "double quotes" correctly.';

/**
 * Wrapping mock that intercepts only `gh` commands and passes everything
 * else (git push, git remote, etc.) through to real execSync.
 */
function ghOnlyExec(...args: Parameters<typeof realExecSync>) {
  const [cmd, options] = args;
  if (typeof cmd === "string" && cmd.startsWith("gh ")) {
    return mockExecSync(...args);
  }
  return realExecSync(cmd, options as Parameters<typeof realExecSync>[1]);
}

beforeEach(() => {
  restoreExec = setExecImpl(ghOnlyExec as typeof realExecSync);
  mockExecSync.mockReset();
});

afterEach(() => {
  restoreExec();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PR body shell-safety", () => {
  it("createPr pipes body via stdin with --body-file -", () => {
    const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "ralphai/test-plan");

    // Mock gh pr create to return a URL (as string, matching encoding: "utf-8")
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh pr create")) {
        return "https://github.com/o/r/pull/1";
      }
      throw new Error(`Unexpected gh command: ${cmd}`);
    });

    const result = createPr({
      branch: "ralphai/test-plan",
      baseBranch: "main",
      planDescription: "fix: test plan",
      cwd: repoDir,
      summary: DANGEROUS_BODY,
    });

    expect(result.ok).toBe(true);

    // Find the gh pr create call
    const prCreateCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh pr create"),
    );
    expect(prCreateCall).toBeDefined();

    const cmd = prCreateCall![0] as string;
    const opts = prCreateCall![1] as { input?: string };

    // Should use --body-file - instead of --body "..."
    expect(cmd).toContain("--body-file -");
    expect(cmd).not.toContain('--body "');

    // Body should be passed via stdin (input option)
    expect(opts.input).toContain(DANGEROUS_BODY);
  });

  it("createPrdPr pipes body via stdin on create", () => {
    const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "feat/prd-test");

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh pr view")) {
        // No existing PR
        throw new Error("no PR");
      }
      if (typeof cmd === "string" && cmd.includes("gh pr create")) {
        return "https://github.com/o/r/pull/5";
      }
      throw new Error(`Unexpected gh command: ${cmd}`);
    });

    const result = createPrdPr({
      branch: "feat/prd-test",
      baseBranch: "main",
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10, 11],
      stuckSubIssues: [],
      cwd: repoDir,
    });

    expect(result.ok).toBe(true);
    const prCreateCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh pr create"),
    );
    expect(prCreateCall).toBeDefined();

    const cmd = prCreateCall![0] as string;
    const opts = prCreateCall![1] as { input?: string };
    expect(cmd).toContain("--body-file -");
    expect(cmd).not.toContain('--body "');
    expect(typeof opts.input).toBe("string");
  });

  it("createPrdPr pipes body via stdin on edit (existing PR)", () => {
    const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "feat/prd-update");

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh pr view")) {
        return "https://github.com/o/r/pull/6";
      }
      if (typeof cmd === "string" && cmd.includes("gh pr edit")) {
        return "ok";
      }
      throw new Error(`Unexpected gh command: ${cmd}`);
    });

    const result = createPrdPr({
      branch: "feat/prd-update",
      baseBranch: "main",
      prd: { number: 42, title: "Add user dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [11],
      cwd: repoDir,
    });

    expect(result.ok).toBe(true);
    const prEditCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh pr edit"),
    );
    expect(prEditCall).toBeDefined();

    const cmd = prEditCall![0] as string;
    const opts = prEditCall![1] as { input?: string };
    expect(cmd).toContain("--body-file -");
    expect(cmd).not.toContain('--body "');
    expect(typeof opts.input).toBe("string");
  });
});
