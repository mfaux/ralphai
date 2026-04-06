/**
 * Main menu screen for the TUI.
 *
 * Composes the `SelectableList` component with `buildMenuItems()` data,
 * rendering grouped menu items under START / MANAGE / TOOLS headers.
 * Disabled items are dimmed and cannot be selected. Each enabled item
 * shows a cursor indicator (❯) when highlighted.
 *
 * The screen also handles single-key hotkeys: when the menu is active,
 * pressing a hotkey letter fires the corresponding action immediately
 * without requiring arrow-key navigation.
 */

import { useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";

import type { PipelineState } from "../../pipeline-state.ts";
import type { MenuItem, MenuGroup, MenuContext } from "../menu-items.ts";
import { buildMenuItems } from "../menu-items.ts";
import { PipelineHeader } from "../components/header.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MenuScreenProps {
  /** Current pipeline state. */
  state: PipelineState;
  /** Extra context for menu item construction. */
  menuContext?: MenuContext;
  /** Called when the user selects a menu item (via Enter or hotkey). */
  onAction: (action: string) => void;
  /** Whether this screen is active (receives keyboard input). @default true */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Group header labels
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<MenuGroup, string> = {
  START: "START",
  MANAGE: "MANAGE",
  TOOLS: "TOOLS",
};

/**
 * Sentinel prefix for group-header list items. These are inserted into
 * the flat item list so that `SelectableList` can render them, but they
 * are always disabled so the cursor skips over them.
 */
const GROUP_HEADER_PREFIX = "__group__";

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert menu items into a flat `ListItem[]` with group header rows
 * inserted at each group boundary. Group headers use a value prefixed
 * with `__group__` and are always disabled.
 */
export function buildListItems(menuItems: readonly MenuItem[]): ListItem[] {
  const result: ListItem[] = [];
  let currentGroup: MenuGroup | null = null;

  for (const item of menuItems) {
    if (item.group !== currentGroup) {
      currentGroup = item.group;
      result.push({
        value: `${GROUP_HEADER_PREFIX}${currentGroup}`,
        label: GROUP_LABELS[currentGroup],
        disabled: true,
      });
    }

    result.push({
      value: item.value,
      label: item.label,
      hint: item.hint,
      disabled: item.disabled,
    });
  }

  return result;
}

/**
 * Build a hotkey → action-value lookup from menu items.
 * Only enabled items with hotkeys are included.
 */
export function buildHotkeyMap(
  menuItems: readonly MenuItem[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of menuItems) {
    if (item.hotkey && !item.disabled) {
      map.set(item.hotkey, item.value);
    }
  }
  return map;
}

/**
 * Returns true if the list item value represents a group header.
 */
export function isGroupHeader(value: string): boolean {
  return value.startsWith(GROUP_HEADER_PREFIX);
}

// ---------------------------------------------------------------------------
// Custom item renderer
// ---------------------------------------------------------------------------

function MenuListItem({
  item,
  isCursor,
  isDisabled,
}: {
  item: ListItem;
  isCursor: boolean;
  isDisabled: boolean;
}) {
  // Group header row
  if (isGroupHeader(item.value)) {
    return (
      <Box marginTop={item.value === `${GROUP_HEADER_PREFIX}START` ? 0 : 1}>
        <Text bold dimColor>
          {"  "}
          {item.label}
        </Text>
      </Box>
    );
  }

  // Regular menu item
  const cursor = isCursor ? "❯ " : "  ";
  const labelColor = isDisabled ? "gray" : isCursor ? "cyan" : undefined;

  return (
    <Box>
      <Text color={isCursor ? "cyan" : undefined}>{cursor}</Text>
      <Text color={labelColor} dimColor={isDisabled}>
        {item.label}
      </Text>
      {item.hint ? <Text dimColor> {item.hint}</Text> : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// MenuScreen component
// ---------------------------------------------------------------------------

export function MenuScreen({
  state,
  menuContext,
  onAction,
  isActive = true,
}: MenuScreenProps) {
  // Build menu items from pipeline state
  const menuItems = useMemo(
    () => buildMenuItems(state, menuContext),
    [state, menuContext],
  );

  // Build flat list items with group headers
  const listItems = useMemo(() => buildListItems(menuItems), [menuItems]);

  // Build hotkey map for single-key activation
  const hotkeyMap = useMemo(() => buildHotkeyMap(menuItems), [menuItems]);

  // Handle hotkey input (runs alongside SelectableList's own input handler)
  useInput(
    useCallback(
      (input: string, key) => {
        // Only handle plain character keys, not special keys
        if (key.ctrl || key.meta || key.shift) return;
        // Don't intercept arrow keys, enter, escape — let SelectableList handle those
        if (key.upArrow || key.downArrow || key.return || key.escape) return;

        const action = hotkeyMap.get(input);
        if (action) {
          onAction(action);
        }
      },
      [hotkeyMap, onAction],
    ),
    { isActive },
  );

  // Custom render function for SelectableList
  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <MenuListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // Handle selection from SelectableList (Enter key)
  const handleSelect = useCallback(
    (value: string) => {
      // Don't act on group headers (shouldn't happen since they're disabled)
      if (isGroupHeader(value)) return;
      onAction(value);
    },
    [onAction],
  );

  return (
    <Box flexDirection="column">
      <PipelineHeader state={state} />
      <Box marginTop={1}>
        <SelectableList
          items={listItems}
          onSelect={handleSelect}
          isActive={isActive}
          renderItem={renderItem}
        />
      </Box>
    </Box>
  );
}
