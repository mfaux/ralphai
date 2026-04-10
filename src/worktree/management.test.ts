/**
 * Boundary tests for worktree management and parsing functions.
 *
 * Uses `setExecImpl` to mock subprocess calls, verifying that all I/O
 * routes through the `exec.ts` abstraction.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { setExecImpl } from "../exec.ts";
import { listRalphaiWorktrees } from "./parsing.ts";
import {
  resolveWorktreeInfo,
  isGitWorktree,
  resolveMainGitDir,
  ensureRepoHasCommit,
} from "./management.ts";

// ---------------------------------------------------------------------------
// listRalphaiWorktrees via setExecImpl
// ---------------------------------------------------------------------------

describe("listRalphaiWorktrees (mocked exec)", () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("returns ralphai-managed worktrees from mocked porcelain output", () => {
    const porcelain = [
      "worktree /home/user/project",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/user/.ralphai-worktrees/fix-login",
      "HEAD def456",
      "branch refs/heads/ralphai/fix-login",
      "",
      "worktree /home/user/.ralphai-worktrees/feat-dark-mode",
      "HEAD 789abc",
      "branch refs/heads/feat/dark-mode",
      "",
    ].join("\n");

    restore = setExecImpl((() => porcelain) as any);

    const result = listRalphaiWorktrees("/fake/cwd");
    expect(result).toHaveLength(2);
    expect(result[0]!.branch).toBe("ralphai/fix-login");
    expect(result[1]!.branch).toBe("feat/dark-mode");
  });

  it("returns empty array when git command fails", () => {
    restore = setExecImpl((() => {
      throw new Error("not a git repo");
    }) as any);

    const result = listRalphaiWorktrees("/fake/cwd");
    expect(result).toEqual([]);
  });

  it("filters out non-managed branches", () => {
    const porcelain = [
      "worktree /home/user/project",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/user/.ralphai-worktrees/some-feature",
      "HEAD def456",
      "branch refs/heads/feature/something",
      "",
    ].join("\n");

    restore = setExecImpl((() => porcelain) as any);

    const result = listRalphaiWorktrees("/fake/cwd");
    expect(result).toHaveLength(0);
  });

  it("passes timeout option through to exec", () => {
    let receivedOpts: any;
    restore = setExecImpl(((_cmd: string, opts: any) => {
      receivedOpts = opts;
      return "";
    }) as any);

    listRalphaiWorktrees("/fake/cwd", { timeout: 3000 });
    expect(receivedOpts?.timeout).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// resolveWorktreeInfo via setExecImpl
// ---------------------------------------------------------------------------

describe("resolveWorktreeInfo (mocked exec)", () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("detects worktree when git-common-dir differs from git-dir", () => {
    const responses: Record<string, string> = {
      "git rev-parse --git-common-dir": "/home/user/main-repo/.git",
      "git rev-parse --git-dir":
        "/home/user/main-repo/.git/worktrees/my-worktree",
    };

    restore = setExecImpl(((cmd: string) => {
      const key = cmd.trim();
      if (key in responses) return responses[key]!;
      throw new Error(`unexpected command: ${cmd}`);
    }) as any);

    const info = resolveWorktreeInfo("/home/user/.ralphai-worktrees/my-slug");
    expect(info.isWorktree).toBe(true);
    expect(info.mainWorktree).toContain("main-repo");
  });

  it("returns isWorktree=false when dirs are equal", () => {
    restore = setExecImpl((() => ".git") as any);

    const info = resolveWorktreeInfo("/some/repo");
    expect(info.isWorktree).toBe(false);
    expect(info.mainWorktree).toBe("");
  });

  it("returns isWorktree=false when git command fails", () => {
    restore = setExecImpl((() => {
      throw new Error("not a git repo");
    }) as any);

    const info = resolveWorktreeInfo("/not/a/repo");
    expect(info.isWorktree).toBe(false);
    expect(info.mainWorktree).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isGitWorktree via setExecImpl
// ---------------------------------------------------------------------------

describe("isGitWorktree (mocked exec)", () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("returns true when inside a worktree", () => {
    const responses: Record<string, string> = {
      "git rev-parse --git-common-dir": "/home/user/main-repo/.git",
      "git rev-parse --git-dir":
        "/home/user/main-repo/.git/worktrees/my-worktree",
    };

    restore = setExecImpl(((cmd: string) => {
      const key = cmd.trim();
      if (key in responses) return responses[key]!;
      throw new Error(`unexpected command: ${cmd}`);
    }) as any);

    expect(isGitWorktree("/home/user/.ralphai-worktrees/my-slug")).toBe(true);
  });

  it("returns false for main repo", () => {
    restore = setExecImpl((() => ".git") as any);
    expect(isGitWorktree("/some/repo")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveMainGitDir via setExecImpl
// ---------------------------------------------------------------------------

describe("resolveMainGitDir (mocked exec)", () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it("returns main .git path for worktrees", () => {
    const responses: Record<string, string> = {
      "git rev-parse --git-common-dir": "/home/user/main-repo/.git",
      "git rev-parse --git-dir":
        "/home/user/main-repo/.git/worktrees/my-worktree",
    };

    restore = setExecImpl(((cmd: string) => {
      const key = cmd.trim();
      if (key in responses) return responses[key]!;
      throw new Error(`unexpected command: ${cmd}`);
    }) as any);

    const gitDir = resolveMainGitDir("/home/user/.ralphai-worktrees/my-slug");
    expect(gitDir).toContain("main-repo");
    expect(gitDir).toEndWith(".git");
  });

  it("returns undefined for non-worktree dirs", () => {
    restore = setExecImpl((() => ".git") as any);
    expect(resolveMainGitDir("/some/repo")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ensureRepoHasCommit via setExecImpl
// ---------------------------------------------------------------------------

describe("ensureRepoHasCommit (mocked exec)", () => {
  let restore: () => void;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
  });

  afterEach(() => {
    if (restore) restore();
    exitSpy?.mockRestore();
  });

  it("does not exit when repo has commits", () => {
    restore = setExecImpl((() => "abc123") as any);
    ensureRepoHasCommit("/fake/repo");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("calls process.exit(1) when repo has no commits", () => {
    restore = setExecImpl((() => {
      throw new Error("HEAD not found");
    }) as any);

    expect(() => ensureRepoHasCommit("/fake/repo")).toThrow(
      "process.exit called",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("routes git rev-parse HEAD through exec abstraction", () => {
    const commands: string[] = [];
    restore = setExecImpl(((cmd: string) => {
      commands.push(cmd);
      return "abc123";
    }) as any);

    ensureRepoHasCommit("/fake/repo");
    expect(commands).toContain("git rev-parse HEAD");
  });
});
