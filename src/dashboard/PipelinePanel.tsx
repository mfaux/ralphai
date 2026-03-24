/**
 * PipelinePanel — middle-left stacked panel showing plans for the selected repo.
 *
 * Plans grouped under state headers (ACTIVE, QUEUED, DONE).
 * Each plan shows slug (smart-truncated), and when width allows, scope + progress bar.
 * Wrapped in a PanelBox with rounded borders.
 */

import React from "react";
import { Box, Text } from "ink";
import type { PlanInfo } from "./types.ts";
import { truncateSlug } from "./format.ts";
import { PanelBox } from "./PanelBox.tsx";
import { useSpinner } from "./hooks.ts";

interface PipelinePanelProps {
  plans: PlanInfo[];
  cursor: number;
  active: boolean;
  width: number;
  height?: number;
  collapsed?: boolean;
  repoName?: string;
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

const STATE_BADGE_COLOR: Record<
  PlanInfo["state"],
  "green" | "yellow" | "gray"
> = {
  "in-progress": "green",
  backlog: "yellow",
  completed: "gray",
};

function ProgressIndicator({ plan, width }: { plan: PlanInfo; width: number }) {
  if (width < 35) return null;
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

function PlanRow({
  plan,
  selected,
  panelActive,
  maxSlugLen,
  width,
}: {
  plan: PlanInfo;
  selected: boolean;
  panelActive: boolean;
  maxSlugLen: number;
  width: number;
}) {
  const spinner = useSpinner(plan.state === "in-progress");
  const pointer = selected ? "\u27A4" : " ";
  const badge = plan.state === "in-progress" ? spinner : stateBadge(plan.state);
  const truncated = truncateSlug(plan.slug, maxSlugLen);

  return (
    <Box key={plan.slug + plan.state}>
      <Text
        color={
          selected && panelActive ? "cyan" : selected ? "white" : undefined
        }
        bold={selected}
      >
        {pointer}
        {badge ? ` ${badge}` : ""} {truncated}
      </Text>
      {width >= 35 && plan.scope && <Text dimColor> [{plan.scope}]</Text>}
      <ProgressIndicator plan={plan} width={width} />
    </Box>
  );
}

export function PipelinePanel({
  plans,
  cursor,
  active,
  width,
  height,
  collapsed,
  repoName,
}: PipelinePanelProps) {
  const title = repoName ? `2 Pipeline (${repoName})` : "2 Pipeline";

  if (collapsed) {
    return <PanelBox title={title} active={active} width={width} collapsed />;
  }

  // Account for 2 columns of border chrome
  const maxSlugLen = Math.max(8, width - 8);

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
                panelActive={active}
                maxSlugLen={maxSlugLen}
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
