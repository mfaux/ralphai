/**
 * Tests for the clean screen's pure helper functions.
 *
 * Tests the exported helpers from `src/tui/screens/clean.tsx`:
 * - `pluralize` — simple pluralization
 * - `buildPreviewLines` — formats scan results into display lines
 * - `buildResultLines` — formats cleanup results into display lines
 * - `cleanKeyHandler` — maps key presses to intents per phase
 * - `buildConfirmItems` — builds confirmation list items
 * - `confirmSelect` — maps a confirmation value to a CleanIntent
 * - `doneSelect` — maps a done-phase value to a CleanIntent
 */

import { describe, it, expect } from "bun:test";
import type { ArchiveSummary, WorktreeCleanResult } from "../../clean.ts";
import {
  pluralize,
  buildPreviewLines,
  buildResultLines,
  cleanKeyHandler,
  buildConfirmItems,
  confirmSelect,
  doneSelect,
} from "./clean.tsx";
import type { CleanScanResult, CleanOutcome, CleanPhase } from "./clean.tsx";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScanResult(overrides?: Partial<CleanScanResult>): CleanScanResult {
  return {
    archiveSummary: null,
    worktreeCount: 0,
    ...overrides,
  };
}

function makeArchiveSummary(
  overrides?: Partial<ArchiveSummary>,
): ArchiveSummary {
  return {
    planDirCount: 3,
    planFiles: 3,
    progressFiles: 2,
    receiptFiles: 1,
    ...overrides,
  };
}

function makeOutcome(overrides?: Partial<CleanOutcome>): CleanOutcome {
  return {
    archiveDeleted: false,
    archiveSummary: null,
    worktreeResult: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// pluralize
// ---------------------------------------------------------------------------

describe("pluralize", () => {
  it("returns singular for count of 1", () => {
    expect(pluralize(1, "plan")).toBe("plan");
    expect(pluralize(1, "worktree")).toBe("worktree");
  });

  it("returns plural for count of 0", () => {
    expect(pluralize(0, "plan")).toBe("plans");
  });

  it("returns plural for count greater than 1", () => {
    expect(pluralize(2, "plan")).toBe("plans");
    expect(pluralize(5, "receipt")).toBe("receipts");
  });
});

// ---------------------------------------------------------------------------
// buildPreviewLines
// ---------------------------------------------------------------------------

describe("buildPreviewLines", () => {
  it("returns empty array when nothing to clean", () => {
    const scan = makeScanResult();
    expect(buildPreviewLines(scan)).toEqual([]);
  });

  it("returns empty array when archive summary is null and no worktrees", () => {
    const scan = makeScanResult({ archiveSummary: null, worktreeCount: 0 });
    expect(buildPreviewLines(scan)).toEqual([]);
  });

  it("includes plan files from archive summary", () => {
    const scan = makeScanResult({
      archiveSummary: makeArchiveSummary({
        planFiles: 3,
        progressFiles: 0,
        receiptFiles: 0,
      }),
    });
    const lines = buildPreviewLines(scan);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe("Plans");
    expect(lines[0]!.value).toBe("3 archived plans");
  });

  it("includes progress files from archive summary", () => {
    const scan = makeScanResult({
      archiveSummary: makeArchiveSummary({
        planFiles: 0,
        progressFiles: 1,
        receiptFiles: 0,
      }),
    });
    const lines = buildPreviewLines(scan);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe("Progress");
    expect(lines[0]!.value).toBe("1 progress file");
  });

  it("includes receipt files from archive summary", () => {
    const scan = makeScanResult({
      archiveSummary: makeArchiveSummary({
        planFiles: 0,
        progressFiles: 0,
        receiptFiles: 2,
      }),
    });
    const lines = buildPreviewLines(scan);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe("Receipts");
    expect(lines[0]!.value).toBe("2 receipts");
  });

  it("includes orphaned worktrees", () => {
    const scan = makeScanResult({ worktreeCount: 4 });
    const lines = buildPreviewLines(scan);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe("Worktrees");
    expect(lines[0]!.value).toBe("4 orphaned worktrees");
  });

  it("uses singular for single worktree", () => {
    const scan = makeScanResult({ worktreeCount: 1 });
    const lines = buildPreviewLines(scan);
    expect(lines[0]!.value).toBe("1 orphaned worktree");
  });

  it("includes all fields when all are present", () => {
    const scan = makeScanResult({
      archiveSummary: makeArchiveSummary({
        planFiles: 2,
        progressFiles: 1,
        receiptFiles: 3,
      }),
      worktreeCount: 1,
    });
    const lines = buildPreviewLines(scan);
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.label)).toEqual([
      "Plans",
      "Progress",
      "Receipts",
      "Worktrees",
    ]);
  });

  it("omits zero-count archive fields", () => {
    const scan = makeScanResult({
      archiveSummary: makeArchiveSummary({
        planFiles: 1,
        progressFiles: 0,
        receiptFiles: 0,
      }),
      worktreeCount: 2,
    });
    const lines = buildPreviewLines(scan);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.label).toBe("Plans");
    expect(lines[1]!.label).toBe("Worktrees");
  });
});

// ---------------------------------------------------------------------------
// buildResultLines
// ---------------------------------------------------------------------------

describe("buildResultLines", () => {
  it("returns empty array when nothing was cleaned", () => {
    const outcome = makeOutcome();
    expect(buildResultLines(outcome)).toEqual([]);
  });

  it("returns empty array when archive not deleted", () => {
    const outcome = makeOutcome({
      archiveDeleted: false,
      archiveSummary: makeArchiveSummary(),
    });
    expect(buildResultLines(outcome)).toEqual([]);
  });

  it("includes plan files when archive was deleted", () => {
    const outcome = makeOutcome({
      archiveDeleted: true,
      archiveSummary: makeArchiveSummary({
        planFiles: 2,
        progressFiles: 0,
        receiptFiles: 0,
      }),
    });
    const lines = buildResultLines(outcome);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe("Plans");
    expect(lines[0]!.value).toBe("2 archived plans removed");
  });

  it("includes progress files when archive was deleted", () => {
    const outcome = makeOutcome({
      archiveDeleted: true,
      archiveSummary: makeArchiveSummary({
        planFiles: 0,
        progressFiles: 1,
        receiptFiles: 0,
      }),
    });
    const lines = buildResultLines(outcome);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe("Progress");
    expect(lines[0]!.value).toBe("1 progress file removed");
  });

  it("includes receipt files when archive was deleted", () => {
    const outcome = makeOutcome({
      archiveDeleted: true,
      archiveSummary: makeArchiveSummary({
        planFiles: 0,
        progressFiles: 0,
        receiptFiles: 3,
      }),
    });
    const lines = buildResultLines(outcome);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe("Receipts");
    expect(lines[0]!.value).toBe("3 receipts removed");
  });

  it("includes worktrees when some were cleaned", () => {
    const outcome = makeOutcome({
      worktreeResult: { orphanCount: 3, cleaned: 2 },
    });
    const lines = buildResultLines(outcome);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe("Worktrees");
    expect(lines[0]!.value).toBe("2 worktrees removed");
  });

  it("uses singular for single worktree", () => {
    const outcome = makeOutcome({
      worktreeResult: { orphanCount: 1, cleaned: 1 },
    });
    const lines = buildResultLines(outcome);
    expect(lines[0]!.value).toBe("1 worktree removed");
  });

  it("omits worktrees when none were cleaned", () => {
    const outcome = makeOutcome({
      worktreeResult: { orphanCount: 0, cleaned: 0 },
    });
    expect(buildResultLines(outcome)).toEqual([]);
  });

  it("includes all fields when everything was cleaned", () => {
    const outcome = makeOutcome({
      archiveDeleted: true,
      archiveSummary: makeArchiveSummary({
        planFiles: 1,
        progressFiles: 1,
        receiptFiles: 1,
      }),
      worktreeResult: { orphanCount: 2, cleaned: 2 },
    });
    const lines = buildResultLines(outcome);
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.label)).toEqual([
      "Plans",
      "Progress",
      "Receipts",
      "Worktrees",
    ]);
  });
});

// ---------------------------------------------------------------------------
// cleanKeyHandler
// ---------------------------------------------------------------------------

describe("cleanKeyHandler", () => {
  it("returns back on Escape in any phase", () => {
    const phases: CleanPhase[] = ["scanning", "preview", "running", "done"];
    for (const phase of phases) {
      expect(cleanKeyHandler("", { escape: true }, phase)).toBe("back");
    }
  });

  it("returns back on Enter in done phase", () => {
    expect(cleanKeyHandler("", { return: true }, "done")).toBe("back");
  });

  it("returns null on Enter in preview phase", () => {
    expect(cleanKeyHandler("", { return: true }, "preview")).toBeNull();
  });

  it("returns null on Enter in scanning phase", () => {
    expect(cleanKeyHandler("", { return: true }, "scanning")).toBeNull();
  });

  it("returns null on Enter in running phase", () => {
    expect(cleanKeyHandler("", { return: true }, "running")).toBeNull();
  });

  it("returns null for regular character input", () => {
    expect(cleanKeyHandler("a", {}, "preview")).toBeNull();
    expect(cleanKeyHandler("a", {}, "done")).toBeNull();
  });

  it("returns null for no key flags set", () => {
    expect(cleanKeyHandler("", {}, "done")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildConfirmItems
// ---------------------------------------------------------------------------

describe("buildConfirmItems", () => {
  it("returns two items: confirm and back", () => {
    const items = buildConfirmItems();
    expect(items).toHaveLength(2);
    expect(items[0]!.value).toBe("__confirm__");
    expect(items[1]!.value).toBe("__back__");
  });

  it("confirm item has descriptive label", () => {
    const items = buildConfirmItems();
    expect(items[0]!.label).toBe("Yes, clean up");
  });

  it("back item has descriptive label", () => {
    const items = buildConfirmItems();
    expect(items[1]!.label).toBe("No, go back");
  });
});

// ---------------------------------------------------------------------------
// confirmSelect
// ---------------------------------------------------------------------------

describe("confirmSelect", () => {
  it("returns confirm intent for __confirm__", () => {
    expect(confirmSelect("__confirm__")).toBe("confirm");
  });

  it("returns back intent for __back__", () => {
    expect(confirmSelect("__back__")).toBe("back");
  });

  it("returns back intent for any other value", () => {
    expect(confirmSelect("unknown")).toBe("back");
  });
});

// ---------------------------------------------------------------------------
// doneSelect
// ---------------------------------------------------------------------------

describe("doneSelect", () => {
  it("returns back for __back__", () => {
    expect(doneSelect("__back__")).toBe("back");
  });

  it("returns back for any value", () => {
    expect(doneSelect("anything")).toBe("back");
  });
});
