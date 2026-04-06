/**
 * Reset plan screen for the TUI.
 *
 * Shows a list of resettable in-progress plans (any liveness except
 * "outcome"). Uses the `SelectableList` component.
 *
 * - Shows picker of all resettable plans with liveness status hints
 * - On select: calls the injected `resetPlan` callback, returns to
 *   main menu with refreshed state
 * - Esc: returns to main menu
 *
 * Pure helpers are exported for unit testing:
 * - `buildResetItems` — maps resettable plans to ListItem[]
 * - `resetSelect` — maps a selected value to a ResetIntent
 * - `livenessHint` — returns a human-readable hint for a plan's liveness
 */

import { useMemo, useCallback } from "react";
import { Box, Text } from "ink";

import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type { DispatchResult } from "../types.ts";
import type { InProgressPlan } from "../../pipeline-state.ts";
import type { LivenessStatus } from "../../pipeline-state.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResetScreenProps {
  /** Resettable plans from pipeline state. */
  resettablePlans: InProgressPlan[];
  /** Working directory for the reset command. */
  cwd: string;
  /** Called when the user selects a plan or navigates back. */
  onResult: (result: DispatchResult) => void;
  /**
   * Injected reset function. Defaults to no-op — the real implementation
   * is wired by the App component.
   */
  resetPlan?: (cwd: string, slug: string) => void;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

/** What the reset screen should do after a selection. */
export type ResetIntent = { type: "reset"; slug: string } | { type: "back" };

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Return a human-readable hint string for a plan's liveness status.
 *
 * - `running` → "running"
 * - `stalled` → "stalled"
 * - `in_progress` → "in progress"
 * - `outcome` → the outcome string (should not appear in resettable plans)
 */
export function livenessHint(liveness: LivenessStatus): string {
  switch (liveness.tag) {
    case "running":
      return "running";
    case "stalled":
      return "stalled";
    case "in_progress":
      return "in progress";
    case "outcome":
      return liveness.outcome;
  }
}

/**
 * Convert resettable plans into a flat `ListItem[]` for the picker.
 *
 * Each plan shows its filename with a liveness status hint.
 */
export function buildResetItems(plans: InProgressPlan[]): ListItem[] {
  const items: ListItem[] = plans.map((plan) => {
    const parts: string[] = [];
    if (plan.scope) parts.push(`scope: ${plan.scope}`);
    parts.push(livenessHint(plan.liveness));

    return {
      value: plan.slug,
      label: plan.filename,
      hint: parts.join(" · "),
    };
  });

  items.push({
    value: "__back__",
    label: "Back",
  });

  return items;
}

/**
 * Map a selected picker value to a `ResetIntent`.
 *
 * Returns `{ type: "reset", slug }` for plan slugs, or `{ type: "back" }`
 * for the back sentinel.
 */
export function resetSelect(value: string): ResetIntent {
  if (value === "__back__") return { type: "back" };
  return { type: "reset", slug: value };
}

// ---------------------------------------------------------------------------
// Custom item renderer
// ---------------------------------------------------------------------------

function ResetListItem({
  item,
  isCursor,
  isDisabled,
}: {
  item: ListItem;
  isCursor: boolean;
  isDisabled: boolean;
}) {
  const cursor = isCursor ? "\u276F " : "  ";
  const labelColor = isDisabled ? "gray" : isCursor ? "cyan" : undefined;

  return (
    <Box>
      <Text color={isCursor ? "cyan" : undefined}>{cursor}</Text>
      <Text color={labelColor} dimColor={isDisabled}>
        {item.label}
      </Text>
      {item.hint ? <Text dimColor> {item.hint}</Text> : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// ResetScreen component
// ---------------------------------------------------------------------------

export function ResetScreen({
  resettablePlans: plans,
  cwd,
  onResult,
  resetPlan,
  isActive = true,
}: ResetScreenProps) {
  const handleBack = useCallback(() => {
    onResult({ type: "navigate", screen: { type: "menu" } });
  }, [onResult]);

  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <ResetListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // --- Dispatch intent ---
  const handleIntent = useCallback(
    (intent: ResetIntent) => {
      if (intent.type === "back") {
        handleBack();
        return;
      }
      // Reset the plan and return to menu
      if (resetPlan) {
        resetPlan(cwd, intent.slug);
      }
      // Navigate back to menu (pipeline state will refresh)
      onResult({ type: "stay" });
    },
    [cwd, resetPlan, onResult, handleBack],
  );

  // --- Empty state ---
  if (plans.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>No resettable plans</Text>
        <Box marginTop={1}>
          <SelectableList
            items={[{ value: "__back__", label: "Back" }]}
            onSelect={handleBack}
            onBack={handleBack}
            isActive={isActive}
          />
        </Box>
      </Box>
    );
  }

  // --- Plan picker ---
  const listItems = useMemo(() => buildResetItems(plans), [plans]);

  const handlePickerSelect = useCallback(
    (value: string) => {
      handleIntent(resetSelect(value));
    },
    [handleIntent],
  );

  return (
    <Box flexDirection="column">
      <Box paddingLeft={1} marginBottom={1}>
        <Text bold>Pick a plan to reset to backlog</Text>
        <Text dimColor> ({plans.length} resettable)</Text>
      </Box>
      <SelectableList
        items={listItems}
        onSelect={handlePickerSelect}
        onBack={handleBack}
        isActive={isActive}
        renderItem={renderItem}
      />
    </Box>
  );
}
