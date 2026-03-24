/**
 * WorktreeStrip — compact inline display of active worktrees.
 *
 * Renders as a single line (or two if many worktrees) without borders.
 * Only shown when worktrees exist. Format: "wt: branch (status) · ..."
 */

import React from "react";
import { Box, Text } from "ink";
import type { WorktreeInfo } from "./types.ts";

interface WorktreeStripProps {
  worktrees: WorktreeInfo[];
  width: number;
}

export function WorktreeStrip({ worktrees, width }: WorktreeStripProps) {
  if (worktrees.length === 0) return null;

  return (
    <Box height={1} width={width} overflow="hidden">
      <Text dimColor> wt: </Text>
      {worktrees.map((wt, i) => (
        <Box key={wt.path}>
          {i > 0 && <Text dimColor> {"\u00B7"} </Text>}
          <Text dimColor>{wt.shortBranch}</Text>
          <Text color={wt.status === "active" ? "green" : "gray"}>
            {" "}
            ({wt.status})
          </Text>
        </Box>
      ))}
    </Box>
  );
}
