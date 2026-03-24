/**
 * FilterBar — inline filter bar that appears above the Pipeline panel.
 *
 * `/` opens the filter bar. Supports `state:` and `scope:` prefixes.
 * Enter applies, Esc clears and closes.
 */

import React from "react";
import { Box, Text } from "ink";

interface FilterBarProps {
  query: string;
  resultCount: number;
}

export function FilterBar({ query, resultCount }: FilterBarProps) {
  return (
    <Box height={1}>
      <Text color="cyan">/</Text>
      <Text>{query}</Text>
      <Text dimColor>
        {"  "}({resultCount} match{resultCount !== 1 ? "es" : ""})
      </Text>
    </Box>
  );
}
