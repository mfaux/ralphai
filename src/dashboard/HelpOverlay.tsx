/**
 * HelpOverlay — full-screen overlay listing all keyboard shortcuts.
 *
 * Toggled by `?`. Dismissed by `?` or `Esc`.
 */

import React from "react";
import { Box, Text } from "ink";

const SHORTCUTS: Array<{ key: string; desc: string }> = [
  { key: "\u2191/\u2193", desc: "Navigate items in the active panel" },
  { key: "1/2/3", desc: "Jump to Repos / Pipeline / Worktrees panel" },
  { key: "Tab/S-Tab", desc: "Cycle panels forward / backward" },
  { key: "Enter", desc: "Open action menu for selected item" },
  { key: "Esc", desc: "Go back one level (close overlay / unfocus detail)" },
  { key: "/", desc: "Open filter bar (filters Pipeline panel)" },
  { key: "?", desc: "Toggle this help overlay" },
  { key: "q", desc: "Quit the dashboard" },
  { key: "", desc: "" },
  { key: "\u2190/\u2192", desc: "Switch detail tabs (when detail focused)" },
  { key: "s/p/g/o", desc: "Jump to Summary/Plan/proGress/Output tab" },
  { key: "f", desc: "Toggle follow-tail mode (Output tab)" },
  { key: "", desc: "" },
  { key: "r", desc: "Run selected plan (from action menu)" },
  { key: "w", desc: "Run in worktree (from action menu)" },
  { key: "R", desc: "Reset in-progress plan to backlog" },
  { key: "P", desc: "Purge completed plan" },
];

export function HelpOverlay() {
  const maxKeyLen = Math.max(...SHORTCUTS.map((s) => s.key.length));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">
        Keyboard Shortcuts
      </Text>
      <Box marginTop={1} flexDirection="column">
        {SHORTCUTS.map(({ key, desc }, i) => {
          if (!key && !desc) {
            return <Text key={i}>{""}</Text>;
          }
          return (
            <Box key={key || `sep-${i}`}>
              <Text bold>{key.padEnd(maxKeyLen + 2)}</Text>
              <Text dimColor>{desc}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
