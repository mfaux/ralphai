/**
 * TUI application root.
 *
 * Manages screen routing and the TUI lifecycle. When a "run" action is
 * confirmed, the Ink app unmounts and returns the run args to the CLI
 * layer so agent output streams cleanly in the terminal.
 *
 * Screen flow:
 * - Main menu → sub-screens or TUI exit
 * - Issue picker → TUI exit (with run args) | back to menu
 * - Plan picker → TUI exit (with run args) | reset + back | back to menu
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
import type { PipelineState } from "../pipeline-state.ts";
import {
  stalledPlans,
  resettablePlans,
} from "../interactive/pipeline-actions.ts";
import {
  unmetDependencies,
  findNextPlanName,
} from "../interactive/run-actions.ts";
import { resetPlanBySlug } from "../ralphai.ts";
import { ConfirmScreen, type ConfirmScreenData } from "./screens/confirm.tsx";
import { WizardScreen, type TargetChoice } from "./screens/wizard.tsx";
import { DoctorScreen } from "./screens/doctor.tsx";
import { CleanScreen } from "./screens/clean.tsx";
import { StopScreen } from "./screens/stop.tsx";
import { IssuePicker } from "./screens/issue-picker.tsx";
import { MainMenuScreen } from "./screens/main-menu.tsx";
import {
  PlanPickerScreen,
  type PlanPickerItem,
} from "./screens/plan-picker.tsx";
import type { MenuContext } from "./menu-items.ts";
import type { ListGithubIssuesOptions } from "../interactive/github-issues.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome of the TUI session — what the CLI should do after unmount. */
export type TuiResult =
  | { action: "run"; args: string[] }
  | { action: "dispatch"; args: string[] }
  | { action: "quit" };

/**
 * Plan picker mode — determines what happens when a plan is selected.
 *
 * - "run": exit TUI with `["run", "--plan", file]`
 * - "resume": exit TUI with `["run", "--plan", slug.md, "--resume"]`
 * - "reset": call `resetPlanBySlug()` and return to menu
 */
export type PlanPickerMode = "run" | "resume" | "reset";

/**
 * Screen routing state.
 *
 * Each variant corresponds to a TUI screen. The `previousScreen` field
 * (where present) enables Esc/cancel to return to the originating screen.
 */
export type Screen =
  | { tag: "menu"; cwd: string; menuContext: MenuContext }
  | { tag: "confirm"; data: ConfirmScreenData }
  | {
      tag: "wizard";
      config: ResolvedConfig;
      preSelectedTarget?: TargetChoice;
      targetChoices?: TargetChoice[];
      previousScreen?: Screen;
    }
  | {
      tag: "plan-picker";
      title: string;
      plans: PlanPickerItem[];
      mode: PlanPickerMode;
      cwd: string;
      menuContext: MenuContext;
    }
  | {
      tag: "issue-picker";
      listOptions: ListGithubIssuesOptions;
      cwd: string;
      menuContext: MenuContext;
    }
  | { tag: "stop"; state: PipelineState; cwd: string; menuContext: MenuContext }
  | { tag: "doctor"; cwd: string; menuContext: MenuContext }
  | { tag: "clean"; cwd: string; menuContext: MenuContext }
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

/**
 * Build `PlanPickerItem[]` from backlog plans in pipeline state.
 */
export function backlogPickerItems(state: PipelineState): PlanPickerItem[] {
  return state.backlog.map((plan) => {
    const parts: string[] = [];
    if (plan.scope) parts.push(`scope: ${plan.scope}`);
    const unmet = unmetDependencies(plan, state.completedSlugs);
    if (unmet.length > 0) {
      const depNames = unmet.map((d) => d.replace(/\.md$/, "")).join(", ");
      parts.push(`waiting on ${depNames}`);
    }
    return {
      value: plan.filename,
      label: plan.filename,
      hint: parts.length > 0 ? parts.join(" \u00b7 ") : undefined,
    };
  });
}

/**
 * Build `PlanPickerItem[]` from stalled plans in pipeline state.
 */
export function stalledPickerItems(state: PipelineState): PlanPickerItem[] {
  return stalledPlans(state).map((plan) => ({
    value: plan.slug,
    label: plan.filename,
    hint: plan.scope ? `scope: ${plan.scope}` : undefined,
  }));
}

/**
 * Build `PlanPickerItem[]` from resettable plans in pipeline state.
 */
export function resetPickerItems(state: PipelineState): PlanPickerItem[] {
  return resettablePlans(state).map((plan) => {
    const parts: string[] = [];
    if (plan.scope) parts.push(`scope: ${plan.scope}`);
    if (plan.liveness.tag === "stalled") parts.push("stalled");
    if (plan.liveness.tag === "running") parts.push("running");
    if (plan.liveness.tag === "in_progress") parts.push("in progress");
    return {
      value: plan.slug,
      label: plan.filename,
      hint: parts.length > 0 ? parts.join(" \u00b7 ") : undefined,
    };
  });
}

/**
 * Build `TargetChoice[]` for the wizard's target step.
 *
 * Offers: auto-detect, backlog plans (if any), and GitHub issues (if configured).
 */
export function buildWizardTargetChoices(
  state: PipelineState,
  ctx: MenuContext,
): TargetChoice[] {
  const choices: TargetChoice[] = [];

  const nextPlan = findNextPlanName(state);
  choices.push({
    label: nextPlan ? `Auto-detect (${nextPlan})` : "Auto-detect (next plan)",
    args: [],
  });

  for (const plan of state.backlog) {
    choices.push({
      label: plan.filename,
      args: ["--plan", plan.filename],
    });
  }

  if (ctx.hasGitHubIssues) {
    choices.push({
      label: "Pull from GitHub",
      args: [], // wizard doesn't support github target yet — treated as auto-detect
    });
  }

  return choices;
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
 * - Menu item select → screen transition or TUI exit
 * - Confirm `Enter` → exit TUI with `{ action: "run", args }`
 * - Confirm `o`     → wizard screen (pre-selected target from confirm args)
 * - Wizard done     → exit TUI with `{ action: "run", args }`
 * - Wizard cancel   → return to previous screen (or menu)
 * - Plan picker     → exit TUI or reset + back to menu
 * - Issue picker    → exit TUI with run args
 * - Doctor / Clean / Stop → back to main menu
 */
export function TuiRouter({
  initialScreen,
  config,
}: TuiRouterProps): React.ReactNode {
  const exitTui = useExitTui();
  const [screen, setScreen] = useState<Screen>(initialScreen);

  // Helper to build a menu screen from current screen's context
  const menuScreenFrom = useCallback((s: Screen): Screen => {
    // Extract cwd and menuContext from the current screen
    const cwd = "cwd" in s ? (s.cwd as string) : "";
    const menuContext: MenuContext =
      "menuContext" in s
        ? (s.menuContext as MenuContext)
        : { hasGitHubIssues: false };
    return { tag: "menu", cwd, menuContext };
  }, []);

  // --- Main menu callbacks ---

  const handleMenuSelect = useCallback(
    (value: string, state: PipelineState) => {
      if (screen.tag !== "menu") return;
      const { cwd, menuContext } = screen;

      switch (value) {
        case "run-next":
          exitTui({ action: "run", args: ["run"] });
          break;

        case "pick-from-backlog": {
          const plans = backlogPickerItems(state);
          setScreen({
            tag: "plan-picker",
            title: "Pick a plan to run:",
            plans,
            mode: "run",
            cwd,
            menuContext,
          });
          break;
        }

        case "pick-from-github": {
          if (menuContext.githubConfig) {
            setScreen({
              tag: "issue-picker",
              listOptions: menuContext.githubConfig,
              cwd,
              menuContext,
            });
          }
          break;
        }

        case "run-with-options": {
          const targetChoices = buildWizardTargetChoices(state, menuContext);
          setScreen({
            tag: "wizard",
            config,
            targetChoices,
            previousScreen: screen,
          });
          break;
        }

        case "resume-stalled": {
          const stalled = stalledPlans(state);
          if (stalled.length === 1) {
            const slug = stalled[0]!.slug;
            exitTui({
              action: "run",
              args: ["run", "--plan", `${slug}.md`, "--resume"],
            });
          } else if (stalled.length > 1) {
            const plans = stalledPickerItems(state);
            setScreen({
              tag: "plan-picker",
              title: "Pick a stalled plan to resume:",
              plans,
              mode: "resume",
              cwd,
              menuContext,
            });
          }
          break;
        }

        case "stop-running":
          setScreen({
            tag: "stop",
            state,
            cwd,
            menuContext,
          });
          break;

        case "reset-plan": {
          const plans = resetPickerItems(state);
          setScreen({
            tag: "plan-picker",
            title: "Pick a plan to reset:",
            plans,
            mode: "reset",
            cwd,
            menuContext,
          });
          break;
        }

        case "view-status":
          exitTui({ action: "dispatch", args: ["status"] });
          break;

        case "doctor":
          setScreen({ tag: "doctor", cwd, menuContext });
          break;

        case "clean":
          setScreen({ tag: "clean", cwd, menuContext });
          break;

        case "settings":
          exitTui({ action: "dispatch", args: ["config"] });
          break;

        case "quit":
          exitTui({ action: "quit" });
          break;
      }
    },
    [screen, config, exitTui],
  );

  // --- Confirm screen callbacks ---

  const handleConfirm = useCallback(
    (args: string[]) => {
      exitTui({ action: "run", args });
    },
    [exitTui],
  );

  const handleConfirmBack = useCallback(() => {
    // If we have a menu context, return to menu; otherwise quit
    const menu = menuScreenFrom(screen);
    if (menu.tag === "menu" && menu.cwd) {
      setScreen(menu);
    } else {
      exitTui({ action: "quit" });
    }
  }, [screen, exitTui, menuScreenFrom]);

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
      const menu = menuScreenFrom(screen);
      if (menu.tag === "menu" && menu.cwd) {
        setScreen(menu);
      } else {
        exitTui({ action: "quit" });
      }
    }
  }, [screen, exitTui, menuScreenFrom]);

  // --- Plan picker callbacks ---

  const handlePlanPickerSelect = useCallback(
    (value: string) => {
      if (screen.tag !== "plan-picker") return;

      switch (screen.mode) {
        case "run":
          exitTui({
            action: "run",
            args: ["run", "--plan", value],
          });
          break;

        case "resume":
          exitTui({
            action: "run",
            args: ["run", "--plan", `${value}.md`, "--resume"],
          });
          break;

        case "reset":
          resetPlanBySlug(screen.cwd, value);
          // Return to menu with fresh state
          setScreen({
            tag: "menu",
            cwd: screen.cwd,
            menuContext: screen.menuContext,
          });
          break;
      }
    },
    [screen, exitTui],
  );

  const handlePlanPickerBack = useCallback(() => {
    const menu = menuScreenFrom(screen);
    setScreen(menu);
  }, [screen, menuScreenFrom]);

  // --- Issue picker callbacks ---

  const handleIssueSelect = useCallback(
    (args: string[]) => {
      exitTui({ action: "run", args });
    },
    [exitTui],
  );

  const handleIssueBack = useCallback(() => {
    const menu = menuScreenFrom(screen);
    setScreen(menu);
  }, [screen, menuScreenFrom]);

  // --- Stop screen callbacks ---

  const handleStopDone = useCallback(() => {
    const menu = menuScreenFrom(screen);
    setScreen(menu);
  }, [screen, menuScreenFrom]);

  const handleStopBack = useCallback(() => {
    const menu = menuScreenFrom(screen);
    setScreen(menu);
  }, [screen, menuScreenFrom]);

  // --- Doctor / Clean callbacks ---

  const handleToolBack = useCallback(() => {
    const menu = menuScreenFrom(screen);
    if (menu.tag === "menu" && menu.cwd) {
      setScreen(menu);
    } else {
      exitTui({ action: "quit" });
    }
  }, [screen, exitTui, menuScreenFrom]);

  // --- Render ---

  switch (screen.tag) {
    case "menu":
      return (
        <MainMenuScreen
          key={Date.now()} // Force remount on return to refresh state
          cwd={screen.cwd}
          menuContext={screen.menuContext}
          onSelect={handleMenuSelect}
        />
      );

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

    case "plan-picker":
      return (
        <PlanPickerScreen
          title={screen.title}
          plans={screen.plans}
          onSelect={handlePlanPickerSelect}
          onBack={handlePlanPickerBack}
        />
      );

    case "issue-picker":
      return (
        <IssuePicker
          listOptions={screen.listOptions}
          onSelect={handleIssueSelect}
          onBack={handleIssueBack}
        />
      );

    case "stop":
      return (
        <StopScreen
          state={screen.state}
          cwd={screen.cwd}
          onDone={handleStopDone}
          onBack={handleStopBack}
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
