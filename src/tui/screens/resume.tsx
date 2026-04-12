/**
 * Resume stalled plan screen for the TUI.
 *
 * Shows a list of stalled plans to resume, or a confirmation prompt when
 * only one plan is stalled. Uses the `SelectableList` component.
 *
 * - Single stalled plan: Y/N confirmation with progress hint
 * - Multiple stalled plans: picker with progress hints
 * - On resume intent: produces `exit-to-runner` with
 *   `["run", "--plan=<slug>.md", "--resume"]`
 * - Esc: returns to main menu
 *
 * Pure helpers are exported for unit testing:
 * - `buildResumeItems` — maps stalled plans to ListItem[] with progress hints
 * - `resumeSelect` — maps a selected value to a ResumeIntent
 * - `buildResumeConfirmItems` — builds Y/N confirmation items for a single plan
 * - `confirmResumeSelect` — maps a confirmation value to a ResumeIntent
 */

import { useMemo, useCallback } from "react";
import { Box, Text } from "ink";

import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type { DispatchResult } from "../types.ts";
import type { InProgressPlan } from "../../plan-lifecycle.ts";

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

/** What the resume screen should do after a selection. */
export type ResumeIntent =
  | { type: "resume"; slug: string; filename: string }
  | { type: "back" };

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert stalled plans into a flat `ListItem[]` for the picker.
 *
 * Each plan shows its filename as the label, with a progress hint
 * (e.g. "3/5 tasks") when `totalTasks` is defined. Appends a "Back"
 * item with `__back__` value.
 */
export function buildResumeItems(plans: InProgressPlan[]): ListItem[] {
  const items: ListItem[] = plans.map((plan) => {
    const hint =
      plan.totalTasks !== undefined
        ? `${plan.tasksCompleted}/${plan.totalTasks} tasks`
        : undefined;

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
 * Map a selected picker value to a `ResumeIntent`.
 *
 * Returns `{ type: "resume", slug, filename }` for plan values, or
 * `{ type: "back" }` for the back sentinel. The `plans` array is used
 * to look up the filename for the selected slug.
 */
export function resumeSelect(
  value: string,
  plans: InProgressPlan[],
): ResumeIntent {
  if (value === "__back__") return { type: "back" };
  const plan = plans.find((p) => p.slug === value);
  return {
    type: "resume",
    slug: value,
    filename: plan?.filename ?? `${value}.md`,
  };
}

/**
 * Build Y/N confirmation items for resuming a single stalled plan.
 *
 * The "Yes" label includes the slug and progress information when
 * `totalTasks` is defined.
 */
export function buildResumeConfirmItems(plan: InProgressPlan): ListItem[] {
  const progressStr =
    plan.totalTasks !== undefined
      ? ` (${plan.tasksCompleted}/${plan.totalTasks} tasks)`
      : "";

  return [
    {
      value: "__confirm__",
      label: `Yes, resume '${plan.slug}'${progressStr}`,
    },
    {
      value: "__back__",
      label: "No, go back",
    },
  ];
}

/**
 * Map a confirmation value to a `ResumeIntent`.
 *
 * Returns `{ type: "resume", slug, filename }` for `__confirm__`,
 * or `{ type: "back" }` for any other value.
 */
export function confirmResumeSelect(
  value: string,
  slug: string,
  filename: string,
): ResumeIntent {
  if (value === "__confirm__") return { type: "resume", slug, filename };
  return { type: "back" };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ResumeStalledScreenProps {
  /** Stalled plans from pipeline state. */
  stalledPlans: InProgressPlan[];
  /** Called when the user selects a plan or navigates back. */
  onResult: (result: DispatchResult) => void;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Custom item renderer
// ---------------------------------------------------------------------------

function ResumeListItem({
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
// ResumeStalledScreen component
// ---------------------------------------------------------------------------

export function ResumeStalledScreen({
  stalledPlans: plans,
  onResult,
  isActive = true,
}: ResumeStalledScreenProps) {
  const handleBack = useCallback(() => {
    onResult({ type: "navigate", screen: { type: "menu" } });
  }, [onResult]);

  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <ResumeListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // --- Dispatch intent ---
  const handleIntent = useCallback(
    (intent: ResumeIntent) => {
      if (intent.type === "back") {
        handleBack();
        return;
      }
      // Produce exit-to-runner with resume args
      onResult({
        type: "exit-to-runner",
        args: ["run", `--plan=${intent.filename}`, "--resume"],
      });
    },
    [onResult, handleBack],
  );

  // --- Empty state ---
  if (plans.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>No stalled plans</Text>
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
    const confirmItems = useMemo(() => buildResumeConfirmItems(plan), [plan]);

    const handleConfirmSelect = useCallback(
      (value: string) => {
        handleIntent(confirmResumeSelect(value, plan.slug, plan.filename));
      },
      [plan.slug, plan.filename, handleIntent],
    );

    return (
      <Box flexDirection="column">
        <Box paddingLeft={1} marginBottom={1}>
          <Text bold>Resume stalled plan?</Text>
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
  const listItems = useMemo(() => buildResumeItems(plans), [plans]);

  const handlePickerSelect = useCallback(
    (value: string) => {
      handleIntent(resumeSelect(value, plans));
    },
    [handleIntent, plans],
  );

  return (
    <Box flexDirection="column">
      <Box paddingLeft={1} marginBottom={1}>
        <Text bold>Pick a stalled plan to resume</Text>
        <Text dimColor> ({plans.length} stalled)</Text>
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
