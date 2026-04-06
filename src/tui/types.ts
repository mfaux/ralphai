/**
 * TUI type definitions — discriminated unions for actions and screens.
 *
 * The `Action` union represents every user intent that can originate from
 * the main menu (via Enter key or hotkey). The `Screen` union represents
 * the set of screens the TUI can display. Together they form the core
 * of the screen-router state machine in `app.tsx`.
 */

import type { ConfirmData } from "./screens/confirm.tsx";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * All possible action values that a menu item can produce.
 *
 * This must stay in sync with the `value` fields returned by
 * `buildMenuItems()` in `menu-items.ts`.
 */
export type ActionType =
  | "resume-stalled"
  | "run-next"
  | "pick-from-backlog"
  | "pick-from-github"
  | "run-with-options"
  | "stop-running"
  | "reset-plan"
  | "view-status"
  | "doctor"
  | "clean"
  | "settings"
  | "quit";

/**
 * All known action type values as a readonly set, useful for runtime
 * validation (e.g. narrowing a `string` to `ActionType`).
 */
export const ACTION_TYPES: ReadonlySet<string> = new Set<ActionType>([
  "resume-stalled",
  "run-next",
  "pick-from-backlog",
  "pick-from-github",
  "run-with-options",
  "stop-running",
  "reset-plan",
  "view-status",
  "doctor",
  "clean",
  "settings",
  "quit",
]);

/**
 * Type guard: is the given string a known `ActionType`?
 */
export function isActionType(value: string): value is ActionType {
  return ACTION_TYPES.has(value);
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * Discriminated union of screens the TUI can display.
 *
 * Each variant represents a distinct full-screen view. The `App`
 * component uses a `switch` on `screen.type` to render the correct
 * component.
 */
export type Screen =
  | { type: "menu" }
  | { type: "issue-picker" }
  | { type: "backlog-picker" }
  | { type: "confirm"; data: ConfirmData; backScreen?: Screen }
  | { type: "options"; data: ConfirmData; backScreen?: Screen };

// ---------------------------------------------------------------------------
// Dispatch result
// ---------------------------------------------------------------------------

/**
 * Describes what the app should do after processing an action.
 *
 * - `"stay"`: remain on the current screen (re-render with fresh state).
 * - `"exit"`: exit the TUI cleanly.
 * - `"navigate"`: transition to a different screen.
 * - `"exit-to-runner"`: exit the TUI and hand off to the agent runner
 *    with the given CLI arguments.
 */
export type DispatchResult =
  | { type: "stay" }
  | { type: "exit" }
  | { type: "navigate"; screen: Screen }
  | { type: "exit-to-runner"; args: string[] };

/**
 * Map an `ActionType` to a `DispatchResult`.
 *
 * This is a pure function that determines the routing outcome for each
 * action. Actions that require sub-screens or the agent runner will
 * evolve as those screens are built — for now, actions that would
 * normally show a sub-menu return `"stay"` (the sub-screen is not yet
 * implemented), and actions that launch the runner return
 * `"exit-to-runner"`.
 */
export function resolveAction(action: ActionType): DispatchResult {
  switch (action) {
    // --- Actions that exit the TUI and launch the runner ---
    case "run-next":
      return { type: "exit-to-runner", args: ["run"] };

    // --- Actions that exit the TUI ---
    case "quit":
      return { type: "exit" };

    // --- Actions that navigate to picker sub-screens ---
    case "pick-from-backlog":
      return { type: "navigate", screen: { type: "backlog-picker" } };
    case "pick-from-github":
      return { type: "navigate", screen: { type: "issue-picker" } };

    // --- Actions that will navigate to sub-screens (stubbed as "stay") ---
    // These will be updated to `{ type: "navigate", screen: ... }` as
    // their respective screens are implemented.
    case "resume-stalled":
    case "run-with-options":
    case "stop-running":
    case "reset-plan":
    case "view-status":
    case "doctor":
    case "clean":
    case "settings":
      return { type: "stay" };
  }
}
