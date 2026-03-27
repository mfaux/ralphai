/**
 * HelpOverlay — full-screen overlay listing all keyboard shortcuts.
 *
 * Toggled by `?`. Dismissed by `?` or `Esc`.
 */

import React from "react";
import { Box, Text } from "ink";

const SHORTCUTS: Array<{ key: string; desc: string }> = [
  { key: "1", desc: "Focus RepoBar" },
  { key: "2", desc: "Focus Pipeline" },
  { key: "3", desc: "Focus Detail (opens split if closed)" },
  { key: "Tab", desc: "Cycle focus to next pane" },
  { key: "Shift+Tab", desc: "Cycle focus to previous pane" },
  { key: "", desc: "" },
  { key: "\u2191/\u2193", desc: "Navigate within focused pane" },
  { key: "Enter", desc: "Open detail, focus detail, or open dropdown" },
  { key: "a", desc: "Open action menu for selected plan" },
  { key: "/", desc: "Open filter bar" },
  { key: "?", desc: "Toggle this help overlay" },
  { key: "q", desc: "Quit the dashboard" },
  { key: "", desc: "" },
  { key: "Esc", desc: "Close overlay / go back" },
  { key: "\u2191/\u2193", desc: "Scroll content (detail overlay)" },
  { key: "\u2190/\u2192", desc: "Switch detail tabs" },
  { key: "s/p/g/o", desc: "Jump to Summary/Plan/proGress/Output tab" },
  { key: "r", desc: "Run selected plan (backlog only)" },
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
