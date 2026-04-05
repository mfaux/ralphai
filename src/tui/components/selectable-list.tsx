/**
 * Selectable list component for the TUI.
 *
 * Renders a vertical list of items with keyboard navigation:
 * - Arrow keys (↑/↓) to move the cursor between items
 * - Enter to select the highlighted item
 * - Esc to go back / dismiss
 * - Cursor wraps around the list boundaries
 * - Disabled items are skipped during navigation
 * - Viewport scrolls to keep the cursor visible in long lists
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single item in the selectable list. */
export interface ListItem {
  /** Unique identifier for the item. */
  value: string;
  /** Display label. */
  label: string;
  /** Optional hint text shown after the label. */
  hint?: string;
  /** When true, the item is shown but cannot be selected or navigated to. */
  disabled?: boolean;
}

/** Props for the SelectableList component. */
export interface SelectableListProps {
  /** Items to display in the list. */
  items: ListItem[];
  /** Called when the user presses Enter on an enabled item. */
  onSelect?: (value: string) => void;
  /** Called when the user presses Escape. */
  onBack?: () => void;
  /** Maximum number of visible rows before scrolling kicks in. */
  viewportHeight?: number;
  /** Whether this component is actively receiving input. */
  isActive?: boolean;
  /** Initial cursor index (defaults to first enabled item). */
  initialIndex?: number;
}

// ---------------------------------------------------------------------------
// Navigation helpers (pure functions, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Find the next enabled item index in a given direction, wrapping around.
 *
 * Returns -1 if no enabled items exist.
 */
export function findNextEnabled(
  items: readonly Pick<ListItem, "disabled">[],
  current: number,
  direction: 1 | -1,
): number {
  const len = items.length;
  if (len === 0) return -1;

  let next = (((current + direction) % len) + len) % len;
  let steps = 0;

  while (steps < len) {
    if (!items[next]?.disabled) return next;
    next = (((next + direction) % len) + len) % len;
    steps++;
  }

  return -1; // all disabled
}

/**
 * Find the first enabled item index, starting from the given index.
 *
 * Returns -1 if no enabled items exist.
 */
export function findFirstEnabled(
  items: readonly Pick<ListItem, "disabled">[],
  startFrom = 0,
): number {
  const len = items.length;
  if (len === 0) return -1;

  const start = Math.max(0, Math.min(startFrom, len - 1));
  // Search forward from startFrom
  for (let i = 0; i < len; i++) {
    const idx = (start + i) % len;
    if (!items[idx]?.disabled) return idx;
  }
  return -1;
}

/**
 * Compute the scroll offset so the cursor stays within the viewport.
 *
 * Returns the index of the first visible item.
 */
export function computeScrollOffset(
  cursor: number,
  totalItems: number,
  viewportHeight: number,
  currentOffset: number,
): number {
  if (totalItems <= viewportHeight) return 0;

  let offset = currentOffset;

  // Cursor scrolled above viewport
  if (cursor < offset) {
    offset = cursor;
  }
  // Cursor scrolled below viewport
  else if (cursor >= offset + viewportHeight) {
    offset = cursor - viewportHeight + 1;
  }

  // Clamp
  return Math.max(0, Math.min(offset, totalItems - viewportHeight));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SelectableList({
  items,
  onSelect,
  onBack,
  viewportHeight = Infinity,
  isActive = true,
  initialIndex,
}: SelectableListProps): React.ReactNode {
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
      } else if (key.return) {
        const item = items[cursor];
        if (item && !item.disabled && onSelect) {
          onSelect(item.value);
        }
      } else if (key.escape) {
        onBack?.();
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
        const prefix = isCursor ? "❯ " : "  ";

        return (
          <Box key={item.value}>
            <Text
              dimColor={item.disabled === true}
              bold={isCursor && !item.disabled}
            >
              {prefix}
              {item.label}
              {item.hint ? ` ${item.hint}` : ""}
            </Text>
          </Box>
        );
      })}
      {showBottomIndicator && <Text dimColor> {"↓"} more</Text>}
    </Box>
  );
}
