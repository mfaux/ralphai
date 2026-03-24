/**
 * PipelinePanel — middle-left stacked panel showing plans for the selected repo.
 *
 * Header: `2 Pipeline ────`
 * Plans grouped under state headers (ACTIVE, QUEUED, DONE).
 * Each plan shows slug (smart-truncated), and when width allows, scope + progress bar.
 */

import React from "react";
import { Box, Text } from "ink";
import type { PlanInfo } from "./types.ts";
import { truncateSlug } from "./format.ts";

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

function panelHeader(
  width: number,
  active: boolean,
  repoName?: string,
): string {
  const label = repoName ? `2 Pipeline (${repoName}) ` : "2 Pipeline ";
  const lineLen = Math.max(0, width - label.length);
  return label + "\u2500".repeat(lineLen);
}

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

export function PipelinePanel({
  plans,
  cursor,
  active,
  width,
  height,
  collapsed,
  repoName,
}: PipelinePanelProps) {
  const header = panelHeader(width, active, repoName);

  if (collapsed) {
    return (
      <Box flexDirection="column" width={width} height={1}>
        <Text
          color={active ? "cyan" : undefined}
          bold={active}
          dimColor={!active}
        >
          {header}
        </Text>
      </Box>
    );
  }

  // Max slug length depends on available width (leave room for pointer + badge)
  const maxSlugLen = Math.max(8, width - 6);

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
    <Box flexDirection="column" width={width} height={height}>
      <Text
        color={active ? "cyan" : undefined}
        bold={active}
        dimColor={!active}
      >
        {header}
      </Text>

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
            const pointer = selected ? "\u27A4" : " ";
            const truncated = truncateSlug(plan.slug, maxSlugLen);

            return (
              <Box key={plan.slug + plan.state}>
                <Text
                  color={
                    selected && active ? "cyan" : selected ? "white" : undefined
                  }
                  bold={selected}
                >
                  {pointer} {truncated}
                </Text>
                {width >= 35 && plan.scope && (
                  <Text dimColor> [{plan.scope}]</Text>
                )}
                <ProgressIndicator plan={plan} width={width} />
              </Box>
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
    </Box>
  );
}
