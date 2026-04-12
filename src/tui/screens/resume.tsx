/**
 * Resume stalled plan screen helpers for the TUI.
 *
 * Pure helpers that build list items and map selections to typed intents
 * for the resume-stalled screen. No React rendering — that will be
 * composed separately by the screen component.
 *
 * Exported helpers:
 * - `buildResumeItems` — maps stalled plans to ListItem[] with progress hints
 * - `resumeSelect` — maps a selected value to a ResumeIntent
 * - `buildResumeConfirmItems` — builds Y/N confirmation items for a single plan
 * - `confirmResumeSelect` — maps a confirmation value to a ResumeIntent
 */

import type { ListItem } from "../components/selectable-list.tsx";
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
