/**
 * TUI entry point — renders the Ink app and returns run args on exit.
 *
 * `runTui()` replaces the clack-based `runInteractive()`. It:
 * 1. Resolves config to build props for the Ink `App` component.
 * 2. Mounts the Ink app.
 * 3. Returns the CLI args the user selected (via the confirm screen),
 *    or `undefined` if the user quit without confirming a run.
 *
 * When `onExitToRunner` fires, the Ink app unmounts so agent output
 * streams cleanly in the terminal without TUI artifacts.
 */

import React from "react";
import { render } from "ink";

import { App } from "./app.tsx";
import type { AppProps } from "./app.tsx";
import { resolveConfig, DEFAULTS } from "../config.ts";
import type { ResolvedConfig } from "../config.ts";
import type { RunConfig } from "./types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of `runTui()`. */
export interface RunTuiResult {
  /** CLI args to pass to `runRalphai`, or `undefined` if the user quit. */
  args: string[] | undefined;
}

/** Options for `runTui()`, primarily for dependency injection in tests. */
export interface RunTuiOptions {
  /** Working directory. @default process.cwd() */
  cwd?: string;
  /** Override AppProps for testing. When set, config resolution is skipped. */
  appProps?: Partial<AppProps>;
}

// ---------------------------------------------------------------------------
// Config → AppProps
// ---------------------------------------------------------------------------

/**
 * Build `AppProps` from the resolved configuration.
 *
 * Exported for testing — the real `runTui` calls this internally.
 */
export function buildAppProps(cwd: string): Omit<AppProps, "onExitToRunner"> {
  let hasGitHubIssues = false;
  let standaloneLabel = DEFAULTS.standaloneLabel;
  let issuePrdLabel = DEFAULTS.prdLabel;
  let issueRepo = "";
  let agentCommand = DEFAULTS.agentCommand;
  let feedbackCommands = DEFAULTS.feedbackCommands;
  let resolvedConfig: ResolvedConfig | undefined;

  try {
    const { config } = resolveConfig({
      cwd,
      envVars: process.env,
      cliArgs: [],
    });
    resolvedConfig = config;
    hasGitHubIssues = config.issueSource.value === "github";
    standaloneLabel = config.standaloneLabel.value;
    issuePrdLabel = config.prdLabel.value;
    issueRepo = config.issueRepo.value;
    agentCommand = config.agentCommand.value;
    feedbackCommands = config.feedbackCommands.value;
  } catch {
    // Config resolution failure — proceed with defaults
  }

  const pipelineOpts = { cwd };

  const githubOpts = hasGitHubIssues
    ? {
        peekOptions: {
          cwd,
          issueSource: "github" as const,
          standaloneLabel,
          issueRepo,
          issuePrdLabel,
        },
      }
    : undefined;

  const issueListOptions = hasGitHubIssues
    ? { cwd, standaloneLabel, issueRepo, issuePrdLabel }
    : undefined;

  const runConfig: RunConfig = { agentCommand, feedbackCommands };

  return {
    pipelineOpts,
    githubOpts,
    hasGitHubIssues,
    issueListOptions,
    runConfig,
    resolvedConfig,
  };
}

// ---------------------------------------------------------------------------
// runTui
// ---------------------------------------------------------------------------

/**
 * Mount the Ink TUI and wait for the user to either confirm a run or quit.
 *
 * Returns the CLI args when the user confirms a run, or `undefined`
 * when they quit. After this function returns, the terminal is clean
 * and ready for agent output.
 */
export async function runTui(
  options: RunTuiOptions = {},
): Promise<RunTuiResult> {
  const cwd = options.cwd ?? process.cwd();

  // Build props from config (or use overrides for testing)
  const baseProps = options.appProps
    ? { ...buildAppProps(cwd), ...options.appProps }
    : buildAppProps(cwd);

  // Promise that resolves with run args when onExitToRunner fires
  let resolveRunArgs: (args: string[] | undefined) => void;
  const runArgsPromise = new Promise<string[] | undefined>((resolve) => {
    resolveRunArgs = resolve;
  });

  const onExitToRunner = (args: string[]) => {
    resolveRunArgs(args);
  };

  const props: AppProps = {
    ...baseProps,
    onExitToRunner,
  };

  // Mount the Ink app
  const instance = render(React.createElement(App, props));

  // Wait for the app to exit (user quit) or for onExitToRunner to fire.
  // When the user quits via Esc/q, useApp().exit() is called which
  // resolves waitUntilExit(). When onExitToRunner fires, we unmount
  // manually.
  const exitPromise = instance.waitUntilExit().then(() => undefined);

  const args = await Promise.race([runArgsPromise, exitPromise]);

  // If onExitToRunner resolved first, the app is still mounted — unmount it
  // so the terminal is clean for agent output.
  instance.unmount();

  return { args };
}
