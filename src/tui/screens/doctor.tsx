/**
 * Doctor screen for the TUI.
 *
 * Runs diagnostic checks live within Ink, rendering each result as it
 * completes. Uses `buildDoctorChecks()` to get the ordered check list
 * and executes them one-by-one in a microtask loop so React can
 * re-render between checks.
 *
 * - Each check shows a pass/fail/warn indicator + message
 * - Failed checks show error details with remediation hints
 * - All checks passed: shows a success summary
 * - Esc or Enter after completion: returns to main menu
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import {
  buildDoctorChecks,
  buildDoctorSummary,
  statusIcon,
  type DoctorCheck,
  type DoctorCheckResult,
} from "../../doctor.ts";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Map a check result status to an Ink-compatible color name.
 */
export function statusColor(
  status: DoctorCheckResult["status"],
): "green" | "red" | "yellow" {
  switch (status) {
    case "pass":
      return "green";
    case "fail":
      return "red";
    case "warn":
      return "yellow";
  }
}

/**
 * A single rendered check row: the icon, status color, and message.
 * Flattened from `DoctorCheck` results since some checks produce
 * multiple results (e.g., feedback commands).
 */
export interface CheckRow {
  status: DoctorCheckResult["status"];
  message: string;
}

/**
 * Execute a single doctor check and flatten the result(s) into rows.
 */
export function runCheckToRows(check: DoctorCheck, cwd: string): CheckRow[] {
  const result = check.run(cwd);
  if (Array.isArray(result)) {
    return result.map((r) => ({ status: r.status, message: r.message }));
  }
  return [{ status: result.status, message: result.message }];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorScreenProps {
  /** Working directory to run checks against. */
  cwd: string;
  /** Called when the user presses Enter or Esc after checks complete. */
  onBack: () => void;
  /**
   * Optional check list override (for testing). When provided, the
   * component uses these checks instead of calling `buildDoctorChecks()`.
   */
  checks?: DoctorCheck[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DoctorScreen({
  cwd,
  onBack,
  checks: injectedChecks,
}: DoctorScreenProps): React.ReactNode {
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [done, setDone] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Run checks one-by-one, yielding to React between each so the UI
  // updates incrementally.
  useEffect(() => {
    let cancelled = false;

    async function runAll() {
      const doctorChecks = injectedChecks ?? buildDoctorChecks(cwd);

      for (const check of doctorChecks) {
        if (cancelled || !mountedRef.current) return;

        // Yield to the event loop so React can render previous results
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (cancelled || !mountedRef.current) return;

        const newRows = runCheckToRows(check, cwd);

        setRows((prev) => [...prev, ...newRows]);
      }

      if (!cancelled && mountedRef.current) {
        setDone(true);
      }
    }

    void runAll();

    return () => {
      cancelled = true;
    };
  }, [cwd, injectedChecks]);

  // Keyboard: Enter/Esc to go back (only after checks complete)
  useInput(
    (_input, key) => {
      if (!done) return;
      if (key.return || key.escape) {
        onBack();
      }
    },
    { isActive: done },
  );

  const summary = done ? buildDoctorSummary(rows) : null;
  const allPassed = done && rows.every((r) => r.status === "pass");

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>ralphai doctor</Text>

      {/* Check results */}
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row, i) => (
          <Text key={i}>
            <Text color={statusColor(row.status)}>
              {statusIcon(row.status)}
            </Text>
            <Text dimColor> {row.message}</Text>
          </Text>
        ))}
      </Box>

      {/* Progress indicator while running */}
      {!done && (
        <Box marginTop={1}>
          <Text dimColor>Running diagnostics...</Text>
        </Box>
      )}

      {/* Summary */}
      {done && summary && (
        <Box marginTop={1}>
          <Text bold color={allPassed ? "green" : "yellow"}>
            {summary}
          </Text>
        </Box>
      )}

      {/* Key hints (only after completion) */}
      {done && (
        <Box marginTop={1}>
          <Text dimColor>Press Enter or Esc to go back</Text>
        </Box>
      )}
    </Box>
  );
}
