/**
 * Clean screen for the TUI.
 *
 * Shows a summary of what will be cleaned (archived plans and orphaned
 * worktrees), asks for confirmation, then executes the cleanup and
 * displays results.
 *
 * Screen states:
 * - scanning: scanning for cleanable targets
 * - empty: nothing to clean
 * - preview: showing what will be cleaned, waiting for confirmation
 * - cleaning: executing cleanup
 * - done: showing results
 *
 * Esc at any point: return to main menu.
 * Enter after done/empty: return to main menu.
 * y on preview: confirm and execute cleanup.
 * n on preview: cancel and return to main menu.
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type {
  ArchiveSummary,
  CleanScanResult,
  WorktreeCleanResult,
} from "../../clean.ts";
import {
  scanCleanTargets,
  deleteArchive,
  cleanOrphanedWorktrees,
} from "../../clean.ts";
import { getRepoPipelineDirs } from "../../global-state.ts";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary line for an archive scan.
 *
 * Returns lines like:
 *   "3 archived plans, 2 progress files, 1 receipt"
 *
 * Returns `null` if the archive summary is null (nothing to clean).
 */
export function formatArchiveSummary(
  summary: ArchiveSummary | null,
): string | null {
  if (!summary) return null;

  const parts: string[] = [];
  if (summary.planFiles > 0) {
    parts.push(
      `${summary.planFiles} archived plan${summary.planFiles !== 1 ? "s" : ""}`,
    );
  }
  if (summary.progressFiles > 0) {
    parts.push(
      `${summary.progressFiles} progress file${summary.progressFiles !== 1 ? "s" : ""}`,
    );
  }
  if (summary.receiptFiles > 0) {
    parts.push(
      `${summary.receiptFiles} receipt${summary.receiptFiles !== 1 ? "s" : ""}`,
    );
  }

  // If we have plan dirs but no individual file counts, fall back to dir count
  if (parts.length === 0 && summary.planDirCount > 0) {
    parts.push(
      `${summary.planDirCount} archived director${summary.planDirCount !== 1 ? "ies" : "y"}`,
    );
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Build a human-readable summary line for orphaned worktrees.
 *
 * Returns a line like: "3 orphaned worktrees"
 * Returns `null` if count is 0.
 */
export function formatWorktreeCount(count: number): string | null {
  if (count === 0) return null;
  return `${count} orphaned worktree${count !== 1 ? "s" : ""}`;
}

/**
 * Build the result summary after cleanup completes.
 *
 * Returns lines describing what was deleted.
 */
export function buildCleanResultSummary(
  archiveSummary: ArchiveSummary | null,
  archiveDeleted: boolean,
  worktreeResult: WorktreeCleanResult | null,
): string[] {
  const lines: string[] = [];

  if (archiveDeleted && archiveSummary) {
    const archiveText = formatArchiveSummary(archiveSummary);
    if (archiveText) {
      lines.push(archiveText);
    }
  }

  if (worktreeResult && worktreeResult.cleaned > 0) {
    lines.push(
      `${worktreeResult.cleaned} worktree${worktreeResult.cleaned !== 1 ? "s" : ""} removed`,
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScreenState =
  | { tag: "scanning" }
  | { tag: "empty" }
  | { tag: "preview"; scan: CleanScanResult }
  | { tag: "cleaning"; scan: CleanScanResult }
  | { tag: "done"; lines: string[] };

export interface CleanScreenProps {
  /** Working directory for scan and cleanup operations. */
  cwd: string;
  /** Called when the user presses Enter or Esc to return to main menu. */
  onBack: () => void;
  /**
   * Optional scan result override (for testing). When provided, the
   * component skips the scan phase and goes directly to preview/empty.
   */
  scanResult?: CleanScanResult;
  /**
   * Optional executor overrides (for testing). When provided, the
   * component calls these instead of the real cleanup functions.
   */
  executors?: {
    deleteArchive?: (archiveDir: string) => void;
    cleanOrphanedWorktrees?: (cwd: string) => WorktreeCleanResult;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CleanScreen({
  cwd,
  onBack,
  scanResult: injectedScan,
  executors,
}: CleanScreenProps): React.ReactNode {
  const [state, setState] = useState<ScreenState>({ tag: "scanning" });
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Scan phase: run in a microtask to avoid blocking initial render
  useEffect(() => {
    if (injectedScan) {
      // Use injected scan result (testing)
      const hasWork =
        injectedScan.archiveSummary !== null || injectedScan.worktreeCount > 0;
      setState(
        hasWork ? { tag: "preview", scan: injectedScan } : { tag: "empty" },
      );
      return;
    }

    let cancelled = false;

    void Promise.resolve().then(() => {
      if (cancelled || !mountedRef.current) return;

      const scan = scanCleanTargets(cwd);

      if (cancelled || !mountedRef.current) return;

      const hasWork = scan.archiveSummary !== null || scan.worktreeCount > 0;
      setState(hasWork ? { tag: "preview", scan } : { tag: "empty" });
    });

    return () => {
      cancelled = true;
    };
  }, [cwd, injectedScan]);

  // Keyboard handling
  useInput((_input, key) => {
    if (state.tag === "scanning" || state.tag === "cleaning") return;

    if (key.escape) {
      onBack();
      return;
    }

    if (state.tag === "empty" || state.tag === "done") {
      if (key.return) {
        onBack();
      }
      return;
    }

    if (state.tag === "preview") {
      if (_input === "y" || _input === "Y") {
        executeClean(state.scan);
      } else if (_input === "n" || _input === "N" || key.return) {
        // Enter defaults to "no" (safe default)
        onBack();
      }
    }
  });

  // Execute cleanup
  function executeClean(scan: CleanScanResult) {
    setState({ tag: "cleaning", scan });

    // Run cleanup in a microtask so the "Cleaning..." text renders first
    void Promise.resolve().then(() => {
      if (!mountedRef.current) return;

      const { archiveDir } = getRepoPipelineDirs(cwd);
      const doDeleteArchive = executors?.deleteArchive ?? deleteArchive;
      const doCleanWorktrees =
        executors?.cleanOrphanedWorktrees ?? cleanOrphanedWorktrees;

      let archiveDeleted = false;
      if (scan.archiveSummary) {
        doDeleteArchive(archiveDir);
        archiveDeleted = true;
      }

      let worktreeResult: WorktreeCleanResult | null = null;
      if (scan.worktreeCount > 0) {
        worktreeResult = doCleanWorktrees(cwd);
      }

      if (!mountedRef.current) return;

      const lines = buildCleanResultSummary(
        scan.archiveSummary,
        archiveDeleted,
        worktreeResult,
      );

      setState({ tag: "done", lines });
    });
  }

  // --- Render ---

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>ralphai clean</Text>

      {/* Scanning */}
      {state.tag === "scanning" && (
        <Box marginTop={1}>
          <Text dimColor>Scanning for cleanable targets...</Text>
        </Box>
      )}

      {/* Nothing to clean */}
      {state.tag === "empty" && (
        <>
          <Box marginTop={1}>
            <Text>Nothing to clean.</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Esc to go back</Text>
          </Box>
        </>
      )}

      {/* Preview: what will be cleaned */}
      {(state.tag === "preview" || state.tag === "cleaning") && (
        <>
          <Box marginTop={1}>
            <Text>The following will be cleaned:</Text>
          </Box>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {formatArchiveSummary(
              (state as { scan: CleanScanResult }).scan.archiveSummary,
            ) && (
              <Text dimColor>
                {formatArchiveSummary(
                  (state as { scan: CleanScanResult }).scan.archiveSummary,
                )}
              </Text>
            )}
            {formatWorktreeCount(
              (state as { scan: CleanScanResult }).scan.worktreeCount,
            ) && (
              <Text dimColor>
                {formatWorktreeCount(
                  (state as { scan: CleanScanResult }).scan.worktreeCount,
                )}
              </Text>
            )}
          </Box>
        </>
      )}

      {/* Confirmation prompt */}
      {state.tag === "preview" && (
        <Box marginTop={1}>
          <Text dimColor>
            y to confirm · n or Enter to cancel · Esc to go back
          </Text>
        </Box>
      )}

      {/* Cleaning in progress */}
      {state.tag === "cleaning" && (
        <Box marginTop={1}>
          <Text dimColor>Cleaning...</Text>
        </Box>
      )}

      {/* Done: show results */}
      {state.tag === "done" && (
        <>
          <Box marginTop={1}>
            <Text bold color="green">
              Cleaned.
            </Text>
          </Box>
          {state.lines.length > 0 && (
            <Box flexDirection="column" marginLeft={2}>
              {state.lines.map((line, i) => (
                <Text key={i} dimColor>
                  {line}
                </Text>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Esc to go back</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
