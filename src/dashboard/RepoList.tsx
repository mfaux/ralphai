/**
 * RepoList — arrow-key navigable list of known repos.
 *
 * Displays repo ID, path, and pipeline counts. Press Enter to select,
 * q to quit.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { RepoSummary } from "../global-state.ts";

interface RepoListProps {
  repos: RepoSummary[];
  onSelect: (repo: RepoSummary) => void;
  onQuit: () => void;
}

export function RepoList({ repos, onSelect, onQuit }: RepoListProps) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (input === "q") {
      onQuit();
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === "j") {
      setCursor((prev) => Math.min(repos.length - 1, prev + 1));
    }
    if (key.return) {
      const selected = repos[cursor];
      if (selected) onSelect(selected);
    }
  });

  if (repos.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>No repos found.</Text>
        <Text dimColor>
          Run <Text color="white">ralphai init</Text> inside a git repo to get
          started.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Repos</Text>
      <Text dimColor>
        {"  "}
        {"\u2191\u2193 navigate \u00B7 Enter select \u00B7 q quit"}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {repos.map((repo, i) => {
          const selected = i === cursor;
          const pointer = selected ? "\u276F" : " ";
          const stale = repo.repoPath && !repo.pathExists ? " [stale]" : "";

          const counts: string[] = [];
          if (repo.backlogCount > 0) counts.push(`${repo.backlogCount} queued`);
          if (repo.inProgressCount > 0)
            counts.push(`${repo.inProgressCount} active`);
          if (repo.completedCount > 0)
            counts.push(`${repo.completedCount} done`);
          const summary = counts.length > 0 ? counts.join(", ") : "empty";

          return (
            <Box key={repo.id}>
              <Text color={selected ? "cyan" : undefined} bold={selected}>
                {pointer}{" "}
              </Text>
              <Text color={selected ? "white" : undefined} bold={selected}>
                {repo.id}
              </Text>
              <Text dimColor>
                {"  "}
                {repo.repoPath ?? "(unknown path)"}
                {stale}
              </Text>
              <Text dimColor>
                {"  "}
                {summary}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
