/**
 * Backlog plan picker screen for the TUI.
 *
 * Full-screen list of backlog plans using the `SelectableList` component.
 * Plans with all dependencies satisfied are selectable; plans with unmet
 * dependencies appear dimmed with dependency hints and are non-selectable.
 *
 * Data source: `PipelineState.backlog` (already gathered by the pipeline
 * state hook — no async fetching needed).
 *
 * Pure helpers are exported for unit testing:
 * - `buildBacklogPickerItems` — maps backlog plans to ListItem[] with
 *   scope/dependency hints and disabled state for unmet deps
 * - `backlogPickerSelect` — maps a selected value to a DispatchResult
 */

import { useMemo, useCallback } from "react";
import { Box, Text } from "ink";

import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type { DispatchResult } from "../types.ts";
import type { BacklogPlan } from "../../plan-lifecycle.ts";
import { unmetDependencies } from "../../interactive/run-actions.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BacklogPickerScreenProps {
  /** Backlog plans from pipeline state. */
  backlog: BacklogPlan[];
  /** Slugs of completed plans (used to check dependency satisfaction). */
  completedSlugs: string[];
  /** Called when the user selects a plan or navigates back. */
  onResult: (result: DispatchResult) => void;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert backlog plans into a flat `ListItem[]` for the `SelectableList`.
 *
 * Each plan becomes one item. Plans with unmet dependencies are marked
 * `disabled: true` and get a hint showing which deps are still pending.
 * Plans with all dependencies satisfied are selectable and show scope
 * info as a hint.
 */
export function buildBacklogPickerItems(
  backlog: BacklogPlan[],
  completedSlugs: string[],
): ListItem[] {
  return backlog.map((plan) => {
    const unmet = unmetDependencies(plan, completedSlugs);
    const parts: string[] = [];

    if (plan.scope) {
      parts.push(`scope: ${plan.scope}`);
    }

    if (unmet.length > 0) {
      const depNames = unmet.map((d) => d.replace(/\.md$/, "")).join(", ");
      parts.push(`waiting on ${depNames}`);
    }

    return {
      value: plan.filename,
      label: plan.filename,
      hint: parts.length > 0 ? parts.join(" \u00b7 ") : undefined,
      disabled: unmet.length > 0,
    };
  });
}

/**
 * Map a selected backlog picker value to a `DispatchResult`.
 *
 * Returns `exit-to-runner` with `["run", "--plan", filename]` for valid
 * plan filenames. Returns `null` for the back sentinel or unexpected
 * values.
 */
export function backlogPickerSelect(value: string): DispatchResult | null {
  if (value === "__back__") return null;
  if (!value) return null;

  return { type: "exit-to-runner", args: ["run", "--plan", value] };
}

// ---------------------------------------------------------------------------
// Custom item renderer
// ---------------------------------------------------------------------------

function BacklogListItem({
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
// BacklogPickerScreen component
// ---------------------------------------------------------------------------

export function BacklogPickerScreen({
  backlog,
  completedSlugs,
  onResult,
  isActive = true,
}: BacklogPickerScreenProps) {
  const handleBack = useCallback(() => {
    onResult({ type: "navigate", screen: { type: "menu" } });
  }, [onResult]);

  const listItems = useMemo(
    () => buildBacklogPickerItems(backlog, completedSlugs),
    [backlog, completedSlugs],
  );

  const handleSelect = useCallback(
    (value: string) => {
      const result = backlogPickerSelect(value);
      if (result) onResult(result);
    },
    [onResult],
  );

  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <BacklogListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // --- Empty state ---
  if (backlog.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>No plans in the backlog</Text>
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

  // --- Success state: plan list ---
  return (
    <Box flexDirection="column">
      <Box paddingLeft={1} marginBottom={1}>
        <Text bold>Pick a backlog plan to run</Text>
        <Text dimColor>
          {" "}
          ({backlog.length} plan{backlog.length === 1 ? "" : "s"})
        </Text>
      </Box>
      <SelectableList
        items={listItems}
        onSelect={handleSelect}
        onBack={handleBack}
        isActive={isActive}
        renderItem={renderItem}
      />
    </Box>
  );
}
