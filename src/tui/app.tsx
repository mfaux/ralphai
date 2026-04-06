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
import type { Screen, DispatchResult } from "./types.ts";
import { isActionType, resolveAction } from "./types.ts";
import { usePipelineState } from "./hooks/use-pipeline-state.ts";
import type { UsePipelineStateOptions } from "./hooks/use-pipeline-state.ts";
import { useGithubIssues } from "./hooks/use-github-issues.ts";
import type { UseGithubIssuesOptions } from "./hooks/use-github-issues.ts";
import type { ListGithubIssuesOptions } from "../interactive/github-issues.ts";
import { MenuScreen } from "./screens/menu.tsx";
import { IssuePickerScreen } from "./screens/issue-picker.tsx";
import { BacklogPickerScreen } from "./screens/backlog-picker.tsx";
import { ConfirmScreen } from "./screens/confirm.tsx";

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
  onExitToRunner,
}: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ type: "menu" });

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
   * Used by picker screens (which produce `DispatchResult` directly)
   * and by `handleMenuAction` (which maps an action string first).
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

  const handleMenuAction = useCallback(
    (action: string) => {
      const result = handleAction(action);
      if (!result) return; // unknown action -- ignore
      dispatch(result);
    },
    [dispatch],
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

  switch (screen.type) {
    case "menu":
      return (
        <MenuScreen
          state={pipeline.state}
          loading={pipeline.loading}
          menuContext={menuContext}
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
          onResult={dispatch}
          isActive={true}
        />
      );

    case "backlog-picker":
      return (
        <BacklogPickerScreen
          backlog={pipeline.state?.backlog ?? []}
          completedSlugs={pipeline.state?.completedSlugs ?? []}
          onResult={dispatch}
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
  }
}
