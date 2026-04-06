/**
 * Responsive split-layout component for the TUI.
 *
 * Renders a left pane (menu) alongside a right pane (detail) when the
 * terminal is wide enough (≥120 columns), separated by a vertical line.
 * On narrower terminals, only the left pane is shown.
 *
 * The layout dynamically switches when the terminal is resized across
 * the threshold, driven by the `useTerminalSize` hook which subscribes
 * to SIGWINCH events.
 *
 * Pure layout helpers (`shouldSplit`, `computePaneWidths`) are exported
 * for unit testing without React rendering.
 */

import { useMemo } from "react";
import { Box, Text } from "ink";

import { useTerminalSize } from "../hooks/use-terminal-size.ts";
import type { UseTerminalSizeOptions } from "../hooks/use-terminal-size.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum terminal width (in columns) at which the split layout engages.
 * Below this threshold, only the left pane is rendered.
 */
export const SPLIT_THRESHOLD = 120;

/**
 * Width of the vertical separator between left and right panes.
 * Accounts for the "│" character plus surrounding padding.
 */
export const SEPARATOR_WIDTH = 3;

/**
 * Fraction of available width allocated to the left pane (menu) when
 * the split layout is active. The remaining fraction goes to the right
 * pane (detail).
 */
export const LEFT_PANE_RATIO = 0.4;

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Determine whether the split layout should be active based on terminal
 * width.
 *
 * Returns `true` when the terminal is at least `SPLIT_THRESHOLD` columns
 * wide.
 */
export function shouldSplit(terminalWidth: number): boolean {
  return terminalWidth >= SPLIT_THRESHOLD;
}

/**
 * Pane width allocation for the split layout.
 */
export interface PaneWidths {
  /** Width of the left pane in columns. */
  left: number;
  /** Width of the right pane in columns. */
  right: number;
}

/**
 * Compute the width allocation for left and right panes.
 *
 * The left pane gets `LEFT_PANE_RATIO` of the total width (after
 * subtracting the separator). The right pane gets the remainder.
 *
 * Both values are clamped to a minimum of 1 column.
 *
 * Returns `null` when the terminal is too narrow for a split layout,
 * indicating that only the left pane should be rendered at full width.
 */
export function computePaneWidths(terminalWidth: number): PaneWidths | null {
  if (!shouldSplit(terminalWidth)) return null;

  const available = terminalWidth - SEPARATOR_WIDTH;
  const left = Math.max(1, Math.floor(available * LEFT_PANE_RATIO));
  const right = Math.max(1, available - left);

  return { left, right };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SplitLayoutProps {
  /**
   * Content for the left pane (typically the menu).
   * Always rendered regardless of terminal width.
   */
  left: React.ReactNode;
  /**
   * Content for the right pane (typically the detail view).
   * Only rendered when the terminal is wide enough.
   */
  right: React.ReactNode;
  /**
   * Options for the terminal size hook. Override in tests to inject
   * a fake `getSize` / `onResize`.
   */
  terminalSizeOptions?: UseTerminalSizeOptions;
}

// ---------------------------------------------------------------------------
// Separator component
// ---------------------------------------------------------------------------

/**
 * Vertical line separator between the two panes.
 * Renders a dim "│" character that stretches the full height.
 */
function Separator() {
  return (
    <Box width={SEPARATOR_WIDTH} justifyContent="center" alignItems="stretch">
      <Text dimColor>│</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// SplitLayout component
// ---------------------------------------------------------------------------

/**
 * Responsive split-layout container.
 *
 * - At ≥120 columns: renders `left` and `right` children side-by-side
 *   separated by a vertical line.
 * - At <120 columns: renders only `left` at full width.
 * - Dynamically switches on terminal resize (SIGWINCH).
 */
export function SplitLayout({
  left,
  right,
  terminalSizeOptions,
}: SplitLayoutProps) {
  const { width: terminalWidth } = useTerminalSize(terminalSizeOptions);

  const paneWidths = useMemo(
    () => computePaneWidths(terminalWidth),
    [terminalWidth],
  );

  // Narrow terminal: single-pane mode
  if (!paneWidths) {
    return <Box flexDirection="column">{left}</Box>;
  }

  // Wide terminal: split layout
  return (
    <Box flexDirection="row" width={terminalWidth}>
      <Box width={paneWidths.left} flexDirection="column" flexShrink={0}>
        {left}
      </Box>
      <Separator />
      <Box width={paneWidths.right} flexDirection="column" flexShrink={0}>
        {right}
      </Box>
    </Box>
  );
}
