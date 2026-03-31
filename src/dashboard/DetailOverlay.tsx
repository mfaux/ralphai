/**
 * DetailOverlay — plan detail view, used both as a full-screen overlay
 * (narrow terminals) and as an inline split pane (wide terminals).
 *
 * Four tabs: Summary, Plan, Progress, Output.
 * Smart default tab per state: In progress -> Progress, Backlog -> Plan, Completed -> Summary.
 * Output tab shows the tail of agent-output.log.
 *
 * In overlay mode: opened by pressing Enter, dismissed with Esc.
 * In split mode: sits beside the plan list, border highlights when focused.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { PlanInfo, DetailTab } from "./types.ts";
import { wrapText, hasProgressData, clampCompleted } from "./format.ts";
import { useSpinner } from "./hooks.ts";
import { getPlanStateLabel } from "./state-labels.ts";

interface DetailOverlayProps {
  plan: PlanInfo;
  tab: DetailTab;
  scrollOffset: number;
  planContent: string | null;
  progressContent: string | null;
  outputData: { content: string; totalLines: number } | null;
  contentHeight: number;
  width: number;
  height: number;
  /** Whether this pane is focused (controls border color in split mode). */
  active?: boolean;
}

const TABS: DetailTab[] = ["summary", "plan", "progress", "output"];

function TabBar({ active }: { active: DetailTab }) {
  return (
    <Box>
      {TABS.map((tab, i) => {
        const isActive = tab === active;
        const label = tab.charAt(0).toUpperCase() + tab.slice(1);
        return (
          <Box key={tab}>
            {i > 0 && <Text dimColor>{" \u2502 "}</Text>}
            {isActive ? (
              <Text bold color="cyan">
                {label}
              </Text>
            ) : (
              <Text dimColor>{label}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ProgressBar({
  current,
  total,
  width = 10,
}: {
  current: number;
  total: number;
  width?: number;
}) {
  const rawFilled = total > 0 ? Math.round((current / total) * width) : 0;
  const filled = Math.max(0, Math.min(width, rawFilled));
  const empty = width - filled;
  return (
    <Text>
      <Text color="green">{"\u2588".repeat(filled)}</Text>
      <Text dimColor>{"\u2591".repeat(empty)}</Text>
      <Text>
        {" "}
        {current}/{total}
      </Text>
    </Text>
  );
}

function SummaryView({ plan }: { plan: PlanInfo }) {
  const spinner = useSpinner(plan.state === "in-progress");
  const stateColor =
    plan.state === "in-progress"
      ? "green"
      : plan.state === "backlog"
        ? "yellow"
        : "gray";
  const stateBadge =
    plan.state === "in-progress"
      ? spinner
      : plan.state === "backlog"
        ? "\u25CB"
        : "\u2713";
  const stateLabel = getPlanStateLabel(plan.state);

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{"State       "}</Text>
        <Text color={stateColor}>
          {stateBadge} {stateLabel}
        </Text>
      </Box>

      {plan.scope && (
        <Box>
          <Text dimColor>{"Scope       "}</Text>
          <Text>{plan.scope}</Text>
        </Box>
      )}

      {plan.branch && (
        <Box>
          <Text dimColor>{"Branch      "}</Text>
          <Text>{plan.branch}</Text>
        </Box>
      )}

      {plan.receiptSource && (
        <Box>
          <Text dimColor>{"Source      "}</Text>
          <Text>{plan.receiptSource}</Text>
        </Box>
      )}

      {plan.source && (
        <Box>
          <Text dimColor>{"Origin      "}</Text>
          <Text color={plan.source === "github-remote" ? "magenta" : undefined}>
            {plan.source === "github-remote"
              ? "GitHub issue (not pulled)"
              : plan.source === "github"
                ? "GitHub issue"
                : plan.source}
          </Text>
        </Box>
      )}

      {plan.issueNumber !== undefined && (
        <Box>
          <Text dimColor>{"Issue       "}</Text>
          <Text color="magenta">#{plan.issueNumber}</Text>
        </Box>
      )}

      {plan.issueUrl && (
        <Box>
          <Text dimColor>{"Issue URL   "}</Text>
          <Text dimColor>{plan.issueUrl}</Text>
        </Box>
      )}

      {plan.worktreePath && (
        <Box>
          <Text dimColor>{"Worktree    "}</Text>
          <Text dimColor>{plan.worktreePath}</Text>
        </Box>
      )}

      {hasProgressData(plan.totalTasks, plan.tasksCompleted) && (
        <Box>
          <Text dimColor>{"Tasks       "}</Text>
          <ProgressBar
            current={clampCompleted(plan.tasksCompleted, plan.totalTasks)}
            total={plan.totalTasks ?? 0}
          />
        </Box>
      )}

      {plan.deps && plan.deps.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Depends on</Text>
          {plan.deps.map((dep) => (
            <Text key={dep} dimColor>
              {"  \u2022 "}
              {dep}
            </Text>
          ))}
        </Box>
      )}

      {plan.startedAt && (
        <Box marginTop={1}>
          <Text dimColor>{"Started     "}</Text>
          <Text dimColor>{plan.startedAt}</Text>
        </Box>
      )}

      {plan.outcome && (
        <Box>
          <Text dimColor>{"Outcome     "}</Text>
          <Text>{plan.outcome}</Text>
        </Box>
      )}
    </Box>
  );
}

function ContentView({
  lines,
  scrollOffset,
  contentHeight,
  footer,
}: {
  lines: string[];
  scrollOffset: number;
  contentHeight: number;
  footer?: string;
}) {
  const clampedOffset = Math.min(
    scrollOffset,
    Math.max(0, lines.length - contentHeight),
  );
  const visible = lines.slice(clampedOffset, clampedOffset + contentHeight);
  const hasMore = clampedOffset + contentHeight < lines.length;
  const hasPrev = clampedOffset > 0;

  return (
    <Box flexDirection="column">
      {hasPrev && (
        <Text dimColor>
          {"\u2191"} {clampedOffset} more lines above
        </Text>
      )}
      {visible.map((line, i) => (
        <Text key={clampedOffset + i} wrap="truncate">
          {line}
        </Text>
      ))}
      {hasMore && (
        <Text dimColor>
          {"\u2193"} {lines.length - clampedOffset - contentHeight} more lines
          below
        </Text>
      )}
      {footer && (
        <Box marginTop={1}>
          <Text dimColor>{footer}</Text>
        </Box>
      )}
    </Box>
  );
}

/** Pick the best default tab for a plan based on its state and source. */
export function defaultTabForState(
  state: PlanInfo["state"],
  source?: PlanInfo["source"],
): DetailTab {
  // Remote issues have no local plan file — show summary instead of plan tab.
  if (source === "github-remote") return "summary";
  switch (state) {
    case "in-progress":
      return "progress";
    case "backlog":
      return "plan";
    case "completed":
      return "summary";
  }
}

export function DetailOverlay({
  plan,
  tab,
  scrollOffset,
  planContent,
  progressContent,
  outputData,
  contentHeight,
  width,
  height,
  active,
}: DetailOverlayProps) {
  // Usable content width after border chrome (2 columns)
  const contentWidth = Math.max(1, width - 4);
  // Default to active styling when prop is not provided (overlay mode)
  const isFocused = active ?? true;

  const planLines = useMemo(
    () => (planContent ? wrapText(planContent, contentWidth) : null),
    [planContent, contentWidth],
  );
  const progressLines = useMemo(
    () => (progressContent ? wrapText(progressContent, contentWidth) : null),
    [progressContent, contentWidth],
  );
  const outputLines = useMemo(
    () => (outputData ? wrapText(outputData.content, contentWidth) : null),
    [outputData?.content, contentWidth],
  );

  const planTitle =
    "3 " + plan.slug + (plan.state === "completed" ? "  \u2713 Completed" : "");

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isFocused ? "cyan" : "gray"}
      borderDimColor={!isFocused}
      width={width}
      height={height}
      overflow="hidden"
    >
      {/* Title */}
      <Text
        bold={isFocused}
        color={isFocused ? "cyan" : undefined}
        dimColor={!isFocused}
      >
        {planTitle}
      </Text>

      {/* Tab bar */}
      <Box>
        <TabBar active={tab} />
      </Box>

      {/* Content area */}
      <Box flexDirection="column">
        {tab === "summary" && <SummaryView plan={plan} />}

        {tab === "plan" &&
          (planLines ? (
            <ContentView
              lines={planLines}
              scrollOffset={scrollOffset}
              contentHeight={contentHeight}
            />
          ) : (
            <Text dimColor>Plan file not found.</Text>
          ))}

        {tab === "progress" &&
          (progressLines ? (
            <ContentView
              lines={progressLines}
              scrollOffset={scrollOffset}
              contentHeight={contentHeight}
            />
          ) : (
            <Text dimColor>No progress log yet.</Text>
          ))}

        {tab === "output" &&
          (outputData && outputLines ? (
            <ContentView
              lines={outputLines}
              scrollOffset={scrollOffset}
              contentHeight={contentHeight}
              footer={`${outputData.totalLines} total lines`}
            />
          ) : (
            <Text dimColor>No agent output available.</Text>
          ))}
      </Box>
    </Box>
  );
}
