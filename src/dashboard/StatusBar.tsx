/**
 * StatusBar -- bottom bar with context-sensitive keyboard hints and toast.
 *
 * Hints change based on the current FocusTarget and split-pane state:
 * - repo:       ↑↓ cycle repos · Enter dropdown · 2 pipeline · Tab next · ? help · q quit
 * - list:       ↑↓ navigate · Enter detail · a actions · 1 repo · / filter · ? help · q quit
 * - list+split: ↑↓ navigate · 3 detail · a actions · Esc close · ? help
 * - detail:     ↑↓ scroll · ←→ tabs · a actions · f follow · Esc back
 * - menu:       ↑↓ select · Enter confirm · Esc cancel
 * - filter:     type to filter · Enter apply · Esc clear
 * - help:       ? or Esc to close
 *
 * When a plan is in-progress the right side shows an animated spinner,
 * plan slug, mini progress summary (tasks), and elapsed time.
 * Toast messages override the right-side content when present.
 */

import React from "react";
import { Box, Text } from "ink";
import type { FocusTarget, PlanInfo } from "./types.ts";
import { useSpinner } from "./hooks.ts";
import { formatElapsed } from "./format.ts";

interface StatusBarProps {
  focus: FocusTarget;
  toast: string | null;
  planCount: number;
  selectedPlan: PlanInfo | null;
  hasActiveRunners: boolean;
  splitOpen?: boolean;
}

const HINTS: Record<FocusTarget, string> = {
  repo: "\u2191\u2193 cycle repos \u00B7 Enter dropdown \u00B7 2 pipeline \u00B7 3 detail \u00B7 Tab next \u00B7 ? help \u00B7 q quit",
  list: "\u2191\u2193 navigate \u00B7 Enter detail \u00B7 a actions \u00B7 1 repo \u00B7 / filter \u00B7 ? help \u00B7 q quit",
  detail:
    "\u2191\u2193 scroll \u00B7 \u2190\u2192 tabs \u00B7 a actions \u00B7 f follow \u00B7 2 list \u00B7 Esc back",
  menu: "\u2191\u2193 select \u00B7 Enter confirm \u00B7 Esc cancel",
  filter: "type to filter \u00B7 Enter apply \u00B7 Esc clear",
  help: "? or Esc to close",
};

/** Hints when the split pane is open and focus is on the plan list. */
const SPLIT_LIST_HINT =
  "\u2191\u2193 navigate \u00B7 3 detail \u00B7 a actions \u00B7 Esc close \u00B7 ? help";

/** Build the mini progress string (e.g. "tasks 3/7"). */
function buildProgressSummary(plan: PlanInfo): string {
  const parts: string[] = [];
  if (plan.tasksCompleted != null && plan.totalTasks != null) {
    parts.push(`tasks ${plan.tasksCompleted}/${plan.totalTasks}`);
  }
  return parts.join(" \u00B7 ");
}

export function StatusBar({
  focus,
  toast,
  planCount,
  selectedPlan,
  hasActiveRunners,
  splitOpen,
}: StatusBarProps) {
  const hint = focus === "list" && splitOpen ? SPLIT_LIST_HINT : HINTS[focus];
  const isSelectedInProgress = selectedPlan?.state === "in-progress";
  const spinnerChar = useSpinner(hasActiveRunners);

  // Build right-side content (priority order: toast > active progress > idle runner > plan count)
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

    // 4. Plan count summary
    if (planCount > 0) {
      return (
        <Text dimColor>
          {planCount} plan{planCount !== 1 ? "s" : ""}
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
