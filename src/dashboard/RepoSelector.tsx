/**
 * RepoSelector -- inline dropdown for selecting a repo from the list.
 *
 * Renders as a bordered dropdown list that anchors directly below the
 * RepoBar, rather than a centered overlay. Each row shows a cursor
 * pointer, active-repo marker, repo name, and plan counts.
 */

import React from "react";
import { Box, Text } from "ink";
import type { RepoSummary } from "../global-state.ts";
import { repoDisplayName } from "./format.ts";

interface RepoSelectorProps {
  repos: RepoSummary[];
  cursor: number;
  selectedIndex: number;
}

export function formatCounts(repo: RepoSummary): string {
  const parts: string[] = [];
  if (repo.inProgressCount > 0)
    parts.push(`${repo.inProgressCount} in progress`);
  if (repo.backlogCount > 0) parts.push(`${repo.backlogCount} backlog`);
  if (repo.completedCount > 0) parts.push(`${repo.completedCount} completed`);
  return parts.length > 0 ? parts.join(" \u00B7 ") : "empty";
}

export function RepoSelector({
  repos,
  cursor,
  selectedIndex,
}: RepoSelectorProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      {repos.map((repo, i) => {
        const isCursor = i === cursor;
        const isActive = i === selectedIndex;
        const pointer = isCursor ? "\u25B8" : " ";
        const marker = isActive ? "\u25CF" : " ";
        const name = repoDisplayName(repo, repos);
        const counts = formatCounts(repo);
        const path = repo.repoPath ?? "";

        return (
          <Box key={repo.id}>
            <Text color={isCursor ? "cyan" : undefined} bold={isCursor}>
              {pointer} {marker} {name}
            </Text>
            <Text dimColor>
              {"  "}
              {counts}
              {path ? `  ${path}` : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
