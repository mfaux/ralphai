/**
 * Pipeline summary header component for the TUI.
 *
 * Renders "Pipeline: N backlog · N running · N completed" with Ink-native
 * styling, plus a stalled-plans warning when applicable. Displays a
 * loading indicator when pipeline state has not yet loaded.
 *
 * Pure helper functions (`buildHeaderParts`, `buildStalledWarning`) are
 * exported for unit testing without React rendering.
 */

import { useMemo } from "react";
import { Box, Text } from "ink";

import type { PipelineState } from "../../plan-lifecycle.ts";
import { stalledPlans } from "../../interactive/pipeline-actions.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineHeaderProps {
  /** Current pipeline state, or null if still loading. */
  state: PipelineState | null;
  /** Human-readable error string from the pipeline hook. */
  error?: string;
}

/**
 * A segment of the pipeline summary (e.g. "3 backlog").
 *
 * Each part is rendered as a `<Text>` element. The optional `warning`
 * flag causes the part to render with a distinct style.
 */
export interface HeaderPart {
  text: string;
  warning?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of header parts from pipeline state.
 *
 * Returns `null` when the pipeline is empty (all counts zero),
 * signalling the caller to render "empty" instead.
 *
 * Examples:
 * - `[{ text: "3 backlog" }, { text: "1 running" }, { text: "5 completed" }]`
 * - `[..., { text: "⚠ 1 plan stalled", warning: true }]`
 * - `null` when all counts are zero
 */
export function buildHeaderParts(state: PipelineState): HeaderPart[] | null {
  const backlogCount = state.backlog.length;
  const runningCount = state.inProgress.length;
  const completedCount = state.completedSlugs.length;

  if (backlogCount === 0 && runningCount === 0 && completedCount === 0) {
    return null;
  }

  const parts: HeaderPart[] = [
    { text: `${backlogCount} backlog` },
    { text: `${runningCount} running` },
    { text: `${completedCount} completed` },
  ];

  const warning = buildStalledWarning(state);
  if (warning) {
    parts.push({ text: warning, warning: true });
  }

  return parts;
}

/**
 * Build the stalled-plans warning string, or `undefined` if no plans
 * are stalled.
 *
 * Examples:
 * - "⚠ 1 plan stalled"
 * - "⚠ 3 plans stalled"
 */
export function buildStalledWarning(state: PipelineState): string | undefined {
  const count = stalledPlans(state).length;
  if (count === 0) return undefined;
  return `⚠ ${count} plan${count === 1 ? "" : "s"} stalled`;
}

/**
 * Determine the fallback header text for states that don't use
 * `buildHeaderParts` (loading, error, empty).
 *
 * Returns:
 * - `"loading…"` when state is null and no error
 * - the error string when state is null and error is set
 * - `"empty"` when state has all zero counts
 * - `undefined` when state has data (caller should use `buildHeaderParts`)
 */
export function buildHeaderText(
  state: PipelineState | null,
  error?: string,
): string | undefined {
  if (state === null) {
    return error ?? "loading…";
  }
  const parts = buildHeaderParts(state);
  if (!parts) return "empty";
  return undefined;
}

// ---------------------------------------------------------------------------
// PipelineHeader component
// ---------------------------------------------------------------------------

/**
 * Renders the pipeline summary header line.
 *
 * - When `state` is `null`: shows "Pipeline: loading…"
 * - When state is empty: shows "Pipeline: empty"
 * - Otherwise: shows "Pipeline: N backlog · N running · N completed"
 *   with optional stalled warning
 */
export function PipelineHeader({ state, error }: PipelineHeaderProps) {
  const parts = useMemo(
    () => (state ? buildHeaderParts(state) : undefined),
    [state],
  );

  // Error state — show error instead of "loading…"
  if (state === null && error) {
    return (
      <Box>
        <Text>Pipeline: </Text>
        <Text color="yellow">{error}</Text>
      </Box>
    );
  }

  // Loading state
  if (state === null) {
    return (
      <Box>
        <Text>Pipeline: </Text>
        <Text dimColor>loading…</Text>
      </Box>
    );
  }

  // Empty pipeline
  if (!parts) {
    return (
      <Box>
        <Text>Pipeline: </Text>
        <Text dimColor>empty</Text>
      </Box>
    );
  }

  // Pipeline with counts
  return (
    <Box>
      <Text>Pipeline: </Text>
      {parts.map((part, i) => (
        <Text key={i}>
          {i > 0 ? <Text dimColor> · </Text> : null}
          <Text
            dimColor={!part.warning}
            color={part.warning ? "yellow" : undefined}
          >
            {part.text}
          </Text>
        </Text>
      ))}
    </Box>
  );
}
