/**
 * TUI application root — screen router.
 *
 * `App` manages which screen is visible, dispatches actions from the
 * `MenuScreen`, and handles transitions (exit, navigate, launch runner).
 *
 * The component accepts pipeline state and context as props so that the
 * caller (the CLI entry point) owns data fetching. This keeps `App`
 * deterministic and testable.
 */

import { useState, useCallback } from "react";
import { useApp } from "ink";

import type { PipelineState } from "../pipeline-state.ts";
import type { MenuContext } from "./menu-items.ts";
import type { Screen, ActionType, DispatchResult } from "./types.ts";
import { isActionType, resolveAction } from "./types.ts";
import { MenuScreen } from "./screens/menu.tsx";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AppProps {
  /** Current pipeline state (owned by the caller). */
  state: PipelineState;
  /** Extra context for menu item construction. */
  menuContext?: MenuContext;
  /**
   * Called when the TUI wants to hand off to the agent runner.
   * The caller should exit Ink and run the given CLI args.
   */
  onExitToRunner?: (args: string[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Determine the next screen and side-effect from a raw action string.
 *
 * Returns `null` if the action string is not a recognized `ActionType`,
 * allowing the caller to ignore unknown values gracefully.
 */
export function handleAction(action: string): DispatchResult | null {
  if (!isActionType(action)) return null;
  return resolveAction(action);
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export function App({ state, menuContext, onExitToRunner }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ type: "menu" });

  const handleMenuAction = useCallback(
    (action: string) => {
      const result = handleAction(action);
      if (!result) return; // unknown action — ignore

      switch (result.type) {
        case "stay":
          // Remain on the current screen. The menu will re-render with
          // fresh state when the caller provides updated props.
          break;

        case "exit":
          exit();
          break;

        case "navigate":
          setScreen(result.screen);
          break;

        case "exit-to-runner":
          if (onExitToRunner) {
            onExitToRunner(result.args);
          } else {
            // If no runner callback, just exit cleanly.
            exit();
          }
          break;
      }
    },
    [exit, onExitToRunner],
  );

  // -----------------------------------------------------------------------
  // Screen router
  // -----------------------------------------------------------------------

  switch (screen.type) {
    case "menu":
      return (
        <MenuScreen
          state={state}
          menuContext={menuContext}
          onAction={handleMenuAction}
          isActive={true}
        />
      );
  }
}
