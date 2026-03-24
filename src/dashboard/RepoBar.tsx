/**
 * RepoBar — compact single-row tab bar for switching repos.
 *
 * Renders all repos inline separated by │. The selected repo is
 * highlighted in cyan+bold. Each repo shows its name and plan counts.
 * Press [ / ] to switch repos.
 */

import React from "react";
import { Box, Text } from "ink";
import type { RepoSummary } from "../global-state.ts";

interface RepoBarProps {
  repos: RepoSummary[];
  selectedIndex: number;
  width: number;
}

function formatCounts(repo: RepoSummary): string {
  const parts: string[] = [];
  if (repo.inProgressCount > 0) parts.push(`${repo.inProgressCount}A`);
  if (repo.backlogCount > 0) parts.push(`${repo.backlogCount}Q`);
  if (repo.completedCount > 0) parts.push(`${repo.completedCount}D`);
  return parts.length > 0 ? parts.join("\u00B7") : "empty";
}

export function RepoBar({ repos, selectedIndex, width }: RepoBarProps) {
  if (repos.length === 0) {
    return (
      <Box height={1} width={width}>
        <Text dimColor> No repos found. Run ralphai init in a project.</Text>
      </Box>
    );
  }

  return (
    <Box height={1} width={width}>
      <Text dimColor> </Text>
      {repos.map((repo, i) => {
        const selected = i === selectedIndex;
        const counts = formatCounts(repo);

        return (
          <Box key={repo.id}>
            {i > 0 && <Text dimColor> {"\u2502"} </Text>}
            <Text color={selected ? "cyan" : undefined} bold={selected}>
              {repo.id}
            </Text>
            <Text dimColor> {counts}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
