/**
 * TUI application root -- screen router with async data hooks.
 *
 * `App` manages which screen is visible, dispatches actions from the
 * `MenuScreen`, and handles transitions (exit, navigate, launch runner).
 *
 * Data loading is owned by the hooks inside `App`:
 * - `usePipelineState` gathers pipeline state asynchronously on mount
 *   and re-gathers on `refresh()`.
 * - `useGithubIssues` peeks at GitHub issue counts on mount (cached
 *   for the session).
 *
 * The menu renders immediately in a loading state while data loads in
 * the background, so the TUI is interactive from the first frame.
 */

import { useState, useCallback, useMemo } from "react";
import { useApp } from "ink";

import type { MenuContext } from "./menu-items.ts";
import type { Screen, DispatchResult, RunConfig } from "./types.ts";
import {
  isActionType,
  resolveAction,
  toConfirmNav,
  toOptionsNav,
} from "./types.ts";
import type { ResolvedConfig } from "../config.ts";
import { usePipelineState } from "./hooks/use-pipeline-state.ts";
import type { UsePipelineStateOptions } from "./hooks/use-pipeline-state.ts";
import { useGithubIssues } from "./hooks/use-github-issues.ts";
import type { UseGithubIssuesOptions } from "./hooks/use-github-issues.ts";
import type { ListGithubIssuesOptions } from "../interactive/github-issues.ts";
import { MenuScreen } from "./screens/menu.tsx";
import { IssuePickerScreen } from "./screens/issue-picker.tsx";
import { BacklogPickerScreen } from "./screens/backlog-picker.tsx";
import { ConfirmScreen } from "./screens/confirm.tsx";
import { OptionsScreen } from "./screens/options.tsx";
import { StopScreen } from "./screens/stop.tsx";
import { ResetScreen } from "./screens/reset.tsx";
import { StatusScreen } from "./screens/status.tsx";
import { DoctorScreen } from "./screens/doctor.tsx";
import { CleanScreen } from "./screens/clean.tsx";
import {
  runningPlans,
  resettablePlans,
} from "../interactive/pipeline-actions.ts";
import { runRalphaiStop } from "../stop.ts";
import { resetPlanBySlug } from "../ralphai.ts";
import { ScreenFrame } from "./components/screen-frame.tsx";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AppProps {
  /**
   * Options for the pipeline state hook.
   * Must include `cwd` and optionally injected gather/list functions.
   */
  pipelineOpts: UsePipelineStateOptions;
  /**
   * Options for the GitHub issues hook.
   * When `undefined`, GitHub issue loading is skipped entirely
   * (e.g. when `issueSource` is not "github").
   */
  githubOpts?: UseGithubIssuesOptions;
  /** Whether GitHub issues are configured as the issue source. */
  hasGitHubIssues?: boolean;
  /**
   * Options for the full GitHub issue list (used by the issue picker
   * screen). When `undefined`, the picker derives options from
   * `githubOpts.peekOptions`.
   */
  issueListOptions?: ListGithubIssuesOptions;
  /**
   * Run configuration used to populate the confirmation screen.
   * Contains agent command and feedback commands from resolved config.
   * Defaults to empty strings when not provided.
   */
  runConfig?: RunConfig;
  /**
   * Resolved configuration for the run-with-options wizard.
   * When provided, the options screen shows configurable options.
   * When absent, the options screen shows a placeholder.
   */
  resolvedConfig?: ResolvedConfig;
  /**
   * Called when the TUI wants to hand off to the agent runner.
   * The caller should exit Ink and run the given CLI args.
   */
  onExitToRunner?: (args: string[]) => void;
  /**
   * Injected stop function for the stop screen. Defaults to
   * `runRalphaiStop` — override in tests.
   */
  stopPlan?: (cwd: string, slug: string) => void;
  /**
   * Injected reset function for the reset screen. Defaults to
   * `resetPlanBySlug` — override in tests.
   */
  resetPlan?: (cwd: string, slug: string) => void;
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
// Stub hook for when GitHub issues are disabled
// ---------------------------------------------------------------------------

const EMPTY_GITHUB: UseGithubIssuesOptions = {
  peekOptions: {
    cwd: "",
    issueSource: "none",
    standaloneLabel: "",
    issueRepo: "",
  },
};

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export function App({
  pipelineOpts,
  githubOpts,
  hasGitHubIssues = false,
  issueListOptions,
  runConfig = { agentCommand: "", feedbackCommands: "" },
  resolvedConfig,
  onExitToRunner,
  stopPlan: injectedStopPlan,
  resetPlan: injectedResetPlan,
}: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ type: "menu" });

  // Default stop function — calls runRalphaiStop with the slug
  const stopPlan = useMemo(
    () =>
      injectedStopPlan ??
      ((cwd: string, slug: string) =>
        runRalphaiStop({ cwd, dryRun: false, slug })),
    [injectedStopPlan],
  );

  // Default reset function — calls resetPlanBySlug with cwd and slug
  const resetPlanFn = useMemo(
    () =>
      injectedResetPlan ??
      ((cwd: string, slug: string) => resetPlanBySlug(cwd, slug)),
    [injectedResetPlan],
  );

  // --- Async data hooks ---
  const pipeline = usePipelineState(pipelineOpts);
  const github = useGithubIssues(githubOpts ?? EMPTY_GITHUB);

  // Build the MenuContext from hook results
  const menuContext = useMemo<MenuContext>(() => {
    const ctx: MenuContext = {
      hasGitHubIssues,
    };

    if (hasGitHubIssues) {
      ctx.githubIssueCount = github.count;
      ctx.githubIssueLoading = github.loading;
      ctx.githubIssueError = github.error;
    }

    return ctx;
  }, [hasGitHubIssues, github.count, github.loading, github.error]);

  // --- Action dispatch ---

  /**
   * Central dispatch for `DispatchResult` values.
   *
   * Handles navigation, exit, and runner handoff. This is the "inner"
   * dispatch that processes results as-is. Screens that should route
   * through the confirmation screen first use `dispatchViaConfirm`
   * (which wraps `exit-to-runner` results with `toConfirmNav`).
   */
  const dispatch = useCallback(
    (result: DispatchResult) => {
      switch (result.type) {
        case "stay":
          // Refresh pipeline state when returning from a sub-flow
          // so the menu shows up-to-date data.
          pipeline.refresh();
          break;

        case "exit":
          exit();
          break;

        case "navigate":
          // Refresh pipeline data when navigating back to menu from a
          // sub-flow so the menu shows up-to-date state (e.g. after
          // stopping or resetting a plan).
          if (result.screen.type === "menu") {
            pipeline.refresh();
          }
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
    [exit, onExitToRunner, pipeline.refresh],
  );

  /**
   * Create a dispatch callback that intercepts `exit-to-runner` results
   * and redirects them through the confirmation screen.
   *
   * `backScreen` determines where Esc on the confirm screen navigates.
   * Non-runner results (stay, exit, navigate) pass through unchanged.
   */
  const dispatchViaConfirm = useCallback(
    (backScreen: Screen) => (result: DispatchResult) => {
      dispatch(toConfirmNav(result, runConfig, backScreen));
    },
    [dispatch, runConfig],
  );

  const handleMenuAction = useCallback(
    (action: string) => {
      const result = handleAction(action);
      if (!result) return; // unknown action -- ignore
      // "run-with-options" routes through the options wizard instead
      // of the confirm screen. "settings" exits the TUI directly
      // (no confirm screen) and runs `ralphai init --force`.
      // All other exit-to-runner actions (e.g. "run-next") route
      // through confirm.
      if (action === "run-with-options") {
        dispatch(toOptionsNav(result, runConfig, { type: "menu" }));
      } else if (action === "settings") {
        dispatch(result);
      } else {
        dispatch(toConfirmNav(result, runConfig, { type: "menu" }));
      }
    },
    [dispatch, runConfig],
  );

  // -----------------------------------------------------------------------
  // Derived options for the issue picker screen
  // -----------------------------------------------------------------------

  const resolvedIssueListOptions = useMemo<
    ListGithubIssuesOptions | undefined
  >(() => {
    if (issueListOptions) return issueListOptions;
    if (!githubOpts) return undefined;
    const { cwd, standaloneLabel, issueRepo, issuePrdLabel } =
      githubOpts.peekOptions;
    return { cwd, standaloneLabel, issueRepo, issuePrdLabel };
  }, [issueListOptions, githubOpts]);

  // -----------------------------------------------------------------------
  // Screen router
  // -----------------------------------------------------------------------

  const screenContent = (() => {
    switch (screen.type) {
      case "menu":
        return (
          <MenuScreen
            state={pipeline.state}
            loading={pipeline.loading}
            menuContext={menuContext}
            resolvedConfig={resolvedConfig}
            onAction={handleMenuAction}
            isActive={true}
          />
        );

      case "issue-picker":
        return (
          <IssuePickerScreen
            listOptions={
              resolvedIssueListOptions ?? {
                cwd: "",
                standaloneLabel: "",
                issueRepo: "",
              }
            }
            onResult={dispatchViaConfirm({ type: "issue-picker" })}
            isActive={true}
          />
        );

      case "backlog-picker":
        return (
          <BacklogPickerScreen
            backlog={pipeline.state?.backlog ?? []}
            completedSlugs={pipeline.state?.completedSlugs ?? []}
            onResult={dispatchViaConfirm({ type: "backlog-picker" })}
            isActive={true}
          />
        );

      case "confirm":
        return (
          <ConfirmScreen
            data={screen.data}
            onResult={dispatch}
            backScreen={screen.backScreen}
            isActive={true}
          />
        );

      case "options":
        return (
          <OptionsScreen
            data={screen.data}
            onResult={dispatch}
            backScreen={screen.backScreen}
            resolvedConfig={resolvedConfig}
            isActive={true}
          />
        );

      case "stop":
        return (
          <StopScreen
            runningPlans={pipeline.state ? runningPlans(pipeline.state) : []}
            cwd={pipelineOpts.cwd}
            onResult={dispatch}
            stopPlan={stopPlan}
            isActive={true}
          />
        );

      case "reset":
        return (
          <ResetScreen
            resettablePlans={
              pipeline.state ? resettablePlans(pipeline.state) : []
            }
            cwd={pipelineOpts.cwd}
            onResult={dispatch}
            resetPlan={resetPlanFn}
            isActive={true}
          />
        );

      case "status":
        return (
          <StatusScreen
            state={pipeline.state}
            onResult={dispatch}
            isActive={true}
          />
        );

      case "doctor":
        return (
          <DoctorScreen
            cwd={pipelineOpts.cwd}
            onResult={dispatch}
            isActive={true}
          />
        );

      case "clean":
        return (
          <CleanScreen
            cwd={pipelineOpts.cwd}
            onResult={dispatch}
            isActive={true}
          />
        );
    }
  })();

  return (
    <ScreenFrame screenType={screen.type} pipelineState={pipeline.state}>
      {screenContent}
    </ScreenFrame>
  );
}
