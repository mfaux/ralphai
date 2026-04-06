/**
 * Contextual detail pane for the TUI split layout.
 *
 * Renders content in the right pane of the split layout based on which
 * menu item is currently highlighted. Each menu item maps to a different
 * detail view showing relevant information from the pipeline state.
 *
 * Pure helpers (`detailForItem`, `formatDuration`) are exported for
 * unit testing without React rendering.
 */

import { Box, Text } from "ink";

import type { PipelineState, InProgressPlan } from "../../pipeline-state.ts";
import type { MenuContext } from "../menu-items.ts";
import type { ResolvedConfig } from "../../config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data needed by the detail pane to render content for any menu item. */
export interface DetailPaneProps {
  /** The `value` string of the currently highlighted menu item. */
  highlightedValue: string;
  /** Current pipeline state, or null while loading. */
  state: PipelineState | null;
  /** Whether pipeline state is still loading. */
  stateLoading?: boolean;
  /** Extra context from the GitHub issue peek. */
  menuContext?: MenuContext;
  /** Resolved config for the settings detail view. */
  resolvedConfig?: ResolvedConfig;
}

/**
 * Descriptor for the content to show in the detail pane.
 * Used as an intermediate representation for testing.
 */
export interface DetailContent {
  /** Section title displayed at the top of the pane. */
  title: string;
  /** Lines of content to display. */
  lines: DetailLine[];
  /** Whether a loading indicator should be shown. */
  loading?: boolean;
}

/** A single line in the detail pane. */
export interface DetailLine {
  text: string;
  dim?: boolean;
  bold?: boolean;
  color?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds to a human-readable string.
 * Returns strings like "2h 15m", "45m", "< 1m".
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "< 1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Format a liveness tag to a human-readable status string.
 */
export function formatLiveness(plan: InProgressPlan): string {
  switch (plan.liveness.tag) {
    case "running":
      return `running (PID ${plan.liveness.pid})`;
    case "stalled":
      return "stalled";
    case "in_progress":
      return "in progress";
    case "outcome":
      return plan.liveness.outcome;
  }
}

/**
 * Format a dependency status indicator.
 * Returns a string like "✓ dep-name" or "○ dep-name" depending on
 * whether the dependency has been completed.
 */
export function formatDependency(
  dep: string,
  completedSlugs: string[],
): string {
  const isComplete = completedSlugs.some(
    (slug) => slug === dep || slug.startsWith(`${dep}-`),
  );
  return isComplete ? `✓ ${dep}` : `○ ${dep}`;
}

/**
 * Build the detail content descriptor for a given highlighted menu item.
 *
 * This is a pure function that maps a menu item value + pipeline state
 * to a content descriptor, suitable for unit testing.
 */
export function detailForItem(
  highlightedValue: string,
  state: PipelineState | null,
  stateLoading: boolean,
  menuContext?: MenuContext,
  resolvedConfig?: ResolvedConfig,
): DetailContent {
  switch (highlightedValue) {
    case "pick-from-github":
      return githubDetail(menuContext);

    case "pick-from-backlog":
      return backlogDetail(state, stateLoading);

    case "stop-running":
      return stopRunningDetail(state, stateLoading);

    case "reset-plan":
      return resetPlanDetail(state, stateLoading);

    case "view-status":
      return viewStatusDetail(state, stateLoading);

    case "doctor":
      return {
        title: "Doctor",
        lines: [{ text: "Press Enter to run checks", dim: true }],
      };

    case "clean":
      return cleanWorktreesDetail(state, stateLoading);

    case "settings":
      return settingsDetail(resolvedConfig);

    case "run-next":
      return runNextDetail(state, stateLoading);

    case "resume-stalled":
      return resumeStalledDetail(state, stateLoading);

    case "run-with-options":
      return {
        title: "Run with options",
        lines: [
          {
            text: "Press Enter to configure and launch a plan with custom options",
            dim: true,
          },
        ],
      };

    case "quit":
      return {
        title: "Quit",
        lines: [{ text: "Exit the TUI", dim: true }],
      };

    default:
      return { title: "", lines: [] };
  }
}

// ---------------------------------------------------------------------------
// Per-item detail builders
// ---------------------------------------------------------------------------

function githubDetail(menuContext?: MenuContext): DetailContent {
  if (menuContext?.githubIssueLoading) {
    return {
      title: "GitHub Issues",
      lines: [],
      loading: true,
    };
  }

  if (menuContext?.githubIssueError) {
    return {
      title: "GitHub Issues",
      lines: [{ text: menuContext.githubIssueError, color: "yellow" }],
    };
  }

  if (!menuContext?.hasGitHubIssues) {
    return {
      title: "GitHub Issues",
      lines: [
        { text: "GitHub issue source not configured", dim: true },
        {
          text: 'Set issueSource to "github" in config to enable',
          dim: true,
        },
      ],
    };
  }

  const count = menuContext.githubIssueCount ?? 0;
  if (count === 0) {
    return {
      title: "GitHub Issues",
      lines: [{ text: "No issues found with configured labels", dim: true }],
    };
  }

  return {
    title: "GitHub Issues",
    lines: [
      {
        text: `${count} issue${count === 1 ? "" : "s"} available`,
        bold: true,
      },
      { text: "Press Enter to browse and select", dim: true },
    ],
  };
}

function backlogDetail(
  state: PipelineState | null,
  stateLoading: boolean,
): DetailContent {
  if (stateLoading || !state) {
    return { title: "Backlog", lines: [], loading: true };
  }

  if (state.backlog.length === 0) {
    return {
      title: "Backlog",
      lines: [{ text: "No plans in backlog", dim: true }],
    };
  }

  const lines: DetailLine[] = [];
  for (const plan of state.backlog) {
    const name = plan.filename.replace(/\.md$/, "");
    if (plan.dependsOn.length > 0) {
      const depStatuses = plan.dependsOn.map((dep) =>
        formatDependency(dep, state.completedSlugs),
      );
      lines.push({ text: `${name}` });
      for (const depStatus of depStatuses) {
        const isComplete = depStatus.startsWith("✓");
        lines.push({
          text: `  ${depStatus}`,
          dim: !isComplete,
          color: isComplete ? "green" : undefined,
        });
      }
    } else {
      lines.push({ text: `${name}`, dim: false });
      lines.push({ text: "  No dependencies", dim: true });
    }
  }

  return {
    title: `Backlog (${state.backlog.length})`,
    lines,
  };
}

function stopRunningDetail(
  state: PipelineState | null,
  stateLoading: boolean,
): DetailContent {
  if (stateLoading || !state) {
    return { title: "Running Plans", lines: [], loading: true };
  }

  const running = state.inProgress.filter((p) => p.liveness.tag === "running");

  if (running.length === 0) {
    return {
      title: "Running Plans",
      lines: [{ text: "No plans currently running", dim: true }],
    };
  }

  const lines: DetailLine[] = [];
  for (const plan of running) {
    lines.push({
      text: plan.slug,
      bold: true,
    });
    lines.push({
      text: `  PID ${plan.liveness.tag === "running" ? plan.liveness.pid : "?"}`,
      dim: true,
    });
    if (plan.totalTasks !== undefined) {
      lines.push({
        text: `  Progress: ${plan.tasksCompleted}/${plan.totalTasks} tasks`,
        dim: true,
      });
    }
  }

  return {
    title: `Running (${running.length})`,
    lines,
  };
}

function resetPlanDetail(
  state: PipelineState | null,
  stateLoading: boolean,
): DetailContent {
  if (stateLoading || !state) {
    return { title: "In-Progress Plans", lines: [], loading: true };
  }

  if (state.inProgress.length === 0) {
    return {
      title: "In-Progress Plans",
      lines: [{ text: "No in-progress plans", dim: true }],
    };
  }

  const lines: DetailLine[] = [];
  for (const plan of state.inProgress) {
    const status = formatLiveness(plan);
    lines.push({ text: plan.slug, bold: true });
    lines.push({ text: `  Status: ${status}`, dim: true });
    if (plan.totalTasks !== undefined) {
      lines.push({
        text: `  Progress: ${plan.tasksCompleted}/${plan.totalTasks} tasks`,
        dim: true,
      });
    }
  }

  return {
    title: `In Progress (${state.inProgress.length})`,
    lines,
  };
}

function viewStatusDetail(
  state: PipelineState | null,
  stateLoading: boolean,
): DetailContent {
  if (stateLoading || !state) {
    return { title: "Pipeline Status", lines: [], loading: true };
  }

  const lines: DetailLine[] = [
    { text: `Backlog: ${state.backlog.length}` },
    { text: `In progress: ${state.inProgress.length}` },
    { text: `Completed: ${state.completedSlugs.length}` },
    { text: `Worktrees: ${state.worktrees.length}` },
  ];

  if (state.problems.length > 0) {
    lines.push({
      text: `Problems: ${state.problems.length}`,
      color: "yellow",
    });
  }

  const stalled = state.inProgress.filter((p) => p.liveness.tag === "stalled");
  if (stalled.length > 0) {
    lines.push({
      text: `Stalled: ${stalled.length}`,
      color: "yellow",
    });
  }

  return {
    title: "Pipeline Summary",
    lines,
  };
}

function cleanWorktreesDetail(
  state: PipelineState | null,
  stateLoading: boolean,
): DetailContent {
  if (stateLoading || !state) {
    return { title: "Worktrees", lines: [], loading: true };
  }

  const total = state.worktrees.length;
  const orphaned = state.worktrees.filter((w) => !w.hasActivePlan).length;

  const lines: DetailLine[] = [
    { text: `${total} worktree${total === 1 ? "" : "s"} total` },
  ];

  if (orphaned > 0) {
    lines.push({
      text: `${orphaned} without active plan (can be cleaned)`,
      color: "yellow",
    });
  } else if (total > 0) {
    lines.push({ text: "All worktrees have active plans", dim: true });
  } else {
    lines.push({ text: "No worktrees to clean", dim: true });
  }

  return {
    title: "Clean Worktrees",
    lines,
  };
}

function settingsDetail(resolvedConfig?: ResolvedConfig): DetailContent {
  if (!resolvedConfig) {
    return {
      title: "Settings",
      lines: [{ text: "Press Enter to view or edit config", dim: true }],
    };
  }

  // Show a subset of the most important config values with their sources.
  const interestingKeys: Array<keyof ResolvedConfig> = [
    "agentCommand",
    "baseBranch",
    "issueSource",
    "feedbackCommands",
    "maxStuck",
    "autoCommit",
  ];

  const lines: DetailLine[] = [];
  for (const key of interestingKeys) {
    const resolved = resolvedConfig[key];
    if (resolved) {
      const value =
        typeof resolved.value === "string" && resolved.value === ""
          ? "(not set)"
          : String(resolved.value);
      lines.push({
        text: `${key}: ${value}`,
      });
      lines.push({
        text: `  source: ${resolved.source}`,
        dim: true,
      });
    }
  }

  return {
    title: "Settings",
    lines,
  };
}

function runNextDetail(
  state: PipelineState | null,
  stateLoading: boolean,
): DetailContent {
  if (stateLoading || !state) {
    return { title: "Run Next", lines: [], loading: true };
  }

  if (state.backlog.length === 0 && state.inProgress.length === 0) {
    return {
      title: "Run Next",
      lines: [
        { text: "No plans available", dim: true },
        {
          text: "Add plans to the backlog or pick from GitHub",
          dim: true,
        },
      ],
    };
  }

  if (state.backlog.length > 0) {
    const next = state.backlog[0]!;
    const name = next.filename.replace(/\.md$/, "");
    return {
      title: "Run Next",
      lines: [
        { text: `Next: ${name}`, bold: true },
        {
          text: "Press Enter to start this plan",
          dim: true,
        },
      ],
    };
  }

  return {
    title: "Run Next",
    lines: [
      { text: "No backlog plans — all plans are in progress", dim: true },
    ],
  };
}

function resumeStalledDetail(
  state: PipelineState | null,
  stateLoading: boolean,
): DetailContent {
  if (stateLoading || !state) {
    return { title: "Resume Stalled", lines: [], loading: true };
  }

  const stalled = state.inProgress.filter((p) => p.liveness.tag === "stalled");

  if (stalled.length === 0) {
    return {
      title: "Resume Stalled",
      lines: [{ text: "No stalled plans", dim: true }],
    };
  }

  const lines: DetailLine[] = [];
  for (const plan of stalled) {
    lines.push({ text: plan.slug, bold: true });
    if (plan.totalTasks !== undefined) {
      lines.push({
        text: `  Progress: ${plan.tasksCompleted}/${plan.totalTasks} tasks`,
        dim: true,
      });
    }
  }

  return {
    title: `Stalled (${stalled.length})`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// DetailPane component
// ---------------------------------------------------------------------------

/**
 * Contextual detail pane that renders content based on the highlighted
 * menu item.
 *
 * Uses `detailForItem` to compute the content descriptor, then renders
 * it with Ink components. Shows a loading spinner when data is still
 * being fetched.
 */
export function DetailPane({
  highlightedValue,
  state,
  stateLoading = false,
  menuContext,
  resolvedConfig,
}: DetailPaneProps) {
  const detail = detailForItem(
    highlightedValue,
    state,
    stateLoading,
    menuContext,
    resolvedConfig,
  );

  // No content for unknown items
  if (!detail.title && detail.lines.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {detail.title ? (
        <Text bold underline>
          {detail.title}
        </Text>
      ) : null}

      {detail.loading ? (
        <Box marginTop={1}>
          <Text dimColor>Loading…</Text>
        </Box>
      ) : null}

      {detail.lines.length > 0 ? (
        <Box flexDirection="column" marginTop={detail.title ? 1 : 0}>
          {detail.lines.map((line, i) => (
            <Text
              key={i}
              bold={line.bold}
              dimColor={line.dim}
              color={line.color}
            >
              {line.text}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
