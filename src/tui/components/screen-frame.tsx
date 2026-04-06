/**
 * Screen frame component for the TUI.
 *
 * Wraps all screen content in a fullscreen bordered container that
 * fills the terminal. The border uses Ink's `"round"` style with a
 * contextual accent color reflecting pipeline health.
 *
 * A breadcrumb (`ralphai > <screen>`) is rendered inside the border
 * at the top, giving the TUI an app-like identity.
 *
 * The frame fills the terminal by reading width and height from the
 * `useTerminalSize` hook and setting explicit dimensions on the
 * outer `<Box>`. The alternate screen buffer is managed by `run-tui.tsx`
 * so the user's scrollback is preserved.
 *
 * The border color is determined by `borderColor()`, a pure helper
 * that maps pipeline state to a color string:
 *   - `"cyan"` — default (healthy pipeline or loading)
 *   - `"yellow"` — when stalled plans are detected
 *   - `"green"` / `"red"` — via `colorOverride` for screens that
 *     report their own health status (e.g. doctor)
 *
 * Pure helpers (`borderColor`, `screenLabel`, `SCREEN_LABELS`) are
 * exported for unit testing without React rendering.
 */

import { Box, Text } from "ink";

import type { PipelineState } from "../../pipeline-state.ts";
import type { Screen } from "../types.ts";
import { stalledPlans } from "../../interactive/pipeline-actions.ts";
import { useTerminalSize } from "../hooks/use-terminal-size.ts";
import type { UseTerminalSizeOptions } from "../hooks/use-terminal-size.ts";
import { PipelineHeader } from "./header.tsx";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Human-readable labels for each screen type, used in the breadcrumb.
 */
export const SCREEN_LABELS: Record<Screen["type"], string> = {
  menu: "menu",
  "issue-picker": "issues",
  "backlog-picker": "backlog",
  confirm: "confirm",
  options: "options",
  stop: "stop",
  reset: "reset",
  status: "status",
  doctor: "doctor",
  clean: "clean",
};

/**
 * Border style for the outer frame.
 */
export const FRAME_BORDER_STYLE = "round" as const;

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Get the display label for a screen type.
 *
 * Returns the human-readable label from `SCREEN_LABELS`, falling back
 * to the raw screen type string for unknown values.
 */
export function screenLabel(screenType: Screen["type"]): string {
  return SCREEN_LABELS[screenType] ?? screenType;
}

/**
 * Determine the accent color for the border based on pipeline state.
 *
 * Priority:
 * 1. `colorOverride` — if provided, used as-is (for screens that
 *    report their own status, like doctor).
 * 2. Pipeline has stalled plans → `"yellow"`
 * 3. Default → `"cyan"`
 *
 * Returns a color string compatible with Ink's `borderColor` prop.
 */
export function borderColor(
  pipelineState: PipelineState | null,
  colorOverride?: string,
): string {
  if (colorOverride) return colorOverride;
  if (pipelineState && stalledPlans(pipelineState).length > 0) {
    return "yellow";
  }
  return "cyan";
}

/**
 * @deprecated Alias for `borderColor`. Kept for backward compatibility
 * with existing tests.
 */
export const bannerColor = borderColor;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenFrameProps {
  /** The current screen type, used for the breadcrumb label. */
  screenType: Screen["type"];
  /** Current pipeline state, used to determine border color. */
  pipelineState: PipelineState | null;
  /**
   * Override the border color for screens that report their own health
   * status (e.g. doctor passing = green, failing = red). When omitted,
   * the border color is derived from pipeline state.
   */
  colorOverride?: string;
  /**
   * Options for the terminal size hook. Override in tests to inject
   * a fake terminal size.
   */
  terminalSizeOptions?: UseTerminalSizeOptions;
  /** Screen content to render inside the frame. */
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// ScreenFrame component
// ---------------------------------------------------------------------------

/**
 * Fullscreen bordered frame that wraps all TUI content.
 *
 * Fills the terminal with a rounded border and renders a breadcrumb
 * at the top (`ralphai > <screen>`). The border color reflects
 * pipeline health (cyan = healthy, yellow = stalled plans).
 *
 * Content is rendered inside the border with padding for readability.
 */
export function ScreenFrame({
  screenType,
  pipelineState,
  colorOverride,
  terminalSizeOptions,
  children,
}: ScreenFrameProps) {
  const { width, height } = useTerminalSize(terminalSizeOptions);
  const color = borderColor(pipelineState, colorOverride);
  const label = screenLabel(screenType);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle={FRAME_BORDER_STYLE}
      borderColor={color}
    >
      {/* Breadcrumb header */}
      <Box>
        <Text color={color} bold>
          ralphai
        </Text>
        <Text dimColor> &gt; </Text>
        <Text dimColor>{label}</Text>
      </Box>

      {/* Screen content */}
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {children}
      </Box>

      {/* Pipeline status bar at the bottom */}
      <Box marginTop={1}>
        <PipelineHeader state={pipelineState} />
      </Box>
    </Box>
  );
}
