/**
 * Selectable list component for the TUI.
 *
 * Provides keyboard-navigable list with:
 * - Arrow key navigation (↑/↓) with cursor wrapping
 * - Enter to select, Esc to go back
 * - Automatic skipping of disabled items
 * - Viewport scrolling for lists taller than the visible area
 *
 * This is a pure presentation + navigation component. It does not know
 * about menu groups, hotkeys, or pipeline state — the parent screen
 * composes those concerns on top.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single item in the selectable list. */
export interface ListItem {
  /** Unique key for the item. */
  value: string;
  /** Display text. */
  label: string;
  /** Optional secondary text shown after the label. */
  hint?: string;
  /** If true, the item is visible but cannot be selected. */
  disabled?: boolean;
}

export interface SelectableListProps {
  /** Items to display. Must have at least one enabled item. */
  items: readonly ListItem[];
  /** Called when the user presses Enter on an enabled item. */
  onSelect: (value: string) => void;
  /** Called when the user presses Escape. */
  onBack?: () => void;
  /** Maximum visible rows before scrolling kicks in. @default Infinity */
  viewportHeight?: number;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
  /**
   * Custom render function for each row. If omitted, the default renderer
   * is used (cursor indicator + label + hint).
   */
  renderItem?: (item: ListItem, props: ItemRenderProps) => React.ReactNode;
}

/** Props passed to a custom `renderItem` function. */
export interface ItemRenderProps {
  /** Whether this item currently has the cursor. */
  isCursor: boolean;
  /** Whether this item is disabled. */
  isDisabled: boolean;
}

// ---------------------------------------------------------------------------
// Navigation helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Find the first enabled item index at or after `startIndex`, wrapping
 * around if necessary. Returns -1 if no enabled item exists.
 */
export function findNextEnabled(
  items: readonly ListItem[],
  startIndex: number,
  direction: 1 | -1,
): number {
  const len = items.length;
  if (len === 0) return -1;

  for (let i = 0; i < len; i++) {
    const idx = (((startIndex + i * direction) % len) + len) % len;
    if (!items[idx]?.disabled) return idx;
  }
  return -1;
}

/**
 * Compute the viewport window [start, end) that keeps `cursorIndex`
 * visible within a viewport of `height` rows.
 */
export function computeViewport(
  totalItems: number,
  cursorIndex: number,
  height: number,
): { start: number; end: number } {
  if (height >= totalItems) {
    return { start: 0, end: totalItems };
  }
  // Keep cursor within the viewport, preferring to show context below
  let start = Math.max(0, cursorIndex - Math.floor(height / 2));
  if (start + height > totalItems) {
    start = totalItems - height;
  }
  return { start, end: start + height };
}

// ---------------------------------------------------------------------------
// Default item renderer
// ---------------------------------------------------------------------------

function DefaultItem({
  item,
  isCursor,
  isDisabled,
}: {
  item: ListItem;
  isCursor: boolean;
  isDisabled: boolean;
}) {
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
// SelectableList component
// ---------------------------------------------------------------------------

export function SelectableList({
  items,
  onSelect,
  onBack,
  viewportHeight = Infinity,
  isActive = true,
  renderItem,
}: SelectableListProps) {
  // Find the first enabled item for initial cursor position
  const initialIndex = useMemo(
    () => findNextEnabled(items, 0, 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [cursorIndex, setCursorIndex] = useState(initialIndex);

  // If items change and cursor is on a now-disabled item, snap to nearest enabled
  useEffect(() => {
    if (
      cursorIndex < 0 ||
      cursorIndex >= items.length ||
      items[cursorIndex]?.disabled
    ) {
      const next = findNextEnabled(items, Math.max(0, cursorIndex), 1);
      if (next !== -1) setCursorIndex(next);
    }
  }, [items, cursorIndex]);

  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (key.downArrow) {
        setCursorIndex((prev) => {
          const next = findNextEnabled(items, prev + 1, 1);
          return next !== -1 ? next : prev;
        });
        return;
      }

      if (key.upArrow) {
        setCursorIndex((prev) => {
          const next = findNextEnabled(items, prev - 1, -1);
          return next !== -1 ? next : prev;
        });
        return;
      }

      if (key.return) {
        const item = items[cursorIndex];
        if (item && !item.disabled) {
          onSelect(item.value);
        }
        return;
      }

      if (key.escape && onBack) {
        onBack();
        return;
      }
    },
    [items, cursorIndex, onSelect, onBack],
  );

  useInput(handleInput, { isActive });

  // Compute the visible slice
  const effectiveHeight = Math.max(1, viewportHeight);
  const viewport = computeViewport(items.length, cursorIndex, effectiveHeight);

  const visibleItems = items.slice(viewport.start, viewport.end);

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, i) => {
        const absoluteIndex = viewport.start + i;
        const isCursor = absoluteIndex === cursorIndex;
        const isDisabled = !!item.disabled;

        if (renderItem) {
          return (
            <Box key={item.value}>
              {renderItem(item, { isCursor, isDisabled })}
            </Box>
          );
        }

        return (
          <DefaultItem
            key={item.value}
            item={item}
            isCursor={isCursor}
            isDisabled={isDisabled}
          />
        );
      })}
    </Box>
  );
}
