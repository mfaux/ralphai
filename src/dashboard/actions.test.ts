import { join } from "path";
import {
  describe,
  it,
  expect,
  mock,
  spyOn,
  beforeEach,
  afterEach,
} from "bun:test";

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

const mockExecSync = mock();
const mockSpawn = mock(() => ({
  pid: 12345,
  unref: mock(),
}));
const mockExistsSync = mock(() => true);
const mockMkdirSync = mock();
const mockRenameSync = mock();
const mockRmSync = mock();

mock.module("child_process", () => ({
  ...require("child_process"),
  execSync: mockExecSync,
  spawn: mockSpawn,
}));

mock.module("fs", () => ({
  ...require("fs"),
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  renameSync: mockRenameSync,
  rmSync: mockRmSync,
}));

mock.module("../global-state.ts", () => ({
  getRepoPipelineDirs: mock(() => ({
    backlogDir: join("/repo", ".ralphai", "pipeline", "backlog"),
    wipDir: join("/repo", ".ralphai", "pipeline", "wip"),
    archiveDir: join("/repo", ".ralphai", "pipeline", "out"),
  })),
}));

const { spawnRunner, resetPlan, purgePlan, removeWorktree, stopRunner } =
  await import("./actions.ts");

beforeEach(() => {
  mockExecSync.mockReset();
  mockSpawn.mockReset();
  mockExistsSync.mockReset();
  mockMkdirSync.mockReset();
  mockRenameSync.mockReset();
  mockRmSync.mockReset();
  // Restore defaults after reset
  mockExistsSync.mockReturnValue(true);
  mockSpawn.mockReturnValue({ pid: 12345, unref: mock() });
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
    expect(mockMkdirSync).toHaveBeenCalledWith(BACKLOG, {
      recursive: true,
    });
    // Removes progress.md and receipt.txt
    expect(mockRmSync).toHaveBeenCalledWith(
      join(WIP, "add-auth", "progress.md"),
      { force: true },
    );
    expect(mockRmSync).toHaveBeenCalledWith(
      join(WIP, "add-auth", "receipt.txt"),
      { force: true },
    );
    expect(mockRmSync).toHaveBeenCalledWith(
      join(WIP, "add-auth", "runner.pid"),
      { force: true },
    );
    // Renames plan file
    expect(mockRenameSync).toHaveBeenCalledWith(
      join(WIP, "add-auth", "add-auth.md"),
      join(BACKLOG, "add-auth.md"),
    );
    // Removes slug directory
    expect(mockRmSync).toHaveBeenCalledWith(join(WIP, "add-auth"), {
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
    expect(mockRmSync).toHaveBeenCalledWith(join(ARCHIVE, "old-plan"), {
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

    const [cmd, args, opts] = (mockSpawn.mock.calls as unknown[][])[0]!;
    expect(args).toEqual(expect.arrayContaining(["run", "--plan=my-plan"]));
    expect(opts).toMatchObject({
      cwd: REPO,
      detached: true,
      stdio: "ignore",
    });
  });

  it("calls unref on the child process", () => {
    spawnRunner(REPO, "my-plan");

    const child = (
      mockSpawn.mock.results[0] as { value: { unref: ReturnType<typeof mock> } }
    ).value;
    expect(child.unref).toHaveBeenCalled();
  });

  it("returns null when spawn throws", () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    expect(spawnRunner(REPO, "bad")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stopRunner
// ---------------------------------------------------------------------------

describe("stopRunner", () => {
  let killSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    killSpy = spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("returns 'stopped' when process exists and SIGTERM succeeds", () => {
    const slugDir = join(WIP, "my-plan");
    const result = stopRunner(42, slugDir);

    expect(result).toBe("stopped");
    // Signal-0 check
    expect(killSpy).toHaveBeenCalledWith(42, 0);
    // SIGTERM
    expect(killSpy).toHaveBeenCalledWith(42, "SIGTERM");
    // PID file should NOT be deleted (runner cleans up on exit)
    expect(mockRmSync).not.toHaveBeenCalledWith(join(slugDir, "runner.pid"), {
      force: true,
    });
  });

  it("returns 'already-exited' and removes PID file when process is gone", () => {
    killSpy.mockImplementation(
      (pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          const err = new Error("ESRCH") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }
        return true;
      },
    );

    const slugDir = join(WIP, "stale-plan");
    const result = stopRunner(99, slugDir);

    expect(result).toBe("already-exited");
    expect(mockRmSync).toHaveBeenCalledWith(join(slugDir, "runner.pid"), {
      force: true,
    });
  });

  it("returns 'failed' when SIGTERM throws", () => {
    killSpy.mockImplementation(
      (pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) return true;
        throw new Error("EPERM");
      },
    );

    const slugDir = join(WIP, "perm-plan");
    const result = stopRunner(42, slugDir);

    expect(result).toBe("failed");
  });
});
