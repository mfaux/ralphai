/**
 * PlanList — shows plans for a selected repo with per-plan actions.
 *
 * Actions by state:
 *   backlog:      r = Run, w = Run on worktree, p = Preview
 *   in-progress:  p = Preview, s = Stop, x = Reset
 *   completed:    p = Preview
 *
 * Press Esc/Backspace to go back to repo list.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { RepoSummary } from "../global-state.ts";
import type { PlanInfo } from "./types.ts";
import { loadPlanContent } from "./data.ts";

interface PlanListProps {
  repo: RepoSummary;
  plans: PlanInfo[];
  onBack: () => void;
  onQuit: () => void;
}

export function PlanList({ repo, plans, onBack, onQuit }: PlanListProps) {
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const clearMessage = useCallback(() => {
    setTimeout(() => setMessage(null), 3000);
  }, []);

  useInput((input, key) => {
    // When previewing, any key exits preview
    if (preview !== null) {
      setPreview(null);
      return;
    }

    if (input === "q") {
      onQuit();
      return;
    }
    if (key.escape || key.backspace || key.delete) {
      onBack();
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === "j") {
      setCursor((prev) => Math.min(plans.length - 1, prev + 1));
    }

    const plan = plans[cursor];
    if (!plan) return;

    // Preview
    if (input === "p") {
      if (!repo.repoPath) {
        setMessage("Cannot preview: repo path unknown");
        clearMessage();
        return;
      }
      const content = loadPlanContent(repo.repoPath, plan);
      if (content) {
        setPreview(content);
      } else {
        setMessage("Plan file not found on disk");
        clearMessage();
      }
      return;
    }

    // Actions that need a working repo path
    if (!repo.repoPath || !repo.pathExists) {
      if (input === "r" || input === "w" || input === "s" || input === "x") {
        setMessage("Cannot act: repo path missing or stale");
        clearMessage();
      }
      return;
    }

    // Backlog actions
    if (plan.state === "backlog") {
      if (input === "r") {
        setMessage(
          `Run: ralphai run --plan=${plan.slug} (from ${repo.repoPath})`,
        );
        clearMessage();
      } else if (input === "w") {
        setMessage(
          `Worktree: ralphai worktree --plan=${plan.slug} (from ${repo.repoPath})`,
        );
        clearMessage();
      }
    }

    // In-progress actions
    if (plan.state === "in-progress") {
      if (input === "x") {
        setMessage(`Reset: ralphai reset (from ${repo.repoPath})`);
        clearMessage();
      }
    }
  });

  // Preview overlay
  if (preview !== null) {
    const lines = preview.split("\n").slice(0, 30);
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Plan Preview</Text>
        <Text dimColor>Press any key to close</Text>
        <Box marginTop={1} flexDirection="column">
          {lines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
          {preview.split("\n").length > 30 && (
            <Text dimColor>
              ... ({preview.split("\n").length - 30} more lines)
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  const stateLabel = (state: PlanInfo["state"]): string => {
    switch (state) {
      case "backlog":
        return "queued";
      case "in-progress":
        return "active";
      case "completed":
        return "done";
    }
  };

  const stateColor = (
    state: PlanInfo["state"],
  ): "yellow" | "green" | "gray" => {
    switch (state) {
      case "backlog":
        return "yellow";
      case "in-progress":
        return "green";
      case "completed":
        return "gray";
    }
  };

  const actionsHint = (state: PlanInfo["state"]): string => {
    switch (state) {
      case "backlog":
        return "r=run  w=worktree  p=preview";
      case "in-progress":
        return "p=preview  x=reset";
      case "completed":
        return "p=preview";
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{repo.id}</Text>
      <Text dimColor>
        {"  "}
        {repo.repoPath ?? "(unknown path)"}
      </Text>
      <Text dimColor>
        {"  "}
        {"\u2191\u2193 navigate \u00B7 p preview \u00B7 Esc back \u00B7 q quit"}
      </Text>

      {message && (
        <Box marginTop={1}>
          <Text color="cyan">{message}</Text>
        </Box>
      )}

      {plans.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>No plans in pipeline.</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {plans.map((plan, i) => {
            const selected = i === cursor;
            const pointer = selected ? "\u276F" : " ";

            let detail = "";
            if (plan.state === "in-progress") {
              const turns =
                plan.turnsCompleted !== undefined
                  ? `${plan.turnsCompleted}/${plan.turnsBudget ?? "?"} turns`
                  : "";
              const tasks =
                plan.tasksCompleted !== undefined && plan.totalTasks
                  ? `${plan.tasksCompleted}/${plan.totalTasks} tasks`
                  : "";
              const parts = [turns, tasks].filter(Boolean);
              if (plan.outcome) parts.push(plan.outcome);
              if (plan.receiptSource) parts.push(`via ${plan.receiptSource}`);
              detail = parts.length > 0 ? `  ${parts.join(" \u00B7 ")}` : "";
            }

            return (
              <Box key={plan.slug + plan.state} flexDirection="column">
                <Box>
                  <Text color={selected ? "cyan" : undefined} bold={selected}>
                    {pointer}{" "}
                  </Text>
                  <Text color={selected ? "white" : undefined} bold={selected}>
                    {plan.slug}
                  </Text>
                  <Text color={stateColor(plan.state)}>
                    {"  "}[{stateLabel(plan.state)}]
                  </Text>
                  {detail && <Text dimColor>{detail}</Text>}
                </Box>
                {selected && (
                  <Text dimColor>
                    {"    "}
                    {actionsHint(plan.state)}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
