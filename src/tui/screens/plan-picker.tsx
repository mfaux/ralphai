/**
 * Plan picker screen for the TUI.
 *
 * Generic picker for selecting a plan from a list. Used by:
 * - "Pick from backlog" — select a backlog plan to run
 * - "Resume stalled plan" — select a stalled plan to resume
 * - "Reset plan" — select an in-progress plan to reset
 *
 * Renders a title and a `SelectableList` of plans. Esc goes back.
 */

import React from "react";
import { Box, Text } from "ink";
import {
  SelectableList,
  type ListItem,
} from "../components/selectable-list.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single plan entry for the picker. */
export interface PlanPickerItem {
  /** Unique identifier (slug or filename). */
  value: string;
  /** Display label. */
  label: string;
  /** Optional hint (scope, dependency info, PID, etc.). */
  hint?: string;
}

export interface PlanPickerScreenProps {
  /** Title displayed above the list (e.g., "Pick a plan to run:"). */
  title: string;
  /** Plans to display. */
  plans: PlanPickerItem[];
  /** Called when the user selects a plan. */
  onSelect: (value: string) => void;
  /** Called when the user presses Esc to go back. */
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert `PlanPickerItem[]` to `ListItem[]` for the SelectableList.
 */
export function planPickerToListItems(plans: PlanPickerItem[]): ListItem[] {
  return plans.map((plan) => ({
    value: plan.value,
    label: plan.label,
    hint: plan.hint,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlanPickerScreen({
  title,
  plans,
  onSelect,
  onBack,
}: PlanPickerScreenProps): React.ReactNode {
  const items = planPickerToListItems(plans);

  if (plans.length === 0) {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text bold>{title}</Text>
        <Box marginTop={1}>
          <Text dimColor>No plans available.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
        <SelectableList
          items={[{ value: "__back__", label: "Back" }]}
          onSelect={onBack}
          onBack={onBack}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>{title}</Text>
      <Box marginTop={1}>
        <SelectableList items={items} onSelect={onSelect} onBack={onBack} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter to select {"\u00b7"} Esc to go back</Text>
      </Box>
    </Box>
  );
}
