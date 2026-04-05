import { describe, it, expect } from "bun:test";
import { isRalphaiManagedBranch, parseWorktreeList } from "./parsing.ts";

// ---------------------------------------------------------------------------
// isRalphaiManagedBranch
// ---------------------------------------------------------------------------

describe("isRalphaiManagedBranch", () => {
  it("recognises ralphai/ prefix", () => {
    expect(isRalphaiManagedBranch("ralphai/some-plan")).toBe(true);
  });

  it("recognises feat/ prefix", () => {
    expect(isRalphaiManagedBranch("feat/add-dark-mode")).toBe(true);
  });

  it("recognises fix/ prefix", () => {
    expect(isRalphaiManagedBranch("fix/broken-login")).toBe(true);
  });

  it("recognises docs/ prefix", () => {
    expect(isRalphaiManagedBranch("docs/update-cli-reference")).toBe(true);
  });

  it("recognises refactor/ prefix", () => {
    expect(isRalphaiManagedBranch("refactor/extract-helpers")).toBe(true);
  });

  it("recognises chore/ prefix", () => {
    expect(isRalphaiManagedBranch("chore/bump-deps")).toBe(true);
  });

  it("recognises test/ prefix", () => {
    expect(isRalphaiManagedBranch("test/add-unit-tests")).toBe(true);
  });

  it("recognises ci/ prefix", () => {
    expect(isRalphaiManagedBranch("ci/fix-github-actions")).toBe(true);
  });

  it("recognises build/ prefix", () => {
    expect(isRalphaiManagedBranch("build/update-bundler")).toBe(true);
  });

  it("recognises perf/ prefix", () => {
    expect(isRalphaiManagedBranch("perf/optimize-queries")).toBe(true);
  });

  it("recognises style/ prefix", () => {
    expect(isRalphaiManagedBranch("style/format-code")).toBe(true);
  });

  it("recognises revert/ prefix", () => {
    expect(isRalphaiManagedBranch("revert/undo-change")).toBe(true);
  });

  it("rejects unrelated branches", () => {
    expect(isRalphaiManagedBranch("main")).toBe(false);
    expect(isRalphaiManagedBranch("develop")).toBe(false);
    expect(isRalphaiManagedBranch("feature/something")).toBe(false);
    expect(isRalphaiManagedBranch("bugfix/something")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isRalphaiManagedBranch("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseWorktreeList (smoke)
// ---------------------------------------------------------------------------

describe("parseWorktreeList", () => {
  it("parses porcelain output with branch info", () => {
    const output = [
      "worktree /home/user/project",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/user/.ralphai-worktrees/fix-login",
      "HEAD def456",
      "branch refs/heads/fix/login-bug",
      "",
    ].join("\n");

    const entries = parseWorktreeList(output);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.branch).toBe("main");
    expect(entries[1]!.branch).toBe("fix/login-bug");
  });
});
