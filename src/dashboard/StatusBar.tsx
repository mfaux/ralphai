/**
 * StatusBar — bottom bar with context-sensitive keyboard hints and toast.
 *
 * Hints change based on the current FocusTarget:
 * - panel:  ↑↓ navigate · Tab/1-3 panels · Enter actions · / filter · ? help · q quit
 * - detail: ↑↓ scroll · ←→ tabs · f follow · Esc back
 * - menu:   ↑↓ select · Enter confirm · Esc cancel
 * - filter: type to filter · Enter apply · Esc clear
 * - help:   ? or Esc to close
 *
 * When a plan is in-progress the right side shows an animated spinner,
 * plan slug, mini progress summary (tasks/turns), and elapsed time.
 * Toast messages still override the right-side content when present.
 */

import React from "react";
import { Box, Text } from "ink";
import type { FocusTarget, PlanInfo } from "./types.ts";
import { useSpinner } from "./hooks.ts";
import { formatElapsed } from "./format.ts";

interface StatusBarProps {
  focus: FocusTarget;
  toast: string | null;
  repoName: string | null;
  planCount: number;
  selectedPlan: PlanInfo | null;
  hasActiveRunners: boolean;
}

const HINTS: Record<FocusTarget, string> = {
  panel:
    "\u2191\u2193 navigate \u00B7 Enter actions \u00B7 Tab detail \u00B7 / filter \u00B7 ? help \u00B7 q quit",
  detail:
    "\u2191\u2193 scroll \u00B7 \u2190\u2192 tabs \u00B7 Enter actions \u00B7 f follow \u00B7 1-3 panels \u00B7 Esc back",
  menu: "\u2191\u2193 select \u00B7 Enter confirm \u00B7 Esc cancel",
  filter: "type to filter \u00B7 Enter apply \u00B7 Esc clear",
  help: "? or Esc to close",
};

/** Build the mini progress string (e.g. "tasks 3/7 · turns 4/6"). */
function buildProgressSummary(plan: PlanInfo): string {
  const parts: string[] = [];
  if (plan.tasksCompleted != null && plan.totalTasks != null) {
    parts.push(`tasks ${plan.tasksCompleted}/${plan.totalTasks}`);
  }
  if (plan.turnsCompleted != null && plan.turnsBudget != null) {
    parts.push(`turns ${plan.turnsCompleted}/${plan.turnsBudget}`);
  }
  return parts.join(" \u00B7 ");
}

export function StatusBar({
  focus,
  toast,
  repoName,
  planCount,
  selectedPlan,
  hasActiveRunners,
}: StatusBarProps) {
  const hint = HINTS[focus];
  const isSelectedInProgress = selectedPlan?.state === "in-progress";
  const spinnerChar = useSpinner(hasActiveRunners);

  // Build right-side content (priority order: toast > active progress > idle runner > default)
  const renderRight = () => {
    // 1. Toast overrides everything
    if (toast) {
      return <Text color="yellow">{toast}</Text>;
    }

    // 2. Selected plan is in-progress: spinner + slug + progress + elapsed
    if (isSelectedInProgress && selectedPlan) {
      const progress = buildProgressSummary(selectedPlan);
      const elapsed = formatElapsed(selectedPlan.startedAt);
      const segments = [selectedPlan.slug, progress, elapsed].filter(Boolean);
      return (
        <Text>
          <Text color="green">{spinnerChar} </Text>
          <Text dimColor>{segments.join(" \u00B7 ")}</Text>
        </Text>
      );
    }

    // 3. Runner active but selected plan is not in-progress
    if (hasActiveRunners) {
      return <Text dimColor>{spinnerChar} runner active</Text>;
    }

    // 4. Default: repo name and plan count
    if (repoName) {
      return (
        <Text dimColor>
          {repoName} {"\u00B7"} {planCount} plan{planCount !== 1 ? "s" : ""}
        </Text>
      );
    }

    return null;
  };

  return (
    <Box height={1}>
      <Box flexGrow={1}>
        <Text dimColor>{hint}</Text>
      </Box>
      <Box flexShrink={1}>{renderRight()}</Box>
    </Box>
  );
}
