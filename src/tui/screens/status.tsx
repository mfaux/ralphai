/**
 * View status screen for the TUI.
 *
 * Shows a full-screen pipeline breakdown: backlog plans, in-progress
 * plans (with liveness status), and completed plans. Uses the
 * `SelectableList` component with a single "Back" item for navigation.
 *
 * - Backlog plans: filename with scope and dependency info
 * - In-progress plans: filename with liveness status, scope, task
 *   progress, and worktree info
 * - Completed plans: slug.md
 * - Esc or Enter on "Back": returns to main menu
 *
 * Pure helpers are exported for unit testing:
 * - `buildBacklogLine` — formats a backlog plan for display
 * - `buildInProgressLine` — formats an in-progress plan for display
 * - `buildCompletedLine` — formats a completed slug for display
 * - `statusSelect` — maps a selected value to a StatusIntent
 */

import { useCallback } from "react";
import { Box, Text } from "ink";

import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type { DispatchResult } from "../types.ts";
import type {
  PipelineState,
  BacklogPlan,
  InProgressPlan,
  LivenessStatus,
} from "../../pipeline-state.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusScreenProps {
  /** Full pipeline state to display. */
  state: PipelineState | null;
  /** Called when the user navigates back. */
  onResult: (result: DispatchResult) => void;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

/** What the status screen should do after a selection. */
export type StatusIntent = { type: "back" };

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Return a human-readable liveness tag string for display.
 */
export function livenessTag(liveness: LivenessStatus): string {
  switch (liveness.tag) {
    case "running":
      return `running PID ${liveness.pid}`;
    case "stalled":
      return "stalled";
    case "in_progress":
      return "in progress";
    case "outcome":
      return liveness.outcome;
  }
}

/**
 * Format a backlog plan as a display line with optional hints.
 *
 * Shows filename, scope (if present), and dependency info (if present).
 */
export function buildBacklogLine(plan: BacklogPlan): {
  label: string;
  hint: string;
} {
  const parts: string[] = [];
  if (plan.scope) parts.push(`scope: ${plan.scope}`);
  if (plan.dependsOn.length > 0)
    parts.push(`waiting on ${plan.dependsOn.join(", ")}`);

  return {
    label: plan.filename,
    hint: parts.length > 0 ? parts.join(" · ") : "",
  };
}

/**
 * Format an in-progress plan as a display line with liveness details.
 *
 * Shows filename, scope, task progress, worktree, and liveness status.
 */
export function buildInProgressLine(plan: InProgressPlan): {
  label: string;
  hint: string;
} {
  const parts: string[] = [];

  if (plan.scope) parts.push(`scope: ${plan.scope}`);

  if (plan.totalTasks !== undefined && plan.totalTasks > 0) {
    parts.push(`${plan.tasksCompleted}/${plan.totalTasks} tasks`);
  }

  if (plan.hasWorktree) {
    parts.push(`worktree: ${plan.slug}`);
  }

  parts.push(livenessTag(plan.liveness));

  return {
    label: plan.filename,
    hint: parts.join(" · "),
  };
}

/**
 * Format a completed slug as a display line.
 */
export function buildCompletedLine(slug: string): {
  label: string;
  hint: string;
} {
  return {
    label: `${slug}.md`,
    hint: "",
  };
}

/**
 * Map a selected value to a `StatusIntent`.
 *
 * The status screen only has a "Back" item, so any selection returns back.
 */
export function statusSelect(_value: string): StatusIntent {
  return { type: "back" };
}

// ---------------------------------------------------------------------------
// Section component — renders a labeled section with plan lines
// ---------------------------------------------------------------------------

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children?: React.ReactNode;
}) {
  const plural = count !== 1 ? "s" : "";

  return (
    <Box flexDirection="column">
      <Box paddingLeft={1}>
        <Text bold>{title}</Text>
        <Text dimColor>
          {" "}
          {count} plan{plural}
        </Text>
      </Box>
      {children}
    </Box>
  );
}

function PlanLine({ label, hint }: { label: string; hint: string }) {
  return (
    <Box paddingLeft={3}>
      <Text dimColor>{label}</Text>
      {hint ? <Text dimColor>{"  " + hint}</Text> : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Custom item renderer for the Back button
// ---------------------------------------------------------------------------

function StatusListItem({
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
    </Box>
  );
}

// ---------------------------------------------------------------------------
// StatusScreen component
// ---------------------------------------------------------------------------

export function StatusScreen({
  state,
  onResult,
  isActive = true,
}: StatusScreenProps) {
  const handleBack = useCallback(() => {
    onResult({ type: "navigate", screen: { type: "menu" } });
  }, [onResult]);

  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <StatusListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // --- Loading / empty state ---
  if (!state) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>Loading pipeline status...</Text>
        <Box marginTop={1}>
          <SelectableList
            items={[{ value: "__back__", label: "Back" }]}
            onSelect={handleBack}
            onBack={handleBack}
            isActive={isActive}
            renderItem={renderItem}
          />
        </Box>
      </Box>
    );
  }

  // --- Full pipeline breakdown ---
  const { backlog, inProgress, completedSlugs } = state;

  return (
    <Box flexDirection="column">
      <Box paddingLeft={1} marginBottom={1}>
        <Text bold>Pipeline Status</Text>
      </Box>

      {/* Backlog section */}
      <Section title="Backlog" count={backlog.length}>
        {backlog.map((plan) => {
          const line = buildBacklogLine(plan);
          return (
            <PlanLine key={plan.filename} label={line.label} hint={line.hint} />
          );
        })}
      </Section>

      <Box marginTop={1} />

      {/* In Progress section */}
      <Section title="In Progress" count={inProgress.length}>
        {inProgress.map((plan) => {
          const line = buildInProgressLine(plan);
          return (
            <PlanLine key={plan.slug} label={line.label} hint={line.hint} />
          );
        })}
      </Section>

      <Box marginTop={1} />

      {/* Completed section */}
      <Section title="Completed" count={completedSlugs.length}>
        {completedSlugs.map((slug) => {
          const line = buildCompletedLine(slug);
          return <PlanLine key={slug} label={line.label} hint={line.hint} />;
        })}
      </Section>

      {/* Back button */}
      <Box marginTop={1}>
        <SelectableList
          items={[{ value: "__back__", label: "Back" }]}
          onSelect={handleBack}
          onBack={handleBack}
          isActive={isActive}
          renderItem={renderItem}
        />
      </Box>
    </Box>
  );
}
