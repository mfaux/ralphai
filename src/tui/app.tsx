/**
 * TUI application root.
 *
 * Manages screen routing and the TUI lifecycle. When a "run" action is
 * confirmed, the Ink app unmounts and returns the run args to the CLI
 * layer so agent output streams cleanly in the terminal.
 *
 * Screen flow:
 * - Main menu (not yet implemented — will be in a later slice)
 * - Issue picker → confirm screen
 * - Backlog picker → confirm screen (not yet implemented)
 * - Confirm screen → TUI exit (with run args) | back | options
 *
 * The exit mechanism uses Ink's `useApp().exit(result)` which resolves
 * `waitUntilExit()` in `renderTui()`. The `TuiResult` type describes
 * what the TUI resolved to.
 */

import React from "react";
import { render, useApp } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome of the TUI session — what the CLI should do after unmount. */
export type TuiResult =
  | { action: "run"; args: string[] }
  | { action: "options"; args: string[] }
  | { action: "quit" };

// ---------------------------------------------------------------------------
// Exit hook
// ---------------------------------------------------------------------------

/**
 * Hook that provides a typed `exitTui` function.
 *
 * Wraps Ink's `useApp().exit()` to pass a `TuiResult` that the
 * `renderTui()` caller receives via `waitUntilExit()`.
 */
export function useExitTui(): (result: TuiResult) => void {
  const { exit } = useApp();
  return React.useCallback(
    (result: TuiResult) => {
      exit(result);
    },
    [exit],
  );
}

// ---------------------------------------------------------------------------
// TUI launcher
// ---------------------------------------------------------------------------

/**
 * Render the TUI application and wait for it to resolve.
 *
 * Mounts the provided React node as an Ink application. When any
 * component calls `useExitTui()` and invokes the returned function,
 * the app unmounts and `renderTui()` resolves with the `TuiResult`.
 *
 * If the user presses Ctrl+C, the app exits with a "quit" result.
 *
 * @returns The TUI result describing what the CLI should do next.
 */
export async function renderTui(node: React.ReactNode): Promise<TuiResult> {
  const instance = render(node);

  try {
    const result = await instance.waitUntilExit();
    return (result as TuiResult) ?? { action: "quit" };
  } catch {
    // Ctrl+C or unexpected error — treat as quit
    return { action: "quit" };
  }
}
