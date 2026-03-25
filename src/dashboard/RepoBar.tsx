/**
 * RepoBar -- persistent bordered bar at the top of the dashboard showing
 * the currently selected repo with a dropdown indicator.
 *
 * Uses the same rounded-border style as PanelBox for visual consistency.
 * Border highlights cyan when the pane has focus (active).
 *
 * Three visual states:
 * - Repo selected: "▾ repoName  2A·3Q·1D"
 * - No repos registered: hint to run `ralphai add <path>`
 * - Dropdown open: highlighted border with ▴ indicator
 */

import React from "react";
import { Box, Text } from "ink";
import type { RepoSummary } from "../global-state.ts";
import { formatCounts } from "./RepoSelector.tsx";
import { repoDisplayName } from "./format.ts";

interface RepoBarProps {
  repos: RepoSummary[];
  selectedRepo: RepoSummary | null;
  dropdownOpen: boolean;
  active: boolean;
  width: number;
}

export function RepoBar({
  repos,
  selectedRepo,
  dropdownOpen,
  active,
  width,
}: RepoBarProps) {
  const highlighted = active || dropdownOpen;
  const borderColor = highlighted ? "cyan" : "gray";

  // Empty state: no repos registered
  if (repos.length === 0) {
    return (
      <Box width={width} borderStyle="round" borderColor="gray" borderDimColor>
        <Text dimColor>No repos {"\u00B7"} run </Text>
        <Text color="cyan">ralphai add {"<path>"}</Text>
        <Text dimColor> to get started</Text>
      </Box>
    );
  }

  // Normal state: show selected repo with dropdown indicator
  const indicator = dropdownOpen ? "\u25B4" : "\u25BE";
  const counts = selectedRepo ? formatCounts(selectedRepo) : "";
  const displayName = selectedRepo
    ? repoDisplayName(selectedRepo, repos)
    : "Select repo";

  return (
    <Box
      width={width}
      borderStyle="round"
      borderColor={borderColor}
      borderDimColor={!highlighted}
    >
      <Text
        bold={highlighted}
        color={highlighted ? "cyan" : undefined}
        dimColor={!highlighted}
      >
        1{" "}
      </Text>
      <Text color={highlighted ? "cyan" : undefined} bold={highlighted}>
        {indicator} {displayName}
      </Text>
      {counts && counts !== "empty" ? (
        <Text dimColor>
          {"  "}
          {counts}
        </Text>
      ) : null}
    </Box>
  );
}
