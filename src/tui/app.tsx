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
// Terminal safety
// ---------------------------------------------------------------------------

/** ANSI escape to make the cursor visible again. */
const SHOW_CURSOR = "\x1b[?25h";

/**
 * Restore terminal state after the TUI exits or crashes.
 *
 * - Disables raw mode on stdin (so typed characters echo normally)
 * - Shows the cursor (Ink hides it while rendering)
 *
 * Safe to call multiple times — guards against missing TTY or
 * already-restored state.
 */
export function restoreTerminal(): void {
  try {
    if (
      process.stdin.isTTY &&
      process.stdin.isRaw &&
      typeof process.stdin.setRawMode === "function"
    ) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // stdin may already be destroyed — ignore
  }

  try {
    process.stdout.write(SHOW_CURSOR);
  } catch {
    // stdout may already be closed — ignore
  }
}

/**
 * Install process-level safety handlers that restore the terminal if
 * the TUI is killed or crashes. Returns a cleanup function that
 * removes the handlers (call after the TUI exits normally).
 *
 * Handles:
 * - SIGINT  — Ctrl+C from another terminal or `kill -INT`
 * - SIGTERM — default `kill` signal
 * - uncaughtException  — unhandled throw
 * - unhandledRejection — unhandled promise rejection
 *
 * Ink already handles interactive Ctrl+C (via stdin raw-mode input
 * parsing), but external signals bypass Ink's React cleanup. These
 * supplementary handlers ensure the terminal is never left in raw mode
 * with a hidden cursor.
 */
export function installTerminalSafetyHandlers(): () => void {
  const handleSignal = (signal: string) => {
    restoreTerminal();
    // Re-raise with default behavior so the process exits with the
    // correct signal code (128 + signal number).
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");

  const handleException = (err: unknown) => {
    restoreTerminal();
    // Print the error after restoring the terminal so it's readable
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  };

  const handleRejection = (reason: unknown) => {
    restoreTerminal();
    console.error(
      "Unhandled rejection:",
      reason instanceof Error ? (reason.stack ?? reason.message) : reason,
    );
    process.exit(1);
  };

  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);
  process.on("uncaughtException", handleException);
  process.on("unhandledRejection", handleRejection);

  return () => {
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
    process.removeListener("uncaughtException", handleException);
    process.removeListener("unhandledRejection", handleRejection);
  };
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
 * Terminal safety handlers (SIGINT, SIGTERM, uncaughtException,
 * unhandledRejection) are installed for the duration of the TUI
 * session and removed once it exits normally. This ensures the
 * terminal is always restored even if the process is killed.
 *
 * @returns The TUI result describing what the CLI should do next.
 */
export async function renderTui(node: React.ReactNode): Promise<TuiResult> {
  const removeSafetyHandlers = installTerminalSafetyHandlers();

  const instance = render(node);

  try {
    const result = await instance.waitUntilExit();
    return (result as TuiResult) ?? { action: "quit" };
  } catch {
    // Ctrl+C or unexpected error — treat as quit
    return { action: "quit" };
  } finally {
    // Remove safety handlers so they don't interfere with post-TUI
    // code (e.g. the runner streaming agent output).
    removeSafetyHandlers();
    // Belt-and-suspenders: ensure terminal is restored even if Ink's
    // React cleanup didn't run (e.g. render threw synchronously).
    restoreTerminal();
  }
}
