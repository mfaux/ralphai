/**
 * PlanDetailPane — right pane of the two-pane workspace.
 *
 * Shows detail tabs for the selected plan: summary, plan, progress, output.
 * Content is scrollable when the detail pane has focus.
 */

import React from "react";
import { Box, Text } from "ink";
import type { PlanInfo, DetailTab } from "./types.ts";

interface PlanDetailPaneProps {
  plan: PlanInfo | null;
  tab: DetailTab;
  focused: boolean;
  scrollOffset: number;
  /** Pre-loaded content for the current tab. */
  planContent: string | null;
  progressContent: string | null;
  outputData: { content: string; totalLines: number; isLive: boolean } | null;
  /** Visible height for content area (rows). */
  contentHeight: number;
}

const TABS: DetailTab[] = ["summary", "plan", "progress", "output"];

function TabBar({ active }: { active: DetailTab }) {
  return (
    <Box>
      {TABS.map((tab, i) => {
        const isActive = tab === active;
        const label = tab.toUpperCase();
        return (
          <Box key={tab}>
            {i > 0 && <Text dimColor> </Text>}
            {isActive ? (
              <Text bold color="cyan">
                [{label}]
              </Text>
            ) : (
              <Text dimColor>[{tab}]</Text>
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
        {current} / {total}
      </Text>
    </Text>
  );
}

function SummaryView({ plan }: { plan: PlanInfo }) {
  const stateColor =
    plan.state === "in-progress"
      ? "green"
      : plan.state === "backlog"
        ? "yellow"
        : "gray";
  const stateBadge =
    plan.state === "in-progress"
      ? "\u25CF"
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
  const visible = lines.slice(scrollOffset, scrollOffset + contentHeight);
  const hasMore = scrollOffset + contentHeight < lines.length;
  const hasPrev = scrollOffset > 0;

  return (
    <Box flexDirection="column">
      {hasPrev && (
        <Text dimColor>
          {"\u2191"} {scrollOffset} more lines above
        </Text>
      )}
      {visible.map((line, i) => (
        <Text key={scrollOffset + i} wrap="truncate">
          {line}
        </Text>
      ))}
      {hasMore && (
        <Text dimColor>
          {"\u2193"} {lines.length - scrollOffset - contentHeight} more lines
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

function actionsHint(plan: PlanInfo): string {
  switch (plan.state) {
    case "backlog":
      return "r run  w worktree  p plan  g progress";
    case "in-progress":
      return "x reset  p plan  g progress  o output";
    case "completed":
      return "p plan  g progress  o output";
  }
}

export function PlanDetailPane({
  plan,
  tab,
  focused,
  scrollOffset,
  planContent,
  progressContent,
  outputData,
  contentHeight,
}: PlanDetailPaneProps) {
  if (!plan) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor>Select a plan to view details.</Text>
      </Box>
    );
  }

  const borderColor = focused ? "cyan" : undefined;

  return (
    <Box flexDirection="column" paddingLeft={2} flexGrow={1}>
      {/* Plan title + live badge */}
      <Box>
        <Text bold color={borderColor}>
          {plan.slug}
        </Text>
        {tab === "output" && outputData?.isLive && (
          <Text color="green" bold>
            {"  \u25CF LIVE"}
          </Text>
        )}
        {plan.state === "completed" && <Text dimColor>{"  \u2713 done"}</Text>}
      </Box>

      {/* Tab bar */}
      <Box marginTop={1}>
        <TabBar active={tab} />
      </Box>

      {/* Content area */}
      <Box marginTop={1} flexDirection="column">
        {tab === "summary" && <SummaryView plan={plan} />}

        {tab === "plan" &&
          (planContent ? (
            <ContentView
              lines={planContent.split("\n")}
              scrollOffset={scrollOffset}
              contentHeight={contentHeight}
            />
          ) : (
            <Text dimColor>Plan file not found.</Text>
          ))}

        {tab === "progress" &&
          (progressContent ? (
            <ContentView
              lines={progressContent.split("\n")}
              scrollOffset={scrollOffset}
              contentHeight={contentHeight}
            />
          ) : (
            <Text dimColor>No progress log yet.</Text>
          ))}

        {tab === "output" &&
          (outputData ? (
            <ContentView
              lines={outputData.content.split("\n")}
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

      {/* Actions footer */}
      <Box marginTop={1}>
        <Text dimColor>{actionsHint(plan)}</Text>
      </Box>
    </Box>
  );
}
