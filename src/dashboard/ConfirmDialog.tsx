/**
 * ConfirmDialog — modal overlay for destructive actions (Reset, Purge).
 *
 * Shows the action name, a description, and y/n prompt.
 */

import React from "react";
import { Box, Text } from "ink";

interface ConfirmDialogProps {
  action: string;
  slug: string;
}

const DESCRIPTIONS: Record<string, string> = {
  reset: "Move this plan back to the backlog and delete its receipt/progress.",
  purge: "Permanently delete this completed plan and its artifacts.",
  "remove-worktree": "Remove this git worktree from disk.",
};

export function ConfirmDialog({ action, slug }: ConfirmDialogProps) {
  const desc = DESCRIPTIONS[action] ?? `Confirm ${action}?`;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="red">
        Confirm: {action}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Plan: <Text bold>{slug}</Text>
        </Text>
        <Text dimColor>{desc}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          Press{" "}
          <Text bold color="green">
            y
          </Text>{" "}
          to confirm, <Text bold>n</Text> or <Text bold>Esc</Text> to cancel
        </Text>
      </Box>
    </Box>
  );
}
