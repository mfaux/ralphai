/**
 * PlanList — full-width plan list, the primary view of the dashboard.
 *
 * Plans are grouped by state (ACTIVE, QUEUED, DONE) with headers.
 * Each row shows cursor, state badge, slug, scope, worktree badge,
 * progress bar, and elapsed time. Gets all available vertical space.
 */

import React from "react";
import { Box, Text } from "ink";
import type { PlanInfo } from "./types.ts";
import { truncateSlug, formatElapsed } from "./format.ts";
import { PanelBox } from "./PanelBox.tsx";
import { useSpinner } from "./hooks.ts";

interface PlanListProps {
  plans: PlanInfo[];
  cursor: number;
  active: boolean;
  width: number;
  height: number;
}

const STATE_ORDER: PlanInfo["state"][] = [
  "in-progress",
  "backlog",
  "completed",
];

const STATE_LABELS: Record<PlanInfo["state"], string> = {
  "in-progress": "ACTIVE",
  backlog: "QUEUED",
  completed: "DONE",
};

/** State badge character for non-active states. */
function stateBadge(state: PlanInfo["state"]): string {
  switch (state) {
    case "backlog":
      return "\u25CB";
    case "completed":
      return "\u2713";
    default:
      return "";
  }
}

function ProgressIndicator({ plan, width }: { plan: PlanInfo; width: number }) {
  if (width < 45) return null;
  if (plan.state !== "in-progress") return null;
  if (plan.tasksCompleted === undefined && plan.totalTasks === undefined)
    return null;

  const current = plan.tasksCompleted ?? 0;
  const total = plan.totalTasks ?? 0;
  if (total === 0) return null;

  const barWidth = 6;
  const filled = Math.round((current / total) * barWidth);
  const empty = barWidth - filled;

  return (
    <Text dimColor>
      {" "}
      <Text color="green">{"\u2588".repeat(filled)}</Text>
      <Text>{"\u2591".repeat(empty)}</Text> {current}/{total}
    </Text>
  );
}

function ElapsedTime({ plan, width }: { plan: PlanInfo; width: number }) {
  if (width < 55) return null;
  if (plan.state === "completed") return null;
  if (!plan.startedAt) return null;

  const elapsed = formatElapsed(plan.startedAt);
  if (!elapsed) return null;

  return <Text dimColor> {elapsed}</Text>;
}

/**
 * Minimum inner width (cols) to show each optional decorator.
 * In split mode the list narrows to ~30%, so decorators that are
 * redundant with the detail pane (worktree, scope) hide first.
 */
const WORKTREE_MIN_WIDTH = 35;
const SCOPE_MIN_WIDTH = 40;

function PlanRow({
  plan,
  selected,
  listActive,
  width,
}: {
  plan: PlanInfo;
  selected: boolean;
  listActive: boolean;
  width: number;
}) {
  const spinner = useSpinner(plan.state === "in-progress");
  const pointer = selected ? "\u27A4" : " ";
  const badge = plan.state === "in-progress" ? spinner : stateBadge(plan.state);

  // Inner width after PanelBox border (2 cols)
  const innerWidth = width - 2;

  // Prefix: pointer(1) + " badge"(2) + " "(1) = 4, or pointer(1) + " "(1) = 2
  const prefixLen = badge ? 4 : 2;

  // Calculate how many columns the trailing decorators will consume
  const showScope = innerWidth >= SCOPE_MIN_WIDTH && !!plan.scope;
  const showWorktree =
    innerWidth >= WORKTREE_MIN_WIDTH && plan.receiptSource === "worktree";

  let trailingLen = 0;
  if (showScope) trailingLen += 3 + (plan.scope?.length ?? 0); // " [scope]"
  if (showWorktree) trailingLen += 12; // " [worktree]"

  const maxSlugLen = Math.max(6, innerWidth - prefixLen - trailingLen);
  const truncated = truncateSlug(plan.slug, maxSlugLen);

  return (
    <Box key={plan.slug + plan.state}>
      <Text
        color={selected && listActive ? "cyan" : selected ? "white" : undefined}
        bold={selected}
      >
        {pointer}
        {badge ? ` ${badge}` : ""} {truncated}
      </Text>
      {showScope && <Text dimColor> [{plan.scope}]</Text>}
      {showWorktree && <Text dimColor> [worktree]</Text>}
      <ProgressIndicator plan={plan} width={width} />
      <ElapsedTime plan={plan} width={width} />
    </Box>
  );
}

export function PlanList({
  plans,
  cursor,
  active,
  width,
  height,
}: PlanListProps) {
  const title = "2 Pipeline";

  // Group plans by state
  const grouped = new Map<PlanInfo["state"], PlanInfo[]>();
  for (const state of STATE_ORDER) {
    grouped.set(
      state,
      plans.filter((p) => p.state === state),
    );
  }

  // Build flat index for cursor mapping
  let flatIndex = 0;

  return (
    <PanelBox title={title} active={active} width={width} height={height}>
      {plans.length === 0 ? (
        <Text dimColor> No plans in pipeline.</Text>
      ) : (
        STATE_ORDER.map((state) => {
          const group = grouped.get(state) ?? [];
          if (group.length === 0) return null;

          const headerRow = (
            <Box key={`header-${state}`} marginTop={flatIndex > 0 ? 1 : 0}>
              <Text dimColor>
                {STATE_LABELS[state]} ({group.length})
              </Text>
            </Box>
          );

          const items = group.map((plan) => {
            const idx = flatIndex++;
            const selected = idx === cursor;

            return (
              <PlanRow
                key={plan.slug + plan.state}
                plan={plan}
                selected={selected}
                listActive={active}
                width={width}
              />
            );
          });

          return (
            <Box key={state} flexDirection="column">
              {headerRow}
              {items}
            </Box>
          );
        })
      )}
    </PanelBox>
  );
}
