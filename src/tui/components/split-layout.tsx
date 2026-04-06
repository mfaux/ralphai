/**
 * Responsive split-layout component for the TUI.
 *
 * Renders a left pane (menu) alongside a right pane (detail) when the
 * terminal is wide enough (≥120 columns). On narrower terminals, only
 * the left pane is shown.
 *
 * Uses flex-grow proportions (~40/60) so the layout naturally fits
 * within whatever width the parent provides (e.g. inside the
 * ScreenFrame border), avoiding width overflow.
 *
 * The layout dynamically switches when the terminal is resized across
 * the threshold, driven by the `useTerminalSize` hook which subscribes
 * to SIGWINCH events.
 *
 * Pure layout helper (`shouldSplit`) is exported for unit testing
 * without React rendering.
 */

import { Box } from "ink";

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
 * Flex-grow value for the left (menu) pane.
 * With LEFT_FLEX=2 and RIGHT_FLEX=3, the split is ~40/60.
 */
export const LEFT_FLEX = 2;

/**
 * Flex-grow value for the right (detail) pane.
 */
export const RIGHT_FLEX = 3;

/**
 * Background colour for the right (detail) pane.
 * A subtle dark grey that provides visual separation without
 * being distracting.
 */
export const RIGHT_PANE_BG = "#1e1e1e";

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
// SplitLayout component
// ---------------------------------------------------------------------------

/**
 * Responsive split-layout container.
 *
 * - At ≥120 columns: renders `left` and `right` children side-by-side
 *   using flex-grow proportions (~40/60 split). The right pane is
 *   separated by padding — no background colour needed.
 * - At <120 columns: renders only `left` at full width.
 * - Dynamically switches on terminal resize (SIGWINCH).
 *
 * Flex-based sizing means the layout naturally fits within whatever
 * width the parent provides (e.g. inside the ScreenFrame border).
 */
export function SplitLayout({
  left,
  right,
  terminalSizeOptions,
}: SplitLayoutProps) {
  const { width: terminalWidth } = useTerminalSize(terminalSizeOptions);

  // Narrow terminal: single-pane mode
  if (!shouldSplit(terminalWidth)) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {left}
      </Box>
    );
  }

  // Wide terminal: flex-proportional split layout.
  // The outer row uses flexGrow so it stretches to fill the
  // ScreenFrame's remaining height, giving the right pane's
  // background colour a solid, full-height panel appearance.
  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexGrow={LEFT_FLEX} flexBasis={0} flexDirection="column" paddingX={2} paddingY={1}>
        {left}
      </Box>
      <Box
        flexGrow={RIGHT_FLEX}
        flexBasis={0}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        backgroundColor={RIGHT_PANE_BG}
      >
        {right}
      </Box>
    </Box>
  );
}
