/**
 * ReposPanel — top-left stacked panel showing known repos.
 *
 * Each row: cursor indicator, activity dot, repo name, plan counts.
 * Wrapped in a PanelBox with rounded borders.
 */

import React from "react";
import { Box, Text } from "ink";
import type { RepoSummary } from "../global-state.ts";
import { PanelBox } from "./PanelBox.tsx";

interface ReposPanelProps {
  repos: RepoSummary[];
  cursor: number;
  active: boolean;
  width: number;
  height?: number;
  collapsed?: boolean;
}

function formatCounts(repo: RepoSummary): string {
  const parts: string[] = [];
  if (repo.inProgressCount > 0) parts.push(`${repo.inProgressCount}A`);
  if (repo.backlogCount > 0) parts.push(`${repo.backlogCount}Q`);
  if (repo.completedCount > 0) parts.push(`${repo.completedCount}D`);
  return parts.length > 0 ? parts.join(" \u00B7 ") : "empty";
}

export function ReposPanel({
  repos,
  cursor,
  active,
  width,
  height,
  collapsed,
}: ReposPanelProps) {
  if (collapsed) {
    return <PanelBox title="1 Repos" active={active} width={width} collapsed />;
  }

  // Account for 2 columns of border chrome
  const maxNameLen = Math.max(8, width - 20);

  return (
    <PanelBox title="1 Repos" active={active} width={width} height={height}>
      {repos.length === 0 ? (
        <Text dimColor> No repos found.</Text>
      ) : (
        repos.map((repo, i) => {
          const selected = i === cursor;
          const pointer = selected ? "\u27A4" : " ";
          const hasActive = repo.inProgressCount > 0;
          const dot = hasActive ? "\u25CF" : "\u25CB";
          const dotColor = hasActive ? "green" : "gray";

          const name =
            repo.id.length > maxNameLen
              ? repo.id.slice(0, maxNameLen - 1) + "\u2026"
              : repo.id;
          const counts = formatCounts(repo);

          return (
            <Box key={repo.id}>
              <Text
                color={
                  selected && active ? "cyan" : selected ? "white" : undefined
                }
                bold={selected}
              >
                {pointer}{" "}
              </Text>
              <Text color={dotColor}>{dot} </Text>
              <Text color={selected ? "white" : undefined} bold={selected}>
                {name}
              </Text>
              <Text dimColor>
                {"  "}
                {counts}
              </Text>
            </Box>
          );
        })
      )}
    </PanelBox>
  );
}
