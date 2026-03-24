/**
 * WorktreesPanel — bottom-left stacked panel showing git worktrees.
 *
 * Each row: cursor indicator, branch name (stripped of ralphai/ prefix),
 * status (active/idle), linked plan slug if found.
 * Wrapped in a PanelBox with rounded borders.
 */

import React from "react";
import { Box, Text } from "ink";
import type { WorktreeInfo } from "./types.ts";
import { PanelBox } from "./PanelBox.tsx";

interface WorktreesPanelProps {
  worktrees: WorktreeInfo[];
  cursor: number;
  active: boolean;
  width: number;
  height?: number;
  collapsed?: boolean;
}

export function WorktreesPanel({
  worktrees,
  cursor,
  active,
  width,
  height,
  collapsed,
}: WorktreesPanelProps) {
  if (collapsed) {
    return (
      <PanelBox title="3 Worktrees" active={active} width={width} collapsed />
    );
  }

  // Account for 2 columns of border chrome
  const maxBranchLen = Math.max(8, width - 18);

  return (
    <PanelBox title="3 Worktrees" active={active} width={width} height={height}>
      {worktrees.length === 0 ? (
        <Text dimColor> No worktrees.</Text>
      ) : (
        worktrees.map((wt, i) => {
          const selected = i === cursor;
          const pointer = selected ? "\u27A4" : " ";
          const branch =
            wt.shortBranch.length > maxBranchLen
              ? wt.shortBranch.slice(0, maxBranchLen - 1) + "\u2026"
              : wt.shortBranch;
          const statusColor = wt.status === "active" ? "green" : "gray";
          const statusLabel = wt.status;

          return (
            <Box key={wt.path}>
              <Text
                color={
                  selected && active ? "cyan" : selected ? "white" : undefined
                }
                bold={selected}
              >
                {pointer} {branch}
              </Text>
              <Text color={statusColor}>
                {"  "}
                {statusLabel}
              </Text>
              {wt.linkedPlan && (
                <Text dimColor>
                  {"  \u2192 "}
                  {wt.linkedPlan}
                </Text>
              )}
            </Box>
          );
        })
      )}
    </PanelBox>
  );
}
