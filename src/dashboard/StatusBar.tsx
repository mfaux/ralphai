/**
 * StatusBar — bottom bar with context-sensitive keyboard hints and toast.
 *
 * Hints change based on the current FocusTarget:
 * - panel:  ↑↓ navigate · Tab/1-3 panels · Enter actions · / filter · ? help · q quit
 * - detail: ↑↓ scroll · ←→ tabs · f follow · Esc back
 * - menu:   ↑↓ select · Enter confirm · Esc cancel
 * - filter: type to filter · Enter apply · Esc clear
 * - help:   ? or Esc to close
 *
 * Toast messages appear right-aligned and auto-expire.
 */

import React from "react";
import { Box, Text } from "ink";
import type { FocusTarget } from "./types.ts";

interface StatusBarProps {
  focus: FocusTarget;
  toast: string | null;
  repoName: string | null;
  planCount: number;
}

const HINTS: Record<FocusTarget, string> = {
  panel:
    "\u2191\u2193 navigate \u00B7 Enter actions \u00B7 Tab detail \u00B7 / filter \u00B7 ? help \u00B7 q quit",
  detail:
    "\u2191\u2193 scroll \u00B7 \u2190\u2192 tabs \u00B7 Enter actions \u00B7 f follow \u00B7 1-3 panels \u00B7 Esc back",
  menu: "\u2191\u2193 select \u00B7 Enter confirm \u00B7 Esc cancel",
  filter: "type to filter \u00B7 Enter apply \u00B7 Esc clear",
  help: "? or Esc to close",
};

export function StatusBar({
  focus,
  toast,
  repoName,
  planCount,
}: StatusBarProps) {
  const hint = HINTS[focus];

  return (
    <Box height={1}>
      <Box flexGrow={1}>
        <Text dimColor>{hint}</Text>
      </Box>
      {toast ? (
        <Box>
          <Text color="yellow">{toast}</Text>
        </Box>
      ) : repoName ? (
        <Box>
          <Text dimColor>
            {repoName} \u00B7 {planCount} plan{planCount !== 1 ? "s" : ""}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
