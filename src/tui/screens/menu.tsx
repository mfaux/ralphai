/**
 * Main menu screen for the TUI.
 *
 * Composes the `SelectableList` component with `buildMenuItems()` data,
 * rendering grouped menu items under START / MANAGE / TOOLS headers.
 * Disabled items are dimmed and cannot be selected. Each enabled item
 * shows a cursor indicator (❯) when highlighted.
 *
 * On wide terminals (≥120 columns), a contextual detail pane is shown
 * alongside the menu via `SplitLayout`, displaying information relevant
 * to the currently highlighted item.
 *
 * The screen also handles single-key hotkeys: when the menu is active,
 * pressing a hotkey letter fires the corresponding action immediately
 * without requiring arrow-key navigation.
 */

import { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";

import type { PipelineState } from "../../pipeline-state.ts";
import type { MenuItem, MenuGroup, MenuContext } from "../menu-items.ts";
import { buildMenuItems, isPipelineEmpty } from "../menu-items.ts";
import type { ResolvedConfig } from "../../config.ts";
import { SplitLayout } from "../components/split-layout.tsx";
import type { SplitLayoutProps } from "../components/split-layout.tsx";
import { DetailPane } from "../components/detail-pane.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MenuScreenProps {
  /** Current pipeline state, or null while loading. */
  state: PipelineState | null;
  /** `true` while pipeline state is being gathered. */
  loading?: boolean;
  /** Extra context for menu item construction. */
  menuContext?: MenuContext;
  /** Resolved config for the settings detail pane content. */
  resolvedConfig?: ResolvedConfig;
  /** Called when the user selects a menu item (via Enter or hotkey). */
  onAction: (action: string) => void;
  /** Whether this screen is active (receives keyboard input). @default true */
  isActive?: boolean;
  /**
   * Options for the terminal size hook used by SplitLayout.
   * Override in tests to inject a fake terminal size.
   */
  terminalSizeOptions?: SplitLayoutProps["terminalSizeOptions"];
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

/**
 * Extra indentation applied to regular menu items so they appear
 * visually nested under their group headers.
 */
export const ITEM_INDENT = "  ";

// ---------------------------------------------------------------------------
// Empty state hint
// ---------------------------------------------------------------------------

/**
 * Hint lines shown when the pipeline is completely empty.
 * Guides the user toward getting started with ralphai.
 */
export const EMPTY_STATE_HINTS = [
  "Add .md plans to ./backlog/ to begin, or pick an issue from GitHub.",
  'Run "ralphai init" to set up your project configuration.',
] as const;

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

  // Regular menu item — indented under its group header
  const cursor = isCursor ? "❯ " : "  ";
  const labelColor = isDisabled ? "gray" : isCursor ? "cyan" : undefined;

  return (
    <Box>
      <Text color={isCursor ? "cyan" : undefined}>
        {ITEM_INDENT}
        {cursor}
      </Text>
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
  loading = false,
  menuContext,
  resolvedConfig,
  onAction,
  isActive = true,
  terminalSizeOptions,
}: MenuScreenProps) {
  // Build menu items from pipeline state (use empty state while loading)
  const effectiveState: PipelineState = state ?? {
    backlog: [],
    inProgress: [],
    completedSlugs: [],
    worktrees: [],
    problems: [],
  };

  // Detect empty pipeline (not loading, state available, all sections empty)
  const pipelineEmpty = state !== null && isPipelineEmpty(effectiveState);

  const menuItems = useMemo(
    () => buildMenuItems(effectiveState, menuContext),
    [effectiveState, menuContext],
  );

  // Build flat list items with group headers
  const listItems = useMemo(() => buildListItems(menuItems), [menuItems]);

  // Build hotkey map for single-key activation
  const hotkeyMap = useMemo(() => buildHotkeyMap(menuItems), [menuItems]);

  // Track the currently highlighted menu item value for the detail pane
  const [highlightedValue, setHighlightedValue] = useState<string>("");

  // Handle cursor changes from SelectableList
  const handleCursorChange = useCallback((value: string) => {
    setHighlightedValue(value);
  }, []);

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

  // Left pane: the menu content (optional hint + selectable list)
  const menuContent = (
    <Box flexDirection="column">
      {pipelineEmpty ? (
        <Box flexDirection="column">
          {EMPTY_STATE_HINTS.map((hint, i) => (
            <Text key={i} dimColor>
              {hint}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={pipelineEmpty ? 1 : 0}>
        <SelectableList
          items={listItems}
          onSelect={handleSelect}
          onCursorChange={handleCursorChange}
          isActive={isActive}
          renderItem={renderItem}
        />
      </Box>
    </Box>
  );

  // Right pane: the contextual detail pane
  const detailContent = (
    <DetailPane
      highlightedValue={highlightedValue}
      state={state}
      stateLoading={loading}
      menuContext={menuContext}
      resolvedConfig={resolvedConfig}
    />
  );

  return (
    <SplitLayout
      left={menuContent}
      right={detailContent}
      terminalSizeOptions={terminalSizeOptions}
    />
  );
}
