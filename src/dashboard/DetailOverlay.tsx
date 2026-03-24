/**
 * DetailOverlay — full-screen overlay for viewing plan details.
 *
 * Four tabs: Summary, Plan, Progress, Output.
 * Smart default tab per state: active -> Progress, queued -> Plan, done -> Summary.
 * Output tab shows green LIVE indicator and supports follow-tail mode.
 *
 * Opened by pressing Enter on a plan in the list, dismissed with Esc.
 */

import React from "react";
import { Box, Text } from "ink";
import type { PlanInfo, DetailTab } from "./types.ts";
import { wrapText } from "./format.ts";
import { useSpinner } from "./hooks.ts";

interface DetailOverlayProps {
  plan: PlanInfo;
  tab: DetailTab;
  scrollOffset: number;
  planContent: string | null;
  progressContent: string | null;
  outputData: { content: string; totalLines: number; isLive: boolean } | null;
  contentHeight: number;
  followTail: boolean;
  width: number;
  height: number;
}

const TABS: DetailTab[] = ["summary", "plan", "progress", "output"];

function TabBar({ active }: { active: DetailTab }) {
  return (
    <Box>
      {TABS.map((tab, i) => {
        const isActive = tab === active;
        const label = tab.charAt(0).toUpperCase() + tab.slice(1);
        const shortcut = tab.charAt(0);
        return (
          <Box key={tab}>
            {i > 0 && <Text dimColor>{" \u2502 "}</Text>}
            {isActive ? (
              <Text bold color="cyan">
                {label}
              </Text>
            ) : (
              <Text dimColor>
                <Text>{shortcut}</Text>
                {tab.slice(1)}
              </Text>
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
  const filled = total > 0 ? Math.round((current / total) * width) : 0;
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
  const stateLabel =
    plan.state === "in-progress"
      ? "active"
      : plan.state === "backlog"
        ? "queued"
        : "done";

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

      {plan.worktreePath && (
        <Box>
          <Text dimColor>{"Worktree    "}</Text>
          <Text dimColor>{plan.worktreePath}</Text>
        </Box>
      )}

      {(plan.turnsBudget !== undefined ||
        plan.turnsCompleted !== undefined) && (
        <Box marginTop={1}>
          <Text dimColor>{"Turns       "}</Text>
          <ProgressBar
            current={plan.turnsCompleted ?? 0}
            total={plan.turnsBudget ?? 0}
          />
        </Box>
      )}

      {(plan.totalTasks !== undefined || plan.tasksCompleted !== undefined) && (
        <Box>
          <Text dimColor>{"Tasks       "}</Text>
          <ProgressBar
            current={plan.tasksCompleted ?? 0}
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

/** Pick the best default tab for a plan based on its state. */
export function defaultTabForState(state: PlanInfo["state"]): DetailTab {
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
  followTail,
  width,
  height,
}: DetailOverlayProps) {
  // Usable content width after border chrome (2 columns)
  const contentWidth = Math.max(1, width - 4);

  const isLive = tab === "output" && (outputData?.isLive ?? false);
  const liveSpinner = useSpinner(isLive);

  const planTitle =
    plan.slug +
    (isLive ? `  ${liveSpinner} LIVE` : "") +
    (tab === "output" && followTail ? " [follow]" : "") +
    (plan.state === "completed" ? "  \u2713 done" : "");

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      width={width}
      height={height}
      overflow="hidden"
    >
      {/* Title */}
      <Text bold color="cyan">
        {planTitle}
      </Text>

      {/* Tab bar */}
      <Box>
        <TabBar active={tab} />
      </Box>

      {/* Content area */}
      <Box marginTop={1} flexDirection="column">
        {tab === "summary" && <SummaryView plan={plan} />}

        {tab === "plan" &&
          (planContent ? (
            <ContentView
              lines={wrapText(planContent, contentWidth)}
              scrollOffset={scrollOffset}
              contentHeight={contentHeight}
            />
          ) : (
            <Text dimColor>Plan file not found.</Text>
          ))}

        {tab === "progress" &&
          (progressContent ? (
            <ContentView
              lines={wrapText(progressContent, contentWidth)}
              scrollOffset={scrollOffset}
              contentHeight={contentHeight}
            />
          ) : (
            <Text dimColor>No progress log yet.</Text>
          ))}

        {tab === "output" &&
          (outputData ? (
            <ContentView
              lines={wrapText(outputData.content, contentWidth)}
              scrollOffset={scrollOffset}
              contentHeight={contentHeight}
              footer={
                outputData.isLive
                  ? "tailing agent-output.log"
                  : `${outputData.totalLines} total lines`
              }
            />
          ) : (
            <Text dimColor>No agent output available.</Text>
          ))}
      </Box>
    </Box>
  );
}
