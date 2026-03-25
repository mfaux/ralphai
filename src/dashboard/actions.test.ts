import { join } from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

// Use path.join so expected paths use the platform separator (backslash on
// Windows, forward slash elsewhere). The production code already uses
// path.join, so both sides stay consistent.
const REPO = join("/repo");
const BACKLOG = join("/repo", ".ralphai", "pipeline", "backlog");
const WIP = join("/repo", ".ralphai", "pipeline", "wip");
const ARCHIVE = join("/repo", ".ralphai", "pipeline", "out");

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
    backlogDir: join("/repo", ".ralphai", "pipeline", "backlog"),
    wipDir: join("/repo", ".ralphai", "pipeline", "wip"),
    archiveDir: join("/repo", ".ralphai", "pipeline", "out"),
  })),
}));

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "fs";
import {
  spawnRunner,
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
      REPO,
      join(REPO, ".worktrees", "my-feature"),
      "ralphai/my-feature",
    );

    expect(result).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(3);

    const calls = mockExecSync.mock.calls;
    expect(calls[0]![0]).toBe("git worktree prune");
    expect(calls[1]![0]).toBe(
      `git worktree remove --force "${join(REPO, ".worktrees", "my-feature")}"`,
    );
    expect(calls[2]![0]).toBe('git branch -D "ralphai/my-feature"');

    // All called with cwd
    for (const call of calls) {
      expect(call[1]).toMatchObject({ cwd: REPO });
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
      REPO,
      join(REPO, ".worktrees", "locked-wt"),
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
    const result = resetPlan(REPO, "add-auth");

    expect(result).toBe(true);
    expect(mkdirSync).toHaveBeenCalledWith(BACKLOG, {
      recursive: true,
    });
    // Removes progress.md and receipt.txt
    expect(rmSync).toHaveBeenCalledWith(join(WIP, "add-auth", "progress.md"), {
      force: true,
    });
    expect(rmSync).toHaveBeenCalledWith(join(WIP, "add-auth", "receipt.txt"), {
      force: true,
    });
    // Renames plan file
    expect(renameSync).toHaveBeenCalledWith(
      join(WIP, "add-auth", "add-auth.md"),
      join(BACKLOG, "add-auth.md"),
    );
    // Removes slug directory
    expect(rmSync).toHaveBeenCalledWith(join(WIP, "add-auth"), {
      recursive: true,
      force: true,
    });
  });

  it("returns false when slug directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    expect(resetPlan(REPO, "nonexistent")).toBe(false);
  });

  it("returns false on filesystem error", () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(resetPlan(REPO, "locked-plan")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// purgePlan
// ---------------------------------------------------------------------------

describe("purgePlan", () => {
  it("removes the archive slug directory", () => {
    const result = purgePlan(REPO, "old-plan");

    expect(result).toBe(true);
    expect(rmSync).toHaveBeenCalledWith(join(ARCHIVE, "old-plan"), {
      recursive: true,
      force: true,
    });
  });

  it("returns false when archive directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    expect(purgePlan(REPO, "missing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// spawnRunner
// ---------------------------------------------------------------------------

describe("spawnRunner", () => {
  it("spawns a detached process with correct args", () => {
    const pid = spawnRunner(REPO, "my-plan");

    expect(pid).toBe(12345);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    const [cmd, args, opts] = mockSpawn.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["run", "--plan=my-plan"]));
    expect(opts).toMatchObject({
      cwd: REPO,
      detached: true,
      stdio: "ignore",
    });
  });

  it("calls unref on the child process", () => {
    spawnRunner(REPO, "my-plan");

    const child = mockSpawn.mock.results[0]!.value;
    expect(child.unref).toHaveBeenCalled();
  });

  it("returns null when spawn throws", () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    expect(spawnRunner(REPO, "bad")).toBeNull();
  });
});
