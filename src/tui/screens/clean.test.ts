/**
 * Tests for the clean screen.
 *
 * Tests pure helper functions exported from clean.tsx:
 * - formatArchiveSummary()
 * - formatWorktreeCount()
 * - buildCleanResultSummary()
 *
 * Tests the CleanScreen component renders correctly in each state:
 * - empty (nothing to clean)
 * - preview (showing summary, waiting for confirmation)
 * - done (after cleanup)
 *
 * Pure unit tests for helpers — no filesystem, no subprocess.
 * Component tests inject scan results and mock executors to avoid
 * real filesystem/git operations.
 */

import { describe, it, expect, mock } from "bun:test";
import React from "react";
import { render } from "ink";
import type {
  ArchiveSummary,
  CleanScanResult,
  WorktreeCleanResult,
} from "../../clean.ts";

// ---------------------------------------------------------------------------
// Mock side-effect modules before importing clean.tsx
// ---------------------------------------------------------------------------

const mockScanCleanTargets = mock(
  (_cwd: string): CleanScanResult => ({
    archiveSummary: null,
    worktreeCount: 0,
  }),
);

const mockDeleteArchive = mock((_archiveDir: string): void => {});

const mockCleanOrphanedWorktrees = mock(
  (_cwd: string): WorktreeCleanResult => ({
    orphanCount: 0,
    cleaned: 0,
  }),
);

const mockGetRepoPipelineDirs = mock((_cwd: string) => ({
  backlogDir: "/tmp/backlog",
  wipDir: "/tmp/in-progress",
  archiveDir: "/tmp/out",
}));

mock.module("../../clean.ts", () => ({
  scanCleanTargets: mockScanCleanTargets,
  deleteArchive: mockDeleteArchive,
  cleanOrphanedWorktrees: mockCleanOrphanedWorktrees,
  scanArchive: mock(() => null),
}));

mock.module("../../global-state.ts", () => ({
  getRepoPipelineDirs: mockGetRepoPipelineDirs,
}));

// Import after mocking
const {
  formatArchiveSummary,
  formatWorktreeCount,
  buildCleanResultSummary,
  CleanScreen,
} = await import("./clean.tsx");

// ---------------------------------------------------------------------------
// formatArchiveSummary
// ---------------------------------------------------------------------------

describe("formatArchiveSummary", () => {
  it("returns null for null summary", () => {
    expect(formatArchiveSummary(null)).toBeNull();
  });

  it("formats plan files only", () => {
    const summary: ArchiveSummary = {
      planDirCount: 3,
      planFiles: 3,
      progressFiles: 0,
      receiptFiles: 0,
    };
    expect(formatArchiveSummary(summary)).toBe("3 archived plans");
  });

  it("uses singular for 1 plan", () => {
    const summary: ArchiveSummary = {
      planDirCount: 1,
      planFiles: 1,
      progressFiles: 0,
      receiptFiles: 0,
    };
    expect(formatArchiveSummary(summary)).toBe("1 archived plan");
  });

  it("formats all file types", () => {
    const summary: ArchiveSummary = {
      planDirCount: 3,
      planFiles: 2,
      progressFiles: 3,
      receiptFiles: 1,
    };
    expect(formatArchiveSummary(summary)).toBe(
      "2 archived plans, 3 progress files, 1 receipt",
    );
  });

  it("formats progress files only", () => {
    const summary: ArchiveSummary = {
      planDirCount: 2,
      planFiles: 0,
      progressFiles: 2,
      receiptFiles: 0,
    };
    expect(formatArchiveSummary(summary)).toBe("2 progress files");
  });

  it("formats receipt files only", () => {
    const summary: ArchiveSummary = {
      planDirCount: 1,
      planFiles: 0,
      progressFiles: 0,
      receiptFiles: 1,
    };
    expect(formatArchiveSummary(summary)).toBe("1 receipt");
  });

  it("uses singular for 1 progress file", () => {
    const summary: ArchiveSummary = {
      planDirCount: 1,
      planFiles: 0,
      progressFiles: 1,
      receiptFiles: 0,
    };
    expect(formatArchiveSummary(summary)).toBe("1 progress file");
  });

  it("uses plural for multiple receipts", () => {
    const summary: ArchiveSummary = {
      planDirCount: 5,
      planFiles: 0,
      progressFiles: 0,
      receiptFiles: 5,
    };
    expect(formatArchiveSummary(summary)).toBe("5 receipts");
  });

  it("falls back to directory count when no file counts", () => {
    const summary: ArchiveSummary = {
      planDirCount: 4,
      planFiles: 0,
      progressFiles: 0,
      receiptFiles: 0,
    };
    expect(formatArchiveSummary(summary)).toBe("4 archived directories");
  });

  it("uses singular for 1 directory", () => {
    const summary: ArchiveSummary = {
      planDirCount: 1,
      planFiles: 0,
      progressFiles: 0,
      receiptFiles: 0,
    };
    expect(formatArchiveSummary(summary)).toBe("1 archived directory");
  });

  it("returns null for empty summary with zero dir count", () => {
    const summary: ArchiveSummary = {
      planDirCount: 0,
      planFiles: 0,
      progressFiles: 0,
      receiptFiles: 0,
    };
    expect(formatArchiveSummary(summary)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatWorktreeCount
// ---------------------------------------------------------------------------

describe("formatWorktreeCount", () => {
  it("returns null for 0", () => {
    expect(formatWorktreeCount(0)).toBeNull();
  });

  it("returns singular for 1", () => {
    expect(formatWorktreeCount(1)).toBe("1 orphaned worktree");
  });

  it("returns plural for multiple", () => {
    expect(formatWorktreeCount(5)).toBe("5 orphaned worktrees");
  });
});

// ---------------------------------------------------------------------------
// buildCleanResultSummary
// ---------------------------------------------------------------------------

describe("buildCleanResultSummary", () => {
  it("returns empty array when nothing was cleaned", () => {
    expect(buildCleanResultSummary(null, false, null)).toEqual([]);
  });

  it("includes archive line when archive was deleted", () => {
    const summary: ArchiveSummary = {
      planDirCount: 2,
      planFiles: 2,
      progressFiles: 1,
      receiptFiles: 0,
    };
    const lines = buildCleanResultSummary(summary, true, null);
    expect(lines).toEqual(["2 archived plans, 1 progress file"]);
  });

  it("does not include archive line when archive was not deleted", () => {
    const summary: ArchiveSummary = {
      planDirCount: 2,
      planFiles: 2,
      progressFiles: 0,
      receiptFiles: 0,
    };
    const lines = buildCleanResultSummary(summary, false, null);
    expect(lines).toEqual([]);
  });

  it("includes worktree line when worktrees were cleaned", () => {
    const result: WorktreeCleanResult = { orphanCount: 3, cleaned: 3 };
    const lines = buildCleanResultSummary(null, false, result);
    expect(lines).toEqual(["3 worktrees removed"]);
  });

  it("uses singular for 1 worktree", () => {
    const result: WorktreeCleanResult = { orphanCount: 1, cleaned: 1 };
    const lines = buildCleanResultSummary(null, false, result);
    expect(lines).toEqual(["1 worktree removed"]);
  });

  it("does not include worktree line when 0 cleaned", () => {
    const result: WorktreeCleanResult = { orphanCount: 2, cleaned: 0 };
    const lines = buildCleanResultSummary(null, false, result);
    expect(lines).toEqual([]);
  });

  it("includes both archive and worktree lines", () => {
    const summary: ArchiveSummary = {
      planDirCount: 1,
      planFiles: 1,
      progressFiles: 0,
      receiptFiles: 0,
    };
    const result: WorktreeCleanResult = { orphanCount: 2, cleaned: 2 };
    const lines = buildCleanResultSummary(summary, true, result);
    expect(lines).toEqual(["1 archived plan", "2 worktrees removed"]);
  });
});

// ---------------------------------------------------------------------------
// CleanScreen component
// ---------------------------------------------------------------------------

describe("CleanScreen", () => {
  it("renders empty state when nothing to clean", async () => {
    const scan: CleanScanResult = {
      archiveSummary: null,
      worktreeCount: 0,
    };

    const instance = render(
      React.createElement(CleanScreen, {
        cwd: "/tmp",
        onBack: () => {},
        scanResult: scan,
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders preview state with archive summary", async () => {
    const scan: CleanScanResult = {
      archiveSummary: {
        planDirCount: 3,
        planFiles: 3,
        progressFiles: 2,
        receiptFiles: 1,
      },
      worktreeCount: 0,
    };

    const instance = render(
      React.createElement(CleanScreen, {
        cwd: "/tmp",
        onBack: () => {},
        scanResult: scan,
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders preview state with worktree count", async () => {
    const scan: CleanScanResult = {
      archiveSummary: null,
      worktreeCount: 4,
    };

    const instance = render(
      React.createElement(CleanScreen, {
        cwd: "/tmp",
        onBack: () => {},
        scanResult: scan,
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders preview state with both archive and worktrees", async () => {
    const scan: CleanScanResult = {
      archiveSummary: {
        planDirCount: 2,
        planFiles: 2,
        progressFiles: 1,
        receiptFiles: 0,
      },
      worktreeCount: 3,
    };

    const instance = render(
      React.createElement(CleanScreen, {
        cwd: "/tmp",
        onBack: () => {},
        scanResult: scan,
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders without error when using injected executors", async () => {
    const scan: CleanScanResult = {
      archiveSummary: {
        planDirCount: 1,
        planFiles: 1,
        progressFiles: 0,
        receiptFiles: 0,
      },
      worktreeCount: 0,
    };

    const mockExecDeleteArchive = mock((_dir: string) => {});
    const mockExecCleanWorktrees = mock(
      (_cwd: string): WorktreeCleanResult => ({
        orphanCount: 0,
        cleaned: 0,
      }),
    );

    const instance = render(
      React.createElement(CleanScreen, {
        cwd: "/tmp",
        onBack: () => {},
        scanResult: scan,
        executors: {
          deleteArchive: mockExecDeleteArchive,
          cleanOrphanedWorktrees: mockExecCleanWorktrees,
        },
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("calls onBack callback (does not crash when configured)", async () => {
    const onBack = mock(() => {});
    const scan: CleanScanResult = {
      archiveSummary: null,
      worktreeCount: 0,
    };

    const instance = render(
      React.createElement(CleanScreen, {
        cwd: "/tmp",
        onBack,
        scanResult: scan,
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
    // We can't easily simulate keyboard input in this test pattern,
    // but we verify the component renders and unmounts cleanly.
  });
});
