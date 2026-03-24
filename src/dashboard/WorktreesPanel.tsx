/**
 * WorktreesPanel — bottom-left stacked panel showing git worktrees.
 *
 * Header: `3 Worktrees ───`
 * Each row: cursor indicator, branch name (stripped of ralphai/ prefix),
 * status (active/idle), linked plan slug if found.
 */

import React from "react";
import { Box, Text } from "ink";
import type { WorktreeInfo } from "./types.ts";

interface WorktreesPanelProps {
  worktrees: WorktreeInfo[];
  cursor: number;
  active: boolean;
  width: number;
  height?: number;
  collapsed?: boolean;
}

function panelHeader(width: number, active: boolean): string {
  const prefix = "3 Worktrees ";
  const lineLen = Math.max(0, width - prefix.length);
  return prefix + "\u2500".repeat(lineLen);
}

export function WorktreesPanel({
  worktrees,
  cursor,
  active,
  width,
  height,
  collapsed,
}: WorktreesPanelProps) {
  const header = panelHeader(width, active);

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

  const maxBranchLen = Math.max(8, width - 16);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text
        color={active ? "cyan" : undefined}
        bold={active}
        dimColor={!active}
      >
        {header}
      </Text>
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
    </Box>
  );
}
