/**
 * ActionMenu — centered vertical overlay showing context-sensitive actions.
 *
 * Actions vary by context and selected item state. The parent provides the
 * action items; this component handles rendering and cursor navigation.
 * ↑/↓ navigate, Enter triggers, Esc dismisses.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ActionMenuItem, ActionContext } from "./types.ts";

interface ActionMenuProps {
  items: ActionMenuItem[];
  cursor: number;
  title: string;
}

export function ActionMenu({ items, cursor, title }: ActionMenuProps) {
  if (items.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text dimColor>No actions available.</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {items.map((item, i) => {
          const selected = i === cursor;
          const pointer = selected ? "\u27A4" : " ";

          return (
            <Box key={item.action}>
              <Text color={selected ? "cyan" : undefined} bold={selected}>
                {pointer} {item.label}
              </Text>
              {item.shortcut && (
                <Text dimColor>
                  {"  "}
                  {item.shortcut}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Action menu builders — produce the menu items for each context
// ---------------------------------------------------------------------------

import type { PlanInfo, WorktreeInfo } from "./types.ts";

/** Build action items for the current selection context. */
export function buildMenuItems(
  context: ActionContext,
  plan: PlanInfo | null,
  worktree: WorktreeInfo | null,
): ActionMenuItem[] {
  if (context === "worktree") {
    if (!worktree) return [];
    const items: ActionMenuItem[] = [
      { label: "View linked plan", action: "view-linked-plan" },
    ];
    if (worktree.status === "idle") {
      items.push({ label: "Remove worktree", action: "remove-worktree" });
    }
    return items;
  }

  if (context === "plan") {
    if (!plan) return [];

    const items: ActionMenuItem[] = [];

    switch (plan.state) {
      case "backlog":
        items.push(
          { label: "Run plan", action: "run", shortcut: "r" },
          { label: "View plan file", action: "view-plan" },
        );
        break;
      case "in-progress":
        items.push(
          { label: "View progress", action: "view-progress" },
          { label: "View output", action: "view-output" },
        );
        if (plan.runnerPid) {
          items.push({ label: "Stop run", action: "stop-run" });
        }
        items.push({ label: "Reset plan", action: "reset", shortcut: "R" });
        break;
      case "completed":
        items.push(
          { label: "View summary", action: "view-summary" },
          { label: "View output", action: "view-output" },
          { label: "Purge plan", action: "purge", shortcut: "P" },
        );
        break;
    }

    return items;
  }

  // context === "none"
  return [];
}
