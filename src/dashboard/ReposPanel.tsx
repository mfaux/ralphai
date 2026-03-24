/**
 * ReposPanel — top-left stacked panel showing known repos.
 *
 * Header: `1 Repos ───────`
 * Each row: cursor indicator, activity dot, repo name, plan counts.
 */

import React from "react";
import { Box, Text } from "ink";
import type { RepoSummary } from "../global-state.ts";

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

function panelHeader(
  label: string,
  number: string,
  width: number,
  active: boolean,
): string {
  const prefix = `${number} ${label} `;
  const lineLen = Math.max(0, width - prefix.length);
  return prefix + "\u2500".repeat(lineLen);
}

export function ReposPanel({
  repos,
  cursor,
  active,
  width,
  height,
  collapsed,
}: ReposPanelProps) {
  const header = panelHeader("Repos", "1", width, active);

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

  const maxNameLen = Math.max(8, width - 18);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text
        color={active ? "cyan" : undefined}
        bold={active}
        dimColor={!active}
      >
        {header}
      </Text>
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
    </Box>
  );
}
