/**
 * Checkbox list component for the TUI.
 *
 * Provides a multi-select list with:
 * - Arrow key navigation (up/down) with cursor wrapping
 * - Space to toggle individual items on/off
 * - Enter to confirm the current selection
 * - Esc to cancel
 * - Automatic skipping of disabled items during navigation
 * - Viewport scrolling for lists taller than the visible area
 * - "Select all / none" toggle via `a` key
 *
 * This is a pure selection component. It does not know about wizard steps
 * or option keys — the parent screen composes those concerns on top.
 *
 * Pure helpers are exported for unit testing:
 * - `toggleItem` — toggles a value in the selected set
 * - `toggleAll` — selects all or deselects all enabled items
 * - `checkboxKeyHandler` — maps key input to a CheckboxAction
 * - `checkboxReducer` — reduces an action into the next state
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";
import { findNextEnabled, computeViewport } from "./selectable-list.tsx";
import type { ListItem } from "./selectable-list.tsx";

// Re-export ListItem so consumers can import from this module directly
export type { ListItem } from "./selectable-list.tsx";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Internal state of the checkbox list. */
export interface CheckboxState {
  /** Current cursor position. */
  cursor: number;
  /** Set of currently selected item values. */
  selected: ReadonlySet<string>;
}

/** Props for the CheckboxList component. */
export interface CheckboxListProps {
  /** Items to display. Must have at least one enabled item. */
  items: readonly ListItem[];
  /** Called when the user presses Enter with the current selection. */
  onConfirm: (selected: string[]) => void;
  /** Called when the user presses Esc. */
  onCancel?: () => void;
  /** Initially selected item values. @default [] */
  defaultSelected?: readonly string[];
  /** Maximum visible rows before scrolling kicks in. @default Infinity */
  viewportHeight?: number;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
  /** Minimum number of items that must be selected. @default 0 */
  minSelected?: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Actions the checkbox list can process. */
export type CheckboxAction =
  | { type: "move"; direction: 1 | -1 }
  | { type: "toggle" }
  | { type: "toggle-all" }
  | { type: "confirm" }
  | { type: "cancel" };

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Toggle a value in the selected set.
 * Returns a new set with the value added or removed.
 */
export function toggleItem(
  selected: ReadonlySet<string>,
  value: string,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/**
 * Select all enabled items or deselect all, depending on current state.
 * If all enabled items are already selected, deselects all.
 * Otherwise, selects all enabled items.
 */
export function toggleAll(
  items: readonly ListItem[],
  selected: ReadonlySet<string>,
): ReadonlySet<string> {
  const enabledValues = items
    .filter((item) => !item.disabled)
    .map((item) => item.value);

  const allSelected = enabledValues.every((v) => selected.has(v));

  if (allSelected) {
    // Deselect all enabled items (keep any disabled selections, though unlikely)
    const next = new Set(selected);
    for (const v of enabledValues) {
      next.delete(v);
    }
    return next;
  }

  // Select all enabled items
  const next = new Set(selected);
  for (const v of enabledValues) {
    next.add(v);
  }
  return next;
}

/**
 * Map a key press to a CheckboxAction.
 *
 * Returns `null` for keys that are not handled.
 */
export function checkboxKeyHandler(
  input: string,
  key: Key,
): CheckboxAction | null {
  if (key.downArrow) return { type: "move", direction: 1 };
  if (key.upArrow) return { type: "move", direction: -1 };
  if (key.return) return { type: "confirm" };
  if (key.escape) return { type: "cancel" };

  // Space toggles the current item
  if (input === " " && !key.ctrl && !key.meta) return { type: "toggle" };

  // 'a' toggles all items
  if (input === "a" && !key.ctrl && !key.meta) return { type: "toggle-all" };

  return null;
}

/**
 * Apply a CheckboxAction to the current state.
 *
 * Pure reducer — returns the next state without mutating the input.
 * `confirm` and `cancel` are not handled here (they produce side effects
 * in the component via callbacks).
 *
 * `toggle` requires the items list to look up the item at the cursor.
 * `toggle-all` requires the items list to compute enabled items.
 * `move` requires the items list for cursor navigation.
 */
export function checkboxReducer(
  state: CheckboxState,
  action: CheckboxAction,
  items: readonly ListItem[],
): CheckboxState {
  switch (action.type) {
    case "move": {
      const startIdx =
        action.direction === 1 ? state.cursor + 1 : state.cursor - 1;
      const next = findNextEnabled(items, startIdx, action.direction);
      return next !== -1 ? { ...state, cursor: next } : state;
    }
    case "toggle": {
      const item = items[state.cursor];
      if (!item || item.disabled) return state;
      return {
        ...state,
        selected: toggleItem(state.selected, item.value),
      };
    }
    case "toggle-all": {
      return {
        ...state,
        selected: toggleAll(items, state.selected),
      };
    }
    case "confirm":
    case "cancel":
      // Side-effect actions — state unchanged; component handles callbacks
      return state;
  }
}

// ---------------------------------------------------------------------------
// Default item renderer
// ---------------------------------------------------------------------------

function DefaultCheckboxItem({
  item,
  isCursor,
  isSelected,
  isDisabled,
}: {
  item: ListItem;
  isCursor: boolean;
  isSelected: boolean;
  isDisabled: boolean;
}) {
  const cursor = isCursor ? "❯ " : "  ";
  const checkbox = isSelected ? "[x] " : "[ ] ";
  const labelColor = isDisabled ? "gray" : isCursor ? "cyan" : undefined;

  return (
    <Box>
      <Text color={isCursor ? "cyan" : undefined}>{cursor}</Text>
      <Text color={isSelected ? "green" : isDisabled ? "gray" : undefined}>
        {checkbox}
      </Text>
      <Text color={labelColor} dimColor={isDisabled}>
        {item.label}
      </Text>
      {item.hint ? <Text dimColor> {item.hint}</Text> : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// CheckboxList component
// ---------------------------------------------------------------------------

export function CheckboxList({
  items,
  onConfirm,
  onCancel,
  defaultSelected = [],
  viewportHeight = Infinity,
  isActive = true,
  minSelected = 0,
}: CheckboxListProps) {
  const initialIndex = useMemo(
    () => findNextEnabled(items, 0, 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [state, setState] = useState<CheckboxState>(() => ({
    cursor: initialIndex,
    selected: new Set(defaultSelected),
  }));

  // If items change and cursor is on a now-disabled item, snap to nearest enabled
  useEffect(() => {
    if (
      state.cursor < 0 ||
      state.cursor >= items.length ||
      items[state.cursor]?.disabled
    ) {
      const next = findNextEnabled(items, Math.max(0, state.cursor), 1);
      if (next !== -1) {
        setState((prev) => ({ ...prev, cursor: next }));
      }
    }
  }, [items, state.cursor]);

  const selectionCount = state.selected.size;
  const meetsMinimum = selectionCount >= minSelected;

  const handleInput = useCallback(
    (input: string, key: Key) => {
      const action = checkboxKeyHandler(input, key);
      if (!action) return;

      if (action.type === "confirm") {
        if (meetsMinimum) {
          onConfirm(Array.from(state.selected));
        }
        return;
      }

      if (action.type === "cancel") {
        onCancel?.();
        return;
      }

      setState((prev) => checkboxReducer(prev, action, items));
    },
    [items, state.selected, meetsMinimum, onConfirm, onCancel],
  );

  useInput(handleInput, { isActive });

  // Compute the visible slice
  const effectiveHeight = Math.max(1, viewportHeight);
  const viewport = computeViewport(items.length, state.cursor, effectiveHeight);
  const visibleItems = items.slice(viewport.start, viewport.end);

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, i) => {
        const absoluteIndex = viewport.start + i;
        const isCursor = absoluteIndex === state.cursor;
        const isDisabled = !!item.disabled;
        const isSelected = state.selected.has(item.value);

        return (
          <DefaultCheckboxItem
            key={item.value}
            item={item}
            isCursor={isCursor}
            isSelected={isSelected}
            isDisabled={isDisabled}
          />
        );
      })}

      <Box marginTop={0}>
        <Text dimColor>
          {"space toggle  a all  enter confirm  esc cancel"}
          {minSelected > 0 && !meetsMinimum ? `  (min ${minSelected})` : null}
        </Text>
      </Box>
    </Box>
  );
}
