/**
 * Tests that pr.draft controls the --draft flag in `gh pr create` commands
 * for both standard PRs and PRD aggregate PRs.
 *
 * Uses the same `setExecImpl()` DI pattern as other pr-lifecycle tests to
 * intercept `gh` commands and inspect the arguments.
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

const ctx = useTempDir();

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

describe("pr.draft controls --draft flag", () => {
  describe("createPr", () => {
    it("passes --draft when draft=true (default)", () => {
      const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "feat/draft-true");

      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("gh pr create")) {
          return "https://github.com/o/r/pull/1";
        }
        throw new Error(`Unexpected gh command: ${cmd}`);
      });

      const result = createPr({
        branch: "feat/draft-true",
        baseBranch: "main",
        planDescription: "feat: add dark mode",
        cwd: repoDir,
        draft: true,
      });

      expect(result.ok).toBe(true);

      const prCreateCall = mockExecSync.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("gh pr create"),
      );
      expect(prCreateCall).toBeDefined();
      expect(prCreateCall![0]).toContain("--draft");
      expect(result.message).toContain("Draft PR created:");
    });

    it("omits --draft when draft=false", () => {
      const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "feat/no-draft");

      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("gh pr create")) {
          return "https://github.com/o/r/pull/2";
        }
        throw new Error(`Unexpected gh command: ${cmd}`);
      });

      const result = createPr({
        branch: "feat/no-draft",
        baseBranch: "main",
        planDescription: "feat: add dark mode",
        cwd: repoDir,
        draft: false,
      });

      expect(result.ok).toBe(true);

      const prCreateCall = mockExecSync.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("gh pr create"),
      );
      expect(prCreateCall).toBeDefined();
      expect(prCreateCall![0]).not.toContain("--draft");
      expect(result.message).toContain("PR created:");
      expect(result.message).not.toContain("Draft PR");
    });

    it("defaults to --draft when draft is undefined", () => {
      const repoDir = initRepoWithRemoteAndBranch(
        ctx.dir,
        "feat/draft-default",
      );

      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("gh pr create")) {
          return "https://github.com/o/r/pull/3";
        }
        throw new Error(`Unexpected gh command: ${cmd}`);
      });

      const result = createPr({
        branch: "feat/draft-default",
        baseBranch: "main",
        planDescription: "feat: add dark mode",
        cwd: repoDir,
        // draft not specified — should default to true
      });

      expect(result.ok).toBe(true);

      const prCreateCall = mockExecSync.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("gh pr create"),
      );
      expect(prCreateCall).toBeDefined();
      expect(prCreateCall![0]).toContain("--draft");
    });
  });

  describe("createPrdPr", () => {
    it("passes --draft when draft=true", () => {
      const repoDir = initRepoWithRemoteAndBranch(
        ctx.dir,
        "feat/prd-draft-true",
      );

      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("gh pr view")) {
          throw new Error("no PR");
        }
        if (typeof cmd === "string" && cmd.includes("gh pr create")) {
          return "https://github.com/o/r/pull/10";
        }
        throw new Error(`Unexpected gh command: ${cmd}`);
      });

      const result = createPrdPr({
        branch: "feat/prd-draft-true",
        baseBranch: "main",
        prd: { number: 42, title: "feat: Add dashboard" },
        completedSubIssues: [10],
        stuckSubIssues: [],
        cwd: repoDir,
        draft: true,
      });

      expect(result.ok).toBe(true);

      const prCreateCall = mockExecSync.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("gh pr create"),
      );
      expect(prCreateCall).toBeDefined();
      expect(prCreateCall![0]).toContain("--draft");
    });

    it("omits --draft when draft=false", () => {
      const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "feat/prd-no-draft");

      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("gh pr view")) {
          throw new Error("no PR");
        }
        if (typeof cmd === "string" && cmd.includes("gh pr create")) {
          return "https://github.com/o/r/pull/11";
        }
        throw new Error(`Unexpected gh command: ${cmd}`);
      });

      const result = createPrdPr({
        branch: "feat/prd-no-draft",
        baseBranch: "main",
        prd: { number: 42, title: "feat: Add dashboard" },
        completedSubIssues: [10],
        stuckSubIssues: [],
        cwd: repoDir,
        draft: false,
      });

      expect(result.ok).toBe(true);

      const prCreateCall = mockExecSync.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("gh pr create"),
      );
      expect(prCreateCall).toBeDefined();
      expect(prCreateCall![0]).not.toContain("--draft");
      expect(result.message).not.toContain("draft");
    });

    it("defaults to --draft when draft is undefined", () => {
      const repoDir = initRepoWithRemoteAndBranch(
        ctx.dir,
        "feat/prd-draft-default",
      );

      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("gh pr view")) {
          throw new Error("no PR");
        }
        if (typeof cmd === "string" && cmd.includes("gh pr create")) {
          return "https://github.com/o/r/pull/12";
        }
        throw new Error(`Unexpected gh command: ${cmd}`);
      });

      const result = createPrdPr({
        branch: "feat/prd-draft-default",
        baseBranch: "main",
        prd: { number: 42, title: "feat: Add dashboard" },
        completedSubIssues: [10],
        stuckSubIssues: [],
        cwd: repoDir,
        // draft not specified — should default to true
      });

      expect(result.ok).toBe(true);

      const prCreateCall = mockExecSync.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("gh pr create"),
      );
      expect(prCreateCall).toBeDefined();
      expect(prCreateCall![0]).toContain("--draft");
    });
  });
});
