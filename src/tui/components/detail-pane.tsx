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
import {
  findNextPlanName,
  unmetDependencies,
} from "../../interactive/run-actions.ts";

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
  /** Human-readable error string from the pipeline hook. */
  stateError?: string;
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
 * Appends " · docker" when the plan is running in Docker.
 */
export function formatLiveness(plan: InProgressPlan): string {
  let base: string;
  switch (plan.liveness.tag) {
    case "running":
      base = `running (PID ${plan.liveness.pid})`;
      break;
    case "stalled":
      base = "stalled";
      break;
    case "in_progress":
      base = "in progress";
      break;
    case "outcome":
      base = plan.liveness.outcome;
      break;
  }
  return plan.sandbox === "docker" ? `${base} · docker` : base;
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
  stateError?: string,
): DetailContent {
  switch (highlightedValue) {
    case "pick-from-github":
      return githubDetail(menuContext);

    case "pick-from-backlog":
      return backlogDetail(state, stateLoading, stateError);

    case "stop-running":
      return stopRunningDetail(state, stateLoading, stateError);

    case "reset-plan":
      return resetPlanDetail(state, stateLoading, stateError);

    case "view-status":
      return viewStatusDetail(state, stateLoading, stateError);

    case "doctor":
      return {
        title: "Doctor",
        lines: [{ text: "Press Enter to run checks", dim: true }],
      };

    case "clean":
      return cleanWorktreesDetail(state, stateLoading, stateError);

    case "settings":
      return settingsDetail(resolvedConfig);

    case "run-next":
      return runNextDetail(state, stateLoading, menuContext, stateError);

    case "resume-stalled":
      return resumeStalledDetail(state, stateLoading, stateError);

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

/**
 * Build a loading-or-error detail content for items that depend on
 * pipeline state. Returns `undefined` when state is available.
 */
function loadingOrError(
  title: string,
  state: PipelineState | null,
  stateLoading: boolean,
  stateError?: string,
): DetailContent | undefined {
  if (stateLoading) {
    return { title, lines: [], loading: true };
  }
  if (!state && stateError) {
    return {
      title,
      lines: [{ text: stateError, color: "yellow" }],
    };
  }
  if (!state) {
    return { title, lines: [], loading: true };
  }
  return undefined;
}

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
  stateError?: string,
): DetailContent {
  const pending = loadingOrError("Backlog", state, stateLoading, stateError);
  if (pending) return pending;
  // After the guard, state is guaranteed non-null.
  const s = state!;

  if (s.backlog.length === 0) {
    return {
      title: "Backlog",
      lines: [{ text: "No plans in backlog", dim: true }],
    };
  }

  const lines: DetailLine[] = [];
  for (const plan of s.backlog) {
    const name = plan.filename.replace(/\.md$/, "");
    if (plan.dependsOn.length > 0) {
      const depStatuses = plan.dependsOn.map((dep) =>
        formatDependency(dep, s.completedSlugs),
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
    title: `Backlog (${s.backlog.length})`,
    lines,
  };
}

function stopRunningDetail(
  state: PipelineState | null,
  stateLoading: boolean,
  stateError?: string,
): DetailContent {
  const pending = loadingOrError(
    "Running Plans",
    state,
    stateLoading,
    stateError,
  );
  if (pending) return pending;
  const s = state!;

  const running = s.inProgress.filter((p) => p.liveness.tag === "running");

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
    if (plan.sandbox === "docker") {
      lines.push({
        text: "  Sandbox: docker",
        dim: true,
      });
    }
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
  stateError?: string,
): DetailContent {
  const pending = loadingOrError(
    "In-Progress Plans",
    state,
    stateLoading,
    stateError,
  );
  if (pending) return pending;
  const s = state!;

  if (s.inProgress.length === 0) {
    return {
      title: "In-Progress Plans",
      lines: [{ text: "No in-progress plans", dim: true }],
    };
  }

  const lines: DetailLine[] = [];
  for (const plan of s.inProgress) {
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
    title: `In Progress (${s.inProgress.length})`,
    lines,
  };
}

function viewStatusDetail(
  state: PipelineState | null,
  stateLoading: boolean,
  stateError?: string,
): DetailContent {
  const pending = loadingOrError(
    "Pipeline Status",
    state,
    stateLoading,
    stateError,
  );
  if (pending) return pending;
  const s = state!;

  const lines: DetailLine[] = [
    { text: `Backlog: ${s.backlog.length}` },
    { text: `In progress: ${s.inProgress.length}` },
    { text: `Completed: ${s.completedSlugs.length}` },
    { text: `Worktrees: ${s.worktrees.length}` },
  ];

  if (s.problems.length > 0) {
    lines.push({
      text: `Problems: ${s.problems.length}`,
      color: "yellow",
    });
  }

  const stalled = s.inProgress.filter((p) => p.liveness.tag === "stalled");
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
  stateError?: string,
): DetailContent {
  const pending = loadingOrError("Worktrees", state, stateLoading, stateError);
  if (pending) return pending;
  const s = state!;

  const total = s.worktrees.length;
  const orphaned = s.worktrees.filter((w) => !w.hasActivePlan).length;

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
      lines: [{ text: "Press Enter to edit config (ralphai init)", dim: true }],
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
  menuContext?: MenuContext,
  stateError?: string,
): DetailContent {
  const pending = loadingOrError("Run Next", state, stateLoading, stateError);
  if (pending) return pending;
  const s = state!;

  if (s.backlog.length === 0 && s.inProgress.length === 0) {
    // No local plans at all — check if GitHub can supply one
    if (menuContext?.hasGitHubIssues) {
      if (menuContext.githubIssueLoading) {
        return {
          title: "Run Next",
          lines: [
            { text: "No local plans", dim: true },
            { text: "Checking GitHub for issues…", dim: true },
          ],
          loading: true,
        };
      }
      const count = menuContext.githubIssueCount ?? 0;
      if (count > 0) {
        return {
          title: "Run Next",
          lines: [
            { text: "No local plans", dim: true },
            {
              text: `Will pull oldest of ${count} issue${count === 1 ? "" : "s"} from GitHub`,
            },
            { text: "Press Enter to start", dim: true },
          ],
        };
      }
    }
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

  // Find the dependency-aware next plan (mirrors the runner algorithm)
  const nextPlanName = findNextPlanName(s);

  if (nextPlanName) {
    const plan = s.backlog.find((p) => p.filename === nextPlanName)!;
    const name = plan.filename.replace(/\.md$/, "");
    const lines: DetailLine[] = [{ text: name, bold: true }];

    if (plan.scope) {
      lines.push({ text: `  Scope: ${plan.scope}`, dim: true });
    }

    if (plan.dependsOn.length > 0) {
      for (const dep of plan.dependsOn) {
        lines.push({
          text: `  ${formatDependency(dep, s.completedSlugs)}`,
          color: s.completedSlugs.some(
            (cs) => cs === dep || cs.startsWith(`${dep}-`),
          )
            ? "green"
            : undefined,
          dim: !s.completedSlugs.some(
            (cs) => cs === dep || cs.startsWith(`${dep}-`),
          ),
        });
      }
    }

    lines.push({ text: "Press Enter to start this plan", dim: true });
    return { title: "Run Next", lines };
  }

  // Backlog exists but nothing is ready (all blocked by dependencies)
  if (s.backlog.length > 0) {
    const lines: DetailLine[] = [];
    for (const plan of s.backlog) {
      const name = plan.filename.replace(/\.md$/, "");
      const unmet = unmetDependencies(plan, s.completedSlugs);
      lines.push({ text: name });
      lines.push({
        text: `  Blocked by: ${unmet.join(", ")}`,
        dim: true,
        color: "yellow",
      });
    }
    return {
      title: "Run Next",
      lines: [
        {
          text: "All backlog plans are blocked by unmet dependencies",
          color: "yellow",
        },
        ...lines,
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
  stateError?: string,
): DetailContent {
  const pending = loadingOrError(
    "Resume Stalled",
    state,
    stateLoading,
    stateError,
  );
  if (pending) return pending;
  const s = state!;

  const stalled = s.inProgress.filter((p) => p.liveness.tag === "stalled");

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
  stateError,
  menuContext,
  resolvedConfig,
}: DetailPaneProps) {
  const detail = detailForItem(
    highlightedValue,
    state,
    stateLoading,
    menuContext,
    resolvedConfig,
    stateError,
  );

  // No content for unknown items — show a placeholder so the pane
  // isn't completely empty (which breaks the split layout visually).
  if (!detail.title && detail.lines.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Navigate to see details</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
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
