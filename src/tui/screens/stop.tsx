/**
 * Stop screen for the TUI.
 *
 * Lets the user stop a running plan. Two modes:
 * - Single running plan: shows a confirmation prompt with PID and plan name
 * - Multiple running plans: shows a picker with PIDs and durations
 *
 * On confirm, calls `runRalphaiStop()` and returns to the main menu.
 * On Esc, returns to the main menu without stopping anything.
 *
 * Uses `SelectableList` for plan selection and a yes/no confirmation
 * prompt for the single-plan case.
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { PipelineState, InProgressPlan } from "../../pipeline-state.ts";
import { runningPlans } from "../../interactive/pipeline-actions.ts";
import { runRalphaiStop } from "../../stop.ts";
import {
  SelectableList,
  type ListItem,
} from "../components/selectable-list.tsx";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Format a duration from a start time to now in a human-readable string.
 *
 * Examples: "2m", "1h 15m", "3h", "< 1m"
 *
 * Returns `undefined` if the start time is invalid or missing.
 */
export function formatDuration(
  startedAt: string | undefined,
): string | undefined {
  if (!startedAt) return undefined;

  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return undefined;

  const now = Date.now();
  const diffMs = now - start;
  if (diffMs < 0) return undefined;

  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 1) return "< 1m";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Build list items for the running plan picker.
 *
 * Each item shows the plan filename with PID and optional duration as hint.
 */
export function buildStopListItems(
  plans: InProgressPlan[],
  durations: Map<string, string | undefined>,
): ListItem[] {
  return plans.map((plan) => {
    const pid = (plan.liveness as { tag: "running"; pid: number }).pid;
    const parts: string[] = [`PID ${pid}`];
    const duration = durations.get(plan.slug);
    if (duration) parts.push(duration);
    return {
      value: plan.slug,
      label: plan.filename,
      hint: parts.join(" · "),
    };
  });
}

/**
 * Build the confirmation prompt text for a single running plan.
 */
export function buildConfirmText(plan: InProgressPlan): string {
  const pid = (plan.liveness as { tag: "running"; pid: number }).pid;
  return `Stop '${plan.slug}' (PID ${pid})?`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StopScreenProps {
  /** Current pipeline state (must have at least one running plan). */
  state: PipelineState;
  /** Working directory for `runRalphaiStop`. */
  cwd: string;
  /** Called after stopping a plan — parent should refresh state and navigate back. */
  onDone: () => void;
  /** Called when the user presses Esc to go back without stopping. */
  onBack: () => void;
  /** Optional duration map (slug → started_at) for display. Injected for testability. */
  durationMap?: Map<string, string | undefined>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StopScreen({
  state,
  cwd,
  onDone,
  onBack,
  durationMap,
}: StopScreenProps): React.ReactNode {
  const running = useMemo(() => runningPlans(state), [state]);

  // Single-plan confirmation state: null = not yet shown, true/false = answered
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  // Build duration hints
  const durations = useMemo(() => durationMap ?? new Map(), [durationMap]);

  // --- No running plans (shouldn't happen if wired correctly, but safe) ---
  if (running.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No running plans to stop.</Text>
        <Text dimColor>Press Esc to go back</Text>
        <SelectableList
          items={[{ value: "__back__", label: "Back" }]}
          onSelect={onBack}
          onBack={onBack}
        />
      </Box>
    );
  }

  // --- Single running plan: confirmation prompt ---
  if (running.length === 1) {
    return (
      <SinglePlanConfirm
        plan={running[0]!}
        cwd={cwd}
        confirmed={confirmed}
        onConfirm={() => {
          setConfirmed(true);
          runRalphaiStop({ cwd, dryRun: false, slug: running[0]!.slug });
          onDone();
        }}
        onDeny={() => {
          setConfirmed(false);
          onBack();
        }}
        onBack={onBack}
      />
    );
  }

  // --- Multiple running plans: picker ---
  const items = buildStopListItems(running, durations);

  const handleSelect = (slug: string) => {
    runRalphaiStop({ cwd, dryRun: false, slug });
    onDone();
  };

  return (
    <Box flexDirection="column">
      <Text bold>Pick a running plan to stop:</Text>
      <SelectableList items={items} onSelect={handleSelect} onBack={onBack} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Single-plan confirmation sub-component
// ---------------------------------------------------------------------------

interface SinglePlanConfirmProps {
  plan: InProgressPlan;
  cwd: string;
  confirmed: boolean | null;
  onConfirm: () => void;
  onDeny: () => void;
  onBack: () => void;
}

function SinglePlanConfirm({
  plan,
  confirmed,
  onConfirm,
  onDeny,
  onBack,
}: SinglePlanConfirmProps): React.ReactNode {
  useInput((input, key) => {
    if (confirmed !== null) return; // Already answered
    if (key.escape) {
      onBack();
    } else if (input === "y" || input === "Y") {
      onConfirm();
    } else if (input === "n" || input === "N" || key.return) {
      // Enter defaults to "no" (safe default)
      onDeny();
    }
  });

  const promptText = buildConfirmText(plan);

  return (
    <Box flexDirection="column">
      <Text bold>{promptText}</Text>
      <Box marginTop={1}>
        <Text dimColor>
          y to confirm · n or Enter to cancel · Esc to go back
        </Text>
      </Box>
    </Box>
  );
}
