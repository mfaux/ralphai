import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({
    pid: 12345,
    unref: vi.fn(),
  })),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock("../global-state.ts", () => ({
  getRepoPipelineDirs: vi.fn(() => ({
    backlogDir: "/repo/.ralphai/pipeline/backlog",
    wipDir: "/repo/.ralphai/pipeline/wip",
    archiveDir: "/repo/.ralphai/pipeline/out",
  })),
}));

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "fs";
import {
  spawnRunner,
  spawnWorktreeRunner,
  resetPlan,
  purgePlan,
  removeWorktree,
} from "./actions.ts";

// Cast mocked imports for type-safe access to mock methods
const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;
const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults after clearAllMocks
  mockExistsSync.mockReturnValue(true);
  mockSpawn.mockReturnValue({ pid: 12345, unref: vi.fn() });
});

// ---------------------------------------------------------------------------
// removeWorktree
// ---------------------------------------------------------------------------

describe("removeWorktree", () => {
  it("runs prune, remove --force, and branch -D in sequence", () => {
    const result = removeWorktree(
      "/repo",
      "/repo/.worktrees/my-feature",
      "ralphai/my-feature",
    );

    expect(result).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(3);

    const calls = mockExecSync.mock.calls;
    expect(calls[0]![0]).toBe("git worktree prune");
    expect(calls[1]![0]).toBe(
      'git worktree remove --force "/repo/.worktrees/my-feature"',
    );
    expect(calls[2]![0]).toBe('git branch -D "ralphai/my-feature"');

    // All called with cwd
    for (const call of calls) {
      expect(call[1]).toMatchObject({ cwd: "/repo" });
    }
  });

  it("returns false when git worktree remove fails", () => {
    mockExecSync.mockImplementation((cmd) => {
      if (typeof cmd === "string" && cmd.includes("worktree remove")) {
        throw new Error("worktree locked");
      }
      return Buffer.from("");
    });

    const result = removeWorktree(
      "/repo",
      "/repo/.worktrees/locked-wt",
      "ralphai/locked-wt",
    );
    expect(result).toBe(false);
  });

  it("returns false when git worktree prune fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });

    expect(removeWorktree("/bad", "/bad/wt", "ralphai/x")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resetPlan
// ---------------------------------------------------------------------------

describe("resetPlan", () => {
  it("moves plan back to backlog and cleans up slug dir", () => {
    const result = resetPlan("/repo", "add-auth");

    expect(result).toBe(true);
    expect(mkdirSync).toHaveBeenCalledWith("/repo/.ralphai/pipeline/backlog", {
      recursive: true,
    });
    // Removes progress.md and receipt.txt
    expect(rmSync).toHaveBeenCalledWith(
      "/repo/.ralphai/pipeline/wip/add-auth/progress.md",
      { force: true },
    );
    expect(rmSync).toHaveBeenCalledWith(
      "/repo/.ralphai/pipeline/wip/add-auth/receipt.txt",
      { force: true },
    );
    // Renames plan file
    expect(renameSync).toHaveBeenCalledWith(
      "/repo/.ralphai/pipeline/wip/add-auth/add-auth.md",
      "/repo/.ralphai/pipeline/backlog/add-auth.md",
    );
    // Removes slug directory
    expect(rmSync).toHaveBeenCalledWith(
      "/repo/.ralphai/pipeline/wip/add-auth",
      { recursive: true, force: true },
    );
  });

  it("returns false when slug directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    expect(resetPlan("/repo", "nonexistent")).toBe(false);
  });

  it("returns false on filesystem error", () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(resetPlan("/repo", "locked-plan")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// purgePlan
// ---------------------------------------------------------------------------

describe("purgePlan", () => {
  it("removes the archive slug directory", () => {
    const result = purgePlan("/repo", "old-plan");

    expect(result).toBe(true);
    expect(rmSync).toHaveBeenCalledWith(
      "/repo/.ralphai/pipeline/out/old-plan",
      { recursive: true, force: true },
    );
  });

  it("returns false when archive directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    expect(purgePlan("/repo", "missing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// spawnRunner
// ---------------------------------------------------------------------------

describe("spawnRunner", () => {
  it("spawns a detached process with correct args", () => {
    const pid = spawnRunner("/repo", "my-plan");

    expect(pid).toBe(12345);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    const [cmd, args, opts] = mockSpawn.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["run", "--plan=my-plan"]));
    expect(opts).toMatchObject({
      cwd: "/repo",
      detached: true,
      stdio: "ignore",
    });
  });

  it("calls unref on the child process", () => {
    spawnRunner("/repo", "my-plan");

    const child = mockSpawn.mock.results[0]!.value;
    expect(child.unref).toHaveBeenCalled();
  });

  it("returns null when spawn throws", () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    expect(spawnRunner("/repo", "bad")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// spawnWorktreeRunner
// ---------------------------------------------------------------------------

describe("spawnWorktreeRunner", () => {
  it("spawns with worktree subcommand", () => {
    const pid = spawnWorktreeRunner("/repo", "wt-plan");

    expect(pid).toBe(12345);

    const [, args] = mockSpawn.mock.calls[0]!;
    expect(args).toEqual(
      expect.arrayContaining(["worktree", "--plan=wt-plan"]),
    );
  });

  it("returns null on failure", () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("nope");
    });

    expect(spawnWorktreeRunner("/repo", "bad")).toBeNull();
  });
});
