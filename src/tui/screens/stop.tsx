/**
 * Stop running plan screen for the TUI.
 *
 * Shows a list of running plans to stop, or a confirmation prompt when
 * only one plan is running. Uses the `SelectableList` component.
 *
 * - Single running plan: confirmation prompt with PID and plan name
 * - Multiple running plans: picker with PIDs and durations
 * - On confirm: calls the injected `stopPlan` callback, returns to
 *   main menu with refreshed state
 * - Esc: returns to main menu
 *
 * Pure helpers are exported for unit testing:
 * - `buildStopItems` — maps running plans to ListItem[]
 * - `stopSelect` — maps a selected value to a StopIntent
 * - `buildConfirmItems` — builds Y/N confirmation items for a single plan
 * - `confirmSelect` — maps a confirmation value to a StopIntent
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StopScreenProps {
  /** Running plans from pipeline state. */
  runningPlans: InProgressPlan[];
  /** Working directory for the stop command. */
  cwd: string;
  /** Called when the user selects a plan or navigates back. */
  onResult: (result: DispatchResult) => void;
  /**
   * Injected stop function. Defaults to no-op — the real implementation
   * is wired by the App component.
   */
  stopPlan?: (cwd: string, slug: string) => void;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

/** What the stop screen should do after a selection. */
export type StopIntent = { type: "stop"; slug: string } | { type: "back" };

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert running plans into a flat `ListItem[]` for the picker.
 *
 * Each plan shows its filename with PID as a hint.
 */
export function buildStopItems(plans: InProgressPlan[]): ListItem[] {
  const items: ListItem[] = plans.map((plan) => {
    const pid = plan.liveness.tag === "running" ? plan.liveness.pid : undefined;
    const hint = pid !== undefined ? `PID ${pid}` : undefined;

    return {
      value: plan.slug,
      label: plan.filename,
      hint,
    };
  });

  items.push({
    value: "__back__",
    label: "Back",
  });

  return items;
}

/**
 * Map a selected picker value to a `StopIntent`.
 *
 * Returns `{ type: "stop", slug }` for plan slugs, or `{ type: "back" }`
 * for the back sentinel.
 */
export function stopSelect(value: string): StopIntent {
  if (value === "__back__") return { type: "back" };
  return { type: "stop", slug: value };
}

/**
 * Build Y/N confirmation items for stopping a single plan.
 */
export function buildConfirmItems(plan: InProgressPlan): ListItem[] {
  const pid = plan.liveness.tag === "running" ? plan.liveness.pid : undefined;
  const pidStr = pid !== undefined ? ` (PID ${pid})` : "";

  return [
    {
      value: "__confirm__",
      label: `Yes, stop '${plan.slug}'${pidStr}`,
    },
    {
      value: "__back__",
      label: "No, go back",
    },
  ];
}

/**
 * Map a confirmation value to a `StopIntent`.
 */
export function confirmSelect(value: string, slug: string): StopIntent {
  if (value === "__confirm__") return { type: "stop", slug };
  return { type: "back" };
}

// ---------------------------------------------------------------------------
// Custom item renderer
// ---------------------------------------------------------------------------

function StopListItem({
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
// StopScreen component
// ---------------------------------------------------------------------------

export function StopScreen({
  runningPlans: plans,
  cwd,
  onResult,
  stopPlan,
  isActive = true,
}: StopScreenProps) {
  const handleBack = useCallback(() => {
    onResult({ type: "navigate", screen: { type: "menu" } });
  }, [onResult]);

  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <StopListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // --- Dispatch intent ---
  const handleIntent = useCallback(
    (intent: StopIntent) => {
      if (intent.type === "back") {
        handleBack();
        return;
      }
      // Stop the plan and return to menu
      if (stopPlan) {
        stopPlan(cwd, intent.slug);
      }
      // Navigate back to menu (pipeline state will refresh)
      onResult({ type: "stay" });
    },
    [cwd, stopPlan, onResult, handleBack],
  );

  // --- Empty state ---
  if (plans.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>No running plans to stop</Text>
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

  // --- Single plan: confirmation prompt ---
  if (plans.length === 1) {
    const plan = plans[0]!;
    const confirmItems = useMemo(() => buildConfirmItems(plan), [plan]);

    const handleConfirmSelect = useCallback(
      (value: string) => {
        handleIntent(confirmSelect(value, plan.slug));
      },
      [plan.slug, handleIntent],
    );

    return (
      <Box flexDirection="column">
        <Box paddingLeft={1} marginBottom={1}>
          <Text bold>Stop running plan?</Text>
        </Box>
        <SelectableList
          items={confirmItems}
          onSelect={handleConfirmSelect}
          onBack={handleBack}
          isActive={isActive}
          renderItem={renderItem}
        />
      </Box>
    );
  }

  // --- Multiple plans: picker ---
  const listItems = useMemo(() => buildStopItems(plans), [plans]);

  const handlePickerSelect = useCallback(
    (value: string) => {
      handleIntent(stopSelect(value));
    },
    [handleIntent],
  );

  return (
    <Box flexDirection="column">
      <Box paddingLeft={1} marginBottom={1}>
        <Text bold>Pick a running plan to stop</Text>
        <Text dimColor> ({plans.length} running)</Text>
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
