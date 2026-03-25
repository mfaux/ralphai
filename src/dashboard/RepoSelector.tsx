/**
 * RepoSelector — centered overlay for selecting a repo from the list.
 *
 * Modeled on ActionMenu: bordered box with cursor navigation.
 * Each row shows a pointer, active-repo marker, repo name, and plan counts.
 */

import React from "react";
import { Box, Text } from "ink";
import type { RepoSummary } from "../global-state.ts";

interface RepoSelectorProps {
  repos: RepoSummary[];
  cursor: number;
  selectedIndex: number;
}

export function formatCounts(repo: RepoSummary): string {
  const parts: string[] = [];
  if (repo.inProgressCount > 0) parts.push(`${repo.inProgressCount}A`);
  if (repo.backlogCount > 0) parts.push(`${repo.backlogCount}Q`);
  if (repo.completedCount > 0) parts.push(`${repo.completedCount}D`);
  return parts.length > 0 ? parts.join("\u00B7") : "empty";
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
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">
        Select Repo
      </Text>
      <Box marginTop={1} flexDirection="column">
        {repos.map((repo, i) => {
          const isCursor = i === cursor;
          const isActive = i === selectedIndex;
          const pointer = isCursor ? "\u27A4" : " ";
          const marker = isActive ? "\u25CF" : " ";
          const counts = formatCounts(repo);

          return (
            <Box key={repo.id}>
              <Text color={isCursor ? "cyan" : undefined} bold={isCursor}>
                {pointer} {marker} {repo.id}
              </Text>
              <Text dimColor> {counts}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
