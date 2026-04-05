/**
 * Main menu screen for the TUI.
 *
 * Gathers pipeline state, builds the menu header and items, and renders
 * them using the `SelectableList` component. Supports single-key hotkeys
 * for immediate activation of menu items.
 *
 * The menu is grouped into START / MANAGE / TOOLS sections with visual
 * separators. Disabled items are skipped by keyboard navigation.
 *
 * The component calls `onSelect(value, state)` when a menu item is
 * selected (via Enter or hotkey). The parent (TuiRouter) maps the value
 * to a screen transition or TUI exit.
 */

import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { PipelineState } from "../../pipeline-state.ts";
import { gatherPipelineState } from "../../pipeline-state.ts";
import { listRalphaiWorktrees } from "../../worktree/index.ts";
import {
  buildHeaderLine,
  buildMenuItems,
  type MenuContext,
  type MenuItem,
} from "../menu-items.ts";
import {
  SelectableList,
  type ListItem,
} from "../components/selectable-list.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MainMenuScreenProps {
  /** Working directory for pipeline state gathering. */
  cwd: string;
  /** Menu context (GitHub config, issue count, etc.). */
  menuContext: MenuContext;
  /** Called when a menu item is selected (Enter or hotkey). */
  onSelect: (value: string, state: PipelineState) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Group separator label. */
const GROUP_LABELS: Record<string, string> = {
  START: "Start",
  MANAGE: "Manage",
  TOOLS: "Tools",
};

/**
 * Convert menu items into list items with group separators.
 *
 * Inserts disabled separator items between groups so the list visually
 * groups items. The separator items have values prefixed with `__sep__:`
 * so they are never selectable.
 */
export function menuItemsToListItems(items: MenuItem[]): ListItem[] {
  const result: ListItem[] = [];
  let lastGroup: string | undefined;

  for (const item of items) {
    if (item.group !== lastGroup) {
      if (lastGroup !== undefined) {
        // Blank separator between groups
        result.push({
          value: `__sep__:${item.group}`,
          label: "",
          disabled: true,
        });
      }
      // Group header
      result.push({
        value: `__header__:${item.group}`,
        label: GROUP_LABELS[item.group] ?? item.group,
        disabled: true,
      });
      lastGroup = item.group;
    }

    const hint = [item.hint, item.hotkey ? `[${item.hotkey}]` : undefined]
      .filter(Boolean)
      .join("  ");

    result.push({
      value: item.value,
      label: `  ${item.label}`,
      hint: hint || undefined,
      disabled: item.disabled,
    });
  }

  return result;
}

/**
 * Build a hotkey → menu item value map from menu items.
 *
 * Only includes enabled items with a defined hotkey.
 */
export function buildHotkeyMap(items: MenuItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.hotkey && !item.disabled) {
      map.set(item.hotkey, item.value);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MainMenuScreen({
  cwd,
  menuContext,
  onSelect,
}: MainMenuScreenProps): React.ReactNode {
  // Gather pipeline state synchronously on each render.
  // This is fast (filesystem reads only) and ensures data is always fresh
  // when returning from sub-screens.
  const state = useMemo<PipelineState>(() => {
    let worktrees: { path: string; branch: string }[] = [];
    try {
      worktrees = listRalphaiWorktrees(cwd);
    } catch {
      // Not in a git repo or git not available
    }
    return gatherPipelineState(cwd, { worktrees });
  }, [cwd]);

  const headerLine = useMemo(() => buildHeaderLine(state), [state]);
  const menuItems = useMemo(
    () => buildMenuItems(state, menuContext),
    [state, menuContext],
  );
  const listItems = useMemo(() => menuItemsToListItems(menuItems), [menuItems]);
  const hotkeyMap = useMemo(() => buildHotkeyMap(menuItems), [menuItems]);

  // Handle hotkey presses
  useInput((input) => {
    const value = hotkeyMap.get(input);
    if (value) {
      onSelect(value, state);
    }
  });

  const handleListSelect = (value: string) => {
    // Ignore separator/header selections (shouldn't happen, but guard)
    if (value.startsWith("__sep__:") || value.startsWith("__header__:")) {
      return;
    }
    onSelect(value, state);
  };

  return (
    <Box flexDirection="column" paddingTop={1}>
      {/* Pipeline summary header */}
      <Text>{headerLine}</Text>

      {/* Menu items */}
      <Box marginTop={1} flexDirection="column">
        <SelectableList items={listItems} onSelect={handleListSelect} />
      </Box>
    </Box>
  );
}
