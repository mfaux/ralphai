/**
 * Checkbox list component for the TUI.
 *
 * Renders a vertical multi-select list with keyboard navigation:
 * - Arrow keys (↑/↓) to move the cursor between items
 * - Space to toggle the checked state of the highlighted item
 * - Enter to confirm the current selection (returns all checked values)
 * - Esc to cancel / go back
 * - `a` to toggle all items on/off
 * - Cursor wraps around the list boundaries
 * - Disabled items are skipped during navigation and cannot be toggled
 * - Viewport scrolls to keep the cursor visible in long lists
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";

import {
  findNextEnabled,
  findFirstEnabled,
  computeScrollOffset,
} from "./selectable-list.tsx";

// Re-export shared helpers so callers can import from either module
export { findNextEnabled, findFirstEnabled, computeScrollOffset };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single item in the checkbox list. */
export interface CheckboxItem {
  /** Unique identifier for the item. */
  value: string;
  /** Display label. */
  label: string;
  /** Optional hint text shown after the label. */
  hint?: string;
  /** When true, the item is shown but cannot be toggled or navigated to. */
  disabled?: boolean;
}

/** Props for the CheckboxList component. */
export interface CheckboxListProps {
  /** Items to display in the list. */
  items: CheckboxItem[];
  /** Values that should be initially checked. */
  initialChecked?: readonly string[];
  /** Called when the user presses Enter to confirm their selection. */
  onConfirm?: (selectedValues: string[]) => void;
  /** Called when the user presses Escape to cancel. */
  onCancel?: () => void;
  /** Maximum number of visible rows before scrolling kicks in. */
  viewportHeight?: number;
  /** Whether this component is actively receiving input. */
  isActive?: boolean;
  /** Initial cursor index (defaults to first enabled item). */
  initialIndex?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Toggle a value in a checked set.
 *
 * Returns a new Set with the value added if it was absent, or removed if
 * it was present.
 */
export function toggleChecked(
  checked: ReadonlySet<string>,
  value: string,
): Set<string> {
  const next = new Set(checked);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/**
 * Toggle all enabled items.
 *
 * If all enabled items are currently checked, uncheck them all.
 * Otherwise, check all enabled items (additive — already-checked
 * disabled items stay checked).
 */
export function toggleAll(
  items: readonly Pick<CheckboxItem, "value" | "disabled">[],
  checked: ReadonlySet<string>,
): Set<string> {
  const enabledValues = items
    .filter((item) => !item.disabled)
    .map((item) => item.value);

  const allChecked = enabledValues.every((v) => checked.has(v));

  const next = new Set(checked);
  if (allChecked) {
    // Uncheck all enabled items
    for (const v of enabledValues) {
      next.delete(v);
    }
  } else {
    // Check all enabled items
    for (const v of enabledValues) {
      next.add(v);
    }
  }
  return next;
}

/**
 * Get the ordered list of checked values, preserving the item order.
 */
export function getOrderedSelections(
  items: readonly Pick<CheckboxItem, "value">[],
  checked: ReadonlySet<string>,
): string[] {
  return items
    .filter((item) => checked.has(item.value))
    .map((item) => item.value);
}

/**
 * Build the checkbox indicator for an item.
 *
 * Returns `[✓]` for checked items and `[ ]` for unchecked items.
 */
export function checkboxIndicator(isChecked: boolean): string {
  return isChecked ? "[✓]" : "[ ]";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CheckboxList({
  items,
  initialChecked = [],
  onConfirm,
  onCancel,
  viewportHeight = Infinity,
  isActive = true,
  initialIndex,
}: CheckboxListProps): React.ReactNode {
  const startIndex = useMemo(
    () =>
      initialIndex !== undefined
        ? findFirstEnabled(items, initialIndex)
        : findFirstEnabled(items),
    // Only compute on mount — items identity changes are handled by the
    // parent re-keying the component if the item set fundamentally changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [cursor, setCursor] = useState(Math.max(0, startIndex));
  const [scrollOffset, setScrollOffset] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialChecked),
  );

  const effectiveViewport = Math.min(viewportHeight, items.length);

  const moveCursor = useCallback(
    (direction: 1 | -1) => {
      setCursor((prev) => {
        const next = findNextEnabled(items, prev, direction);
        if (next === -1) return prev;

        setScrollOffset((prevOffset) =>
          computeScrollOffset(
            next,
            items.length,
            effectiveViewport,
            prevOffset,
          ),
        );
        return next;
      });
    },
    [items, effectiveViewport],
  );

  useInput(
    (input, key) => {
      if (key.upArrow) {
        moveCursor(-1);
      } else if (key.downArrow) {
        moveCursor(1);
      } else if (input === " " && !key.ctrl && !key.meta) {
        // Space → toggle checked state of current item
        const item = items[cursor];
        if (item && !item.disabled) {
          setChecked((prev) => toggleChecked(prev, item.value));
        }
      } else if (input === "a" && !key.ctrl && !key.meta) {
        // 'a' → toggle all enabled items
        setChecked((prev) => toggleAll(items, prev));
      } else if (key.return) {
        onConfirm?.(getOrderedSelections(items, checked));
      } else if (key.escape) {
        onCancel?.();
      }
    },
    { isActive },
  );

  // Determine visible slice
  const visibleItems =
    items.length <= effectiveViewport
      ? items.map((item, i) => ({ item, index: i }))
      : items
          .slice(scrollOffset, scrollOffset + effectiveViewport)
          .map((item, i) => ({ item, index: scrollOffset + i }));

  const showTopIndicator = scrollOffset > 0;
  const showBottomIndicator =
    items.length > effectiveViewport &&
    scrollOffset + effectiveViewport < items.length;

  return (
    <Box flexDirection="column">
      {showTopIndicator && <Text dimColor> {"↑"} more</Text>}
      {visibleItems.map(({ item, index }) => {
        const isCursor = index === cursor;
        const isChecked = checked.has(item.value);
        const prefix = isCursor ? "❯ " : "  ";
        const indicator = checkboxIndicator(isChecked);

        return (
          <Box key={item.value}>
            <Text
              dimColor={item.disabled === true}
              bold={isCursor && !item.disabled}
            >
              {prefix}
              {indicator} {item.label}
              {item.hint ? ` ${item.hint}` : ""}
            </Text>
          </Box>
        );
      })}
      {showBottomIndicator && <Text dimColor> {"↓"} more</Text>}
    </Box>
  );
}
