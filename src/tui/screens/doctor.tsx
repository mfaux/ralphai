/**
 * Doctor screen for the TUI.
 *
 * Runs diagnostic health checks and renders results live as each check
 * completes. Uses the `DoctorCheck` descriptors from `src/doctor.ts` so
 * the TUI and CLI share the same check logic.
 *
 * - Each check renders as it completes with a status icon + message
 * - Skipped checks (gated by a failed prerequisite) show a skip indicator
 * - Failed checks show error details with remediation hints
 * - All checks passed: show success summary
 * - Esc or Enter after completion: return to main menu
 *
 * Pure helpers are exported for unit testing:
 * - `statusIcon` — returns a Unicode icon for a check status
 * - `buildDoctorResultLines` — formats completed checks for display
 * - `buildSummary` — builds the summary line from check outcomes
 * - `doctorKeyHandler` — maps key presses to intents
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";

import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type { DispatchResult } from "../types.ts";
import type {
  DoctorCheckResult,
  DoctorCheck,
  DoctorCheckOutcome,
} from "../../doctor.ts";
import { buildDoctorChecks, runDoctorChecks } from "../../doctor.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorScreenProps {
  /** Working directory for doctor checks. */
  cwd: string;
  /** Called when the user navigates back. */
  onResult: (result: DispatchResult) => void;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
  /**
   * Injected check runner for testing. Defaults to `runDoctorChecks`.
   * Called with (cwd, checks, onResult) — see doctor.ts.
   */
  runChecks?: (
    cwd: string,
    checks: DoctorCheck[],
    onResult?: (key: string, outcome: DoctorCheckOutcome) => void,
  ) => Map<string, DoctorCheckOutcome>;
}

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

/** User intents on the doctor screen. */
export type DoctorIntent = "back" | null;

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Return a Unicode status icon for a check result status.
 */
export function statusIcon(status: DoctorCheckResult["status"]): string {
  switch (status) {
    case "pass":
      return "\u2713"; // checkmark
    case "fail":
      return "\u2717"; // cross
    case "warn":
      return "\u26A0"; // warning
  }
}

/**
 * Color for a check result status.
 */
export function statusColor(status: DoctorCheckResult["status"]): string {
  switch (status) {
    case "pass":
      return "green";
    case "fail":
      return "red";
    case "warn":
      return "yellow";
  }
}

/** A single display line for the doctor screen. */
export interface DoctorLine {
  /** Status icon string. */
  icon: string;
  /** Color for the icon. */
  color: string;
  /** The check result message. */
  message: string;
  /** The result status for downstream logic. */
  status: DoctorCheckResult["status"] | "skipped";
}

/**
 * Convert a map of check outcomes into flat display lines.
 *
 * Preserves the order from the check descriptors. Skipped checks
 * are included with a skip indicator.
 */
export function buildDoctorResultLines(
  checks: DoctorCheck[],
  outcomes: Map<string, DoctorCheckOutcome>,
): DoctorLine[] {
  const lines: DoctorLine[] = [];

  for (const check of checks) {
    const outcome = outcomes.get(check.key);
    if (!outcome || outcome.status === "pending") continue;

    if (outcome.status === "skipped") {
      lines.push({
        icon: "-",
        color: "gray",
        message: `${check.label}: skipped (${outcome.reason})`,
        status: "skipped",
      });
      continue;
    }

    // "done" — one or more results
    for (const result of outcome.results) {
      lines.push({
        icon: statusIcon(result.status),
        color: statusColor(result.status),
        message: result.message,
        status: result.status,
      });
    }
  }

  return lines;
}

/** Summary of doctor check outcomes. */
export interface DoctorSummary {
  /** Total checks that passed. */
  passes: number;
  /** Total checks that warned. */
  warnings: number;
  /** Total checks that failed. */
  failures: number;
  /** Total checks that were skipped. */
  skipped: number;
  /** Human-readable summary string. */
  text: string;
}

/**
 * Build a summary from doctor result lines.
 */
export function buildSummary(lines: DoctorLine[]): DoctorSummary {
  let passes = 0;
  let warnings = 0;
  let failures = 0;
  let skipped = 0;

  for (const line of lines) {
    switch (line.status) {
      case "pass":
        passes++;
        break;
      case "warn":
        warnings++;
        break;
      case "fail":
        failures++;
        break;
      case "skipped":
        skipped++;
        break;
    }
  }

  if (failures === 0 && warnings === 0) {
    return { passes, warnings, failures, skipped, text: "All checks passed" };
  }

  const parts: string[] = [];
  if (failures > 0)
    parts.push(`${failures} failure${failures !== 1 ? "s" : ""}`);
  if (warnings > 0)
    parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);

  return { passes, warnings, failures, skipped, text: parts.join(", ") };
}

/**
 * Map a key press to a `DoctorIntent`.
 *
 * Returns `"back"` for Esc or Enter (only when checks are complete),
 * or `null` for unrecognized keys.
 */
export function doctorKeyHandler(
  _input: string,
  key: Key,
  isComplete: boolean,
): DoctorIntent {
  if (key.escape) return "back";
  if (key.return && isComplete) return "back";
  return null;
}

// ---------------------------------------------------------------------------
// Custom item renderer for the Back button
// ---------------------------------------------------------------------------

function DoctorListItem({
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
// DoctorScreen component
// ---------------------------------------------------------------------------

export function DoctorScreen({
  cwd,
  onResult,
  isActive = true,
  runChecks: injectedRunChecks,
}: DoctorScreenProps) {
  const checks = useMemo(() => buildDoctorChecks(), []);
  const [outcomes, setOutcomes] = useState<Map<string, DoctorCheckOutcome>>(
    () => new Map(),
  );
  const [isComplete, setIsComplete] = useState(false);

  // Run checks on mount
  useEffect(() => {
    const runFn = injectedRunChecks ?? runDoctorChecks;

    // Use setTimeout to defer to next tick so the "Running..." state
    // renders first. The checks are synchronous (execSync-based) so
    // they'll block the render loop, but we still get the initial frame.
    const timer = setTimeout(() => {
      const resultMap = runFn(cwd, checks, (key, outcome) => {
        // Live update: copy the map with each new result.
        // Note: since runDoctorChecks is synchronous, these updates
        // batch into a single render. If checks become async in the
        // future, this will automatically show live updates.
        setOutcomes((prev) => {
          const next = new Map(prev);
          next.set(key, outcome);
          return next;
        });
      });

      setOutcomes(resultMap);
      setIsComplete(true);
    }, 0);

    return () => clearTimeout(timer);
  }, [cwd, checks, injectedRunChecks]);

  const handleBack = useCallback(() => {
    onResult({ type: "navigate", screen: { type: "menu" } });
  }, [onResult]);

  // Keyboard handling: Esc always goes back, Enter goes back when complete
  useInput(
    useCallback(
      (input: string, key: Key) => {
        const intent = doctorKeyHandler(input, key, isComplete);
        if (intent === "back") {
          handleBack();
        }
      },
      [isComplete, handleBack],
    ),
    { isActive },
  );

  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <DoctorListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // Build display lines from current outcomes
  const lines = useMemo(
    () => buildDoctorResultLines(checks, outcomes),
    [checks, outcomes],
  );

  const summary = useMemo(
    () => (isComplete ? buildSummary(lines) : null),
    [isComplete, lines],
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box paddingLeft={1} marginBottom={1}>
        <Text bold>Doctor</Text>
        {!isComplete && <Text dimColor> Running checks...</Text>}
      </Box>

      {/* Check results */}
      {lines.map((line, i) => (
        <Box key={i} paddingLeft={2}>
          <Text color={line.color}>{line.icon}</Text>
          <Text dimColor> {line.message}</Text>
        </Box>
      ))}

      {/* Pending indicator when checks haven't completed */}
      {!isComplete && lines.length === 0 && (
        <Box paddingLeft={2}>
          <Text dimColor>Running diagnostic checks...</Text>
        </Box>
      )}

      {/* Summary */}
      {summary && (
        <Box paddingLeft={2} marginTop={1}>
          <Text
            color={
              summary.failures > 0
                ? "red"
                : summary.warnings > 0
                  ? "yellow"
                  : "green"
            }
          >
            {summary.text}
          </Text>
        </Box>
      )}

      {/* Back button — shown after completion */}
      {isComplete && (
        <Box marginTop={1}>
          <SelectableList
            items={[{ value: "__back__", label: "Back" }]}
            onSelect={handleBack}
            onBack={handleBack}
            isActive={isActive}
            renderItem={renderItem}
          />
        </Box>
      )}

      {/* Hint when not complete */}
      {!isComplete && (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>Press Esc to cancel</Text>
        </Box>
      )}
    </Box>
  );
}
