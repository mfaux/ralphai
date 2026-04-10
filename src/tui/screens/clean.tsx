/**
 * Clean screen for the TUI.
 *
 * Shows a summary of what will be cleaned (archive plan count, orphaned
 * worktree count), lets the user confirm or cancel, then executes
 * cleanup and shows results.
 *
 * Phases:
 * 1. **scanning** — gathers counts (archive + worktrees)
 * 2. **preview** — shows summary, user confirms or cancels
 * 3. **running** — cleanup in progress
 * 4. **done** — shows results, Enter/Esc returns to menu
 *
 * Pure helpers are exported for unit testing:
 * - `buildPreviewLines` — formats scan results into display lines
 * - `buildResultLines` — formats cleanup results into display lines
 * - `cleanKeyHandler` — maps key presses to intents per phase
 * - `confirmSelect` — maps a confirmation list selection to intent
 * - `doneSelect` — maps a done-phase list selection to intent
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text } from "ink";

import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type { DispatchResult } from "../types.ts";
import type { ArchiveSummary, WorktreeCleanResult } from "../../clean.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Phase of the clean screen state machine. */
export type CleanPhase = "scanning" | "preview" | "running" | "done";

/** Scan results gathered before showing the preview. */
export interface CleanScanResult {
  archiveSummary: ArchiveSummary | null;
  worktreeCount: number;
}

/** Results after cleanup has been executed. */
export interface CleanOutcome {
  archiveDeleted: boolean;
  archiveSummary: ArchiveSummary | null;
  worktreeResult: WorktreeCleanResult | null;
}

export interface CleanScreenProps {
  /** Working directory for clean operations. */
  cwd: string;
  /** Called when the user navigates back. */
  onResult: (result: DispatchResult) => void;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
  /**
   * Injected scan function for testing. Called with `cwd`, returns
   * archive summary and worktree count.
   */
  scan?: (cwd: string) => CleanScanResult;
  /**
   * Injected clean function for testing. Called with `cwd`, returns
   * cleanup outcome.
   */
  clean?: (cwd: string) => CleanOutcome;
}

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

/** User intents on the clean screen. */
export type CleanIntent = "confirm" | "back" | null;

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** A single display line for the clean screen. */
export interface CleanLine {
  /** Label (e.g. "Plans", "Worktrees"). */
  label: string;
  /** Value text (e.g. "3 archived plans"). */
  value: string;
}

/**
 * Pluralize a word with a count.
 */
export function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/**
 * Build display lines from the scan result for the preview phase.
 *
 * Returns an empty array when there is nothing to clean.
 */
export function buildPreviewLines(scan: CleanScanResult): CleanLine[] {
  const lines: CleanLine[] = [];

  if (scan.archiveSummary) {
    const s = scan.archiveSummary;
    if (s.planFiles > 0) {
      lines.push({
        label: "Plans",
        value: `${s.planFiles} archived ${pluralize(s.planFiles, "plan")}`,
      });
    }
    if (s.progressFiles > 0) {
      lines.push({
        label: "Progress",
        value: `${s.progressFiles} progress ${pluralize(s.progressFiles, "file")}`,
      });
    }
    if (s.receiptFiles > 0) {
      lines.push({
        label: "Receipts",
        value: `${s.receiptFiles} ${pluralize(s.receiptFiles, "receipt")}`,
      });
    }
  }

  if (scan.worktreeCount > 0) {
    lines.push({
      label: "Worktrees",
      value: `${scan.worktreeCount} orphaned ${pluralize(scan.worktreeCount, "worktree")}`,
    });
  }

  return lines;
}

/**
 * Build display lines from the cleanup outcome for the done phase.
 */
export function buildResultLines(outcome: CleanOutcome): CleanLine[] {
  const lines: CleanLine[] = [];

  if (outcome.archiveDeleted && outcome.archiveSummary) {
    const s = outcome.archiveSummary;
    if (s.planFiles > 0) {
      lines.push({
        label: "Plans",
        value: `${s.planFiles} archived ${pluralize(s.planFiles, "plan")} removed`,
      });
    }
    if (s.progressFiles > 0) {
      lines.push({
        label: "Progress",
        value: `${s.progressFiles} progress ${pluralize(s.progressFiles, "file")} removed`,
      });
    }
    if (s.receiptFiles > 0) {
      lines.push({
        label: "Receipts",
        value: `${s.receiptFiles} ${pluralize(s.receiptFiles, "receipt")} removed`,
      });
    }
  }

  if (outcome.worktreeResult && outcome.worktreeResult.cleaned > 0) {
    const wt = outcome.worktreeResult;
    lines.push({
      label: "Worktrees",
      value: `${wt.cleaned} ${pluralize(wt.cleaned, "worktree")} removed`,
    });
  }

  return lines;
}

/**
 * Map a key press to a `CleanIntent` based on the current phase.
 *
 * - Esc always returns "back"
 * - Enter returns "back" in the done phase
 * - In other phases, Enter is handled by the SelectableList
 *
 * Returns `null` for unrecognized keys.
 */
export function cleanKeyHandler(
  _input: string,
  key: { escape?: boolean; return?: boolean },
  phase: CleanPhase,
): CleanIntent {
  if (key.escape) return "back";
  if (key.return && phase === "done") return "back";
  return null;
}

/**
 * Build the confirmation list items for the preview phase.
 */
export function buildConfirmItems(): ListItem[] {
  return [
    { value: "__confirm__", label: "Yes, clean up" },
    { value: "__back__", label: "No, go back" },
  ];
}

/**
 * Map a confirmation list selection to a `CleanIntent`.
 */
export function confirmSelect(value: string): CleanIntent {
  if (value === "__confirm__") return "confirm";
  return "back";
}

/**
 * Map a done-phase list selection to a `CleanIntent`.
 */
export function doneSelect(_value: string): CleanIntent {
  return "back";
}

// ---------------------------------------------------------------------------
// Custom item renderer
// ---------------------------------------------------------------------------

function CleanListItem({
  item,
  isCursor,
  isDisabled,
}: {
  item: ListItem;
  isCursor: boolean;
  isDisabled: boolean;
}) {
  const cursor = isCursor ? "\u276F " : "  ";
  const labelColor = isDisabled ? "gray" : isCursor ? "cyan" : undefined;

  return (
    <Box>
      <Text color={isCursor ? "cyan" : undefined}>{cursor}</Text>
      <Text color={labelColor} dimColor={isDisabled}>
        {item.label}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// CleanScreen component
// ---------------------------------------------------------------------------

export function CleanScreen({
  cwd,
  onResult,
  isActive = true,
  scan: injectedScan,
  clean: injectedClean,
}: CleanScreenProps) {
  const [phase, setPhase] = useState<CleanPhase>("scanning");
  const [scanResult, setScanResult] = useState<CleanScanResult | null>(null);
  const [outcome, setOutcome] = useState<CleanOutcome | null>(null);

  const handleBack = useCallback(() => {
    onResult({ type: "navigate", screen: { type: "menu" } });
  }, [onResult]);

  // --- Scan on mount ---
  useEffect(() => {
    const timer = setTimeout(() => {
      if (injectedScan) {
        const result = injectedScan(cwd);
        setScanResult(result);
        // If nothing to clean, go straight to done with empty outcome
        if (!result.archiveSummary && result.worktreeCount === 0) {
          setOutcome({
            archiveDeleted: false,
            archiveSummary: null,
            worktreeResult: null,
          });
          setPhase("done");
        } else {
          setPhase("preview");
        }
      } else {
        // Real implementation: import and call the scan functions
        // This is deferred to avoid circular imports at module level
        import("../../clean.ts").then(
          ({ scanArchive, countOrphanedWorktrees }) => {
            import("../../plan-lifecycle.ts").then(
              ({ getRepoPipelineDirs }) => {
                const { archiveDir } = getRepoPipelineDirs(cwd);
                const archiveSummary = scanArchive(archiveDir);
                const worktreeCount = countOrphanedWorktrees(cwd);
                const result = { archiveSummary, worktreeCount };
                setScanResult(result);

                if (!archiveSummary && worktreeCount === 0) {
                  setOutcome({
                    archiveDeleted: false,
                    archiveSummary: null,
                    worktreeResult: null,
                  });
                  setPhase("done");
                } else {
                  setPhase("preview");
                }
              },
            );
          },
        );
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [cwd, injectedScan]);

  // --- Execute cleanup ---
  const executeClean = useCallback(() => {
    setPhase("running");

    setTimeout(() => {
      if (injectedClean) {
        const result = injectedClean(cwd);
        setOutcome(result);
        setPhase("done");
      } else {
        // Real implementation
        import("../../clean.ts").then(({ runClean }) => {
          runClean({ cwd, yes: true, worktrees: true, archive: true }).then(
            () => {
              // runClean doesn't return results, so we reconstruct from scan
              setOutcome({
                archiveDeleted: scanResult?.archiveSummary != null,
                archiveSummary: scanResult?.archiveSummary ?? null,
                worktreeResult:
                  scanResult && scanResult.worktreeCount > 0
                    ? {
                        orphanCount: scanResult.worktreeCount,
                        cleaned: scanResult.worktreeCount,
                      }
                    : null,
              });
              setPhase("done");
            },
          );
        });
      }
    }, 0);
  }, [cwd, injectedClean, scanResult]);

  const handleConfirmSelect = useCallback(
    (value: string) => {
      const intent = confirmSelect(value);
      if (intent === "confirm") {
        executeClean();
      } else {
        handleBack();
      }
    },
    [executeClean, handleBack],
  );

  const handleDoneSelect = useCallback(
    (_value: string) => {
      handleBack();
    },
    [handleBack],
  );

  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <CleanListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // Build display data
  const previewLines = useMemo(
    () => (scanResult ? buildPreviewLines(scanResult) : []),
    [scanResult],
  );

  const resultLines = useMemo(
    () => (outcome ? buildResultLines(outcome) : []),
    [outcome],
  );

  const confirmItems = useMemo(() => buildConfirmItems(), []);

  // Compute max label width for alignment
  const activeLines = phase === "done" ? resultLines : previewLines;
  const maxLabel = activeLines.reduce(
    (max, line) => Math.max(max, line.label.length),
    0,
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box paddingLeft={1} marginBottom={1}>
        <Text bold>Clean</Text>
        {phase === "scanning" && <Text dimColor> Scanning...</Text>}
        {phase === "running" && <Text dimColor> Cleaning...</Text>}
      </Box>

      {/* Scanning phase */}
      {phase === "scanning" && (
        <Box paddingLeft={2}>
          <Text dimColor>Scanning for items to clean...</Text>
        </Box>
      )}

      {/* Preview phase — show summary and confirm */}
      {phase === "preview" && (
        <>
          <Box paddingLeft={2} marginBottom={1}>
            <Text dimColor>The following will be cleaned:</Text>
          </Box>
          {previewLines.map((line) => (
            <Box key={line.label} paddingLeft={2}>
              <Text>{line.label.padEnd(maxLabel)} </Text>
              <Text dimColor>{line.value}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <SelectableList
              items={confirmItems}
              onSelect={handleConfirmSelect}
              onBack={handleBack}
              isActive={isActive}
              renderItem={renderItem}
            />
          </Box>
        </>
      )}

      {/* Running phase */}
      {phase === "running" && (
        <Box paddingLeft={2}>
          <Text dimColor>Running cleanup...</Text>
        </Box>
      )}

      {/* Done phase — show results */}
      {phase === "done" && (
        <>
          {resultLines.length > 0 ? (
            <>
              <Box paddingLeft={2} marginBottom={1}>
                <Text color="green">Cleaned.</Text>
              </Box>
              {resultLines.map((line) => (
                <Box key={line.label} paddingLeft={2}>
                  <Text>{line.label.padEnd(maxLabel)} </Text>
                  <Text dimColor>{line.value}</Text>
                </Box>
              ))}
            </>
          ) : (
            <Box paddingLeft={2}>
              <Text dimColor>Nothing to clean.</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <SelectableList
              items={[{ value: "__back__", label: "Back" }]}
              onSelect={handleDoneSelect}
              onBack={handleBack}
              isActive={isActive}
              renderItem={renderItem}
            />
          </Box>
        </>
      )}
    </Box>
  );
}
