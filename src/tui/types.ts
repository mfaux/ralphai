/**
 * TUI type definitions — discriminated unions for actions and screens.
 *
 * The `Action` union represents every user intent that can originate from
 * the main menu (via Enter key or hotkey). The `Screen` union represents
 * the set of screens the TUI can display. Together they form the core
 * of the screen-router state machine in `app.tsx`.
 *
 * Also provides `RunConfig` and the pure helpers that wire every run
 * path through the confirmation screen:
 * - `buildConfirmDataFromArgs` — builds `ConfirmData` from CLI args + config
 * - `toConfirmNav` — wraps an `exit-to-runner` result as a navigate-to-confirm
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
    // "run-next" is intentionally kept as exit-to-runner here.
    // The App component wraps this through the confirm screen via
    // `toConfirmNav()` at dispatch time.
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

// ---------------------------------------------------------------------------
// Run config — config fields needed by the confirmation screen
// ---------------------------------------------------------------------------

/**
 * Subset of resolved configuration needed to build the confirmation
 * screen's display data. Passed through `AppProps` so the App can
 * construct `ConfirmData` when intercepting `exit-to-runner` results
 * from pickers and menu actions.
 */
export interface RunConfig {
  /** Agent command (e.g. "claude-code", "aider"). */
  agentCommand: string;
  /** Feedback commands (e.g. "bun run build && bun test"). */
  feedbackCommands: string;
}

// ---------------------------------------------------------------------------
// Confirm-screen wiring helpers
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable title from CLI run args.
 *
 * - `["run"]` → "Auto-detect (next plan)"
 * - `["run", "42"]` → "Issue #42"
 * - `["run", "--plan", "feat-login.md"]` → "feat-login.md"
 *
 * Falls back to joining the args for unexpected shapes.
 */
export function titleFromRunArgs(args: string[]): string {
  // Strip leading "run" if present
  const rest = args[0] === "run" ? args.slice(1) : args;

  if (rest.length === 0) return "Auto-detect (next plan)";

  // --plan <filename>
  const planIdx = rest.indexOf("--plan");
  if (planIdx !== -1 && planIdx + 1 < rest.length) {
    return rest[planIdx + 1]!;
  }

  // Bare number → issue
  if (rest.length === 1 && /^\d+$/.test(rest[0]!)) {
    return `Issue #${rest[0]}`;
  }

  return rest.join(" ");
}

/**
 * Derive a branch name from CLI run args.
 *
 * This is a best-effort heuristic — the real branch name is computed
 * by the runner. Shows "(auto)" when no specific target is given.
 *
 * - `["run"]` → "(auto)"
 * - `["run", "42"]` → "(auto)"
 * - `["run", "--plan", "feat-login.md"]` → "(auto)"
 */
export function branchFromRunArgs(_args: string[]): string {
  return "(auto)";
}

/**
 * Build `ConfirmData` from CLI run args and the run configuration.
 *
 * Pure function — exported for testing.
 */
export function buildConfirmDataFromArgs(
  args: string[],
  config: RunConfig,
): ConfirmData {
  return {
    title: titleFromRunArgs(args),
    agentCommand: config.agentCommand,
    branch: branchFromRunArgs(args),
    feedbackCommands: config.feedbackCommands,
    runArgs: args,
  };
}

/**
 * Convert an `exit-to-runner` dispatch result into a navigate-to-confirm
 * dispatch result.
 *
 * Used by the `App` component to intercept run results from pickers and
 * menu actions and route them through the confirmation screen. The
 * `backScreen` is set so Esc returns to the screen that produced the
 * result.
 *
 * Returns the original result unchanged if it is not `exit-to-runner`.
 */
export function toConfirmNav(
  result: DispatchResult,
  config: RunConfig,
  backScreen: Screen,
): DispatchResult {
  if (result.type !== "exit-to-runner") return result;

  return {
    type: "navigate",
    screen: {
      type: "confirm",
      data: buildConfirmDataFromArgs(result.args, config),
      backScreen,
    },
  };
}
