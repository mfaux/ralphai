/**
 * PlanListPane — left pane of the two-pane workspace.
 *
 * Shows plans grouped by state (active, queued, done) with a cursor.
 * Receives focus state from parent; when focused, ↑↓ moves the cursor.
 */

import React from "react";
import { Box, Text } from "ink";
import type { PlanInfo } from "./types.ts";

interface PlanListPaneProps {
  plans: PlanInfo[];
  cursor: number;
  focused: boolean;
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

const STATE_BADGE: Record<PlanInfo["state"], string> = {
  "in-progress": "\u25CF",
  backlog: "\u25CB",
  completed: "\u2713",
};

const STATE_BADGE_COLOR: Record<
  PlanInfo["state"],
  "green" | "yellow" | "gray"
> = {
  "in-progress": "green",
  backlog: "yellow",
  completed: "gray",
};

export function PlanListPane({ plans, cursor, focused }: PlanListPaneProps) {
  // Group plans by state
  const grouped = new Map<PlanInfo["state"], PlanInfo[]>();
  for (const state of STATE_ORDER) {
    grouped.set(
      state,
      plans.filter((p) => p.state === state),
    );
  }

  // Build a flat index so we can map cursor position to plan
  let flatIndex = 0;

  return (
    <Box flexDirection="column" width={28}>
      {STATE_ORDER.map((state) => {
        const group = grouped.get(state) ?? [];
        if (group.length === 0) return null;

        const header = (
          <Box key={`header-${state}`} marginTop={flatIndex > 0 ? 1 : 0}>
            <Text dimColor>
              {STATE_LABELS[state]} ({group.length})
            </Text>
          </Box>
        );

        const items = group.map((plan) => {
          const idx = flatIndex++;
          const selected = idx === cursor;
          const pointer = selected ? "\u276F" : " ";
          const truncSlug =
            plan.slug.length > 20
              ? plan.slug.slice(0, 19) + "\u2026"
              : plan.slug;

          return (
            <Box key={plan.slug + plan.state}>
              <Text
                color={
                  selected && focused ? "cyan" : selected ? "white" : undefined
                }
                bold={selected}
              >
                {pointer} {truncSlug}
              </Text>
              <Text> </Text>
              <Text color={STATE_BADGE_COLOR[plan.state]}>
                {STATE_BADGE[plan.state]}
              </Text>
            </Box>
          );
        });

        return (
          <Box key={state} flexDirection="column">
            {header}
            {items}
          </Box>
        );
      })}

      {plans.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No plans in pipeline.</Text>
        </Box>
      )}
    </Box>
  );
}
