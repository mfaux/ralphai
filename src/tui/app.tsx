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
 * - Confirm screen → TUI exit (with run args) | back | options wizard
 * - Options wizard → TUI exit (with run args) | cancel → previous screen
 * - Doctor / Clean / Stop → back to main menu
 *
 * Screen routing uses a tagged union (`Screen`) with a `TuiRouter`
 * component that wires screen callbacks to state transitions. The
 * `useExitTui()` hook bridges Ink's exit mechanism to the `TuiResult`
 * type that the CLI layer consumes.
 */

import React, { useState, useCallback } from "react";
import { render, useApp } from "ink";

import type { ResolvedConfig } from "../config.ts";
import { ConfirmScreen, type ConfirmScreenData } from "./screens/confirm.tsx";
import { WizardScreen, type TargetChoice } from "./screens/wizard.tsx";
import { DoctorScreen } from "./screens/doctor.tsx";
import { CleanScreen } from "./screens/clean.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome of the TUI session — what the CLI should do after unmount. */
export type TuiResult =
  | { action: "run"; args: string[] }
  | { action: "options"; args: string[] }
  | { action: "quit" };

/**
 * Screen routing state.
 *
 * Each variant corresponds to a TUI screen. The `previousScreen` field
 * (where present) enables Esc/cancel to return to the originating screen.
 */
export type Screen =
  | { tag: "confirm"; data: ConfirmScreenData }
  | {
      tag: "wizard";
      config: ResolvedConfig;
      preSelectedTarget?: TargetChoice;
      targetChoices?: TargetChoice[];
      previousScreen?: Screen;
    }
  | { tag: "doctor"; cwd: string }
  | { tag: "clean"; cwd: string }
  | { tag: "quit" };

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build a `TargetChoice` from confirm-screen run args.
 *
 * The confirm screen passes `data.runArgs` (e.g. `["run", "42"]`) when
 * the user presses `o`. This helper wraps them into a `TargetChoice`
 * so the wizard can skip the target-selection step.
 */
export function targetChoiceFromRunArgs(runArgs: string[]): TargetChoice {
  // Use the non-"run" args as the target args (e.g. ["42"])
  const targetArgs = runArgs.filter((arg) => arg !== "run");
  return {
    label: targetArgs.length > 0 ? targetArgs.join(" ") : "auto-detect",
    args: targetArgs,
  };
}

/**
 * Derive the initial screen from a `Screen` definition.
 *
 * Used by `TuiRouter` on mount. Exported for testing.
 */
export function initialScreenFrom(screen: Screen): Screen {
  return screen;
}

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
// Router component
// ---------------------------------------------------------------------------

export interface TuiRouterProps {
  /** Initial screen to display. */
  initialScreen: Screen;
  /** Resolved config (needed for the wizard). */
  config: ResolvedConfig;
}

/**
 * Screen router for the TUI.
 *
 * Manages transitions between screens by holding a `Screen` state and
 * wiring each screen's callbacks to state updates or TUI exit.
 *
 * Key transitions:
 * - Confirm `Enter` → exit TUI with `{ action: "run", args }`
 * - Confirm `o`     → wizard screen (pre-selected target from confirm args)
 * - Wizard done     → exit TUI with `{ action: "run", args }`
 * - Wizard cancel   → return to previous screen (or quit)
 * - Doctor / Clean  → back = quit (until main menu exists)
 */
export function TuiRouter({
  initialScreen,
  config,
}: TuiRouterProps): React.ReactNode {
  const exitTui = useExitTui();
  const [screen, setScreen] = useState<Screen>(initialScreen);

  // --- Confirm screen callbacks ---

  const handleConfirm = useCallback(
    (args: string[]) => {
      exitTui({ action: "run", args });
    },
    [exitTui],
  );

  const handleConfirmBack = useCallback(() => {
    exitTui({ action: "quit" });
  }, [exitTui]);

  const handleConfirmOptions = useCallback(
    (args: string[]) => {
      const target = targetChoiceFromRunArgs(args);
      setScreen((prev) => ({
        tag: "wizard",
        config,
        preSelectedTarget: target,
        previousScreen: prev,
      }));
    },
    [config],
  );

  // --- Wizard screen callbacks ---

  const handleWizardDone = useCallback(
    (flags: string[]) => {
      exitTui({ action: "run", args: ["run", ...flags] });
    },
    [exitTui],
  );

  const handleWizardCancel = useCallback(() => {
    if (screen.tag === "wizard" && screen.previousScreen) {
      setScreen(screen.previousScreen);
    } else {
      exitTui({ action: "quit" });
    }
  }, [screen, exitTui]);

  // --- Doctor / Clean callbacks ---

  const handleToolBack = useCallback(() => {
    exitTui({ action: "quit" });
  }, [exitTui]);

  // --- Render ---

  switch (screen.tag) {
    case "confirm":
      return (
        <ConfirmScreen
          data={screen.data}
          onConfirm={handleConfirm}
          onBack={handleConfirmBack}
          onOptions={handleConfirmOptions}
        />
      );

    case "wizard":
      return (
        <WizardScreen
          config={screen.config ?? config}
          preSelectedTarget={screen.preSelectedTarget}
          targetChoices={screen.targetChoices}
          onDone={handleWizardDone}
          onCancel={handleWizardCancel}
        />
      );

    case "doctor":
      return <DoctorScreen cwd={screen.cwd} onBack={handleToolBack} />;

    case "clean":
      return <CleanScreen cwd={screen.cwd} onBack={handleToolBack} />;

    case "quit":
      // Shouldn't render, but just in case
      exitTui({ action: "quit" });
      return null;
  }
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
