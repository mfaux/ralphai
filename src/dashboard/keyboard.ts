/**
 * useKeyboardRouting — single useInput handler that routes keys
 * based on the current FocusTarget and overlay state.
 *
 * Option B layout: list focus + detail overlay (no panel cycling).
 */

import { useInput } from "ink";
import type { DetailTab } from "./types.ts";
import type { useAppState } from "./app-state.ts";

type AppState = ReturnType<typeof useAppState>;

export function useKeyboardRouting(state: AppState, exit: () => void) {
  const {
    focus,
    setFocus,
    displayPlans,
    selectedPlan,
    moveCursor,
    switchRepo,
    activeTab,
    setActiveTab,
    scrollOffset,
    setScrollOffset,
    followTail,
    setFollowTail,
    contentHeight,
    showDetail,
    openDetail,
    closeDetail,
    overlay,
    setOverlay,
    filterQuery,
    setFilterQuery,
    handleAction,
    handleConfirm,
    openActionMenu,
  } = state;

  useInput((input, key) => {
    // --- Confirm dialog ---
    if (overlay.kind === "confirm") {
      if (input === "y" || input === "Y") {
        handleConfirm(true);
      } else if (input === "n" || input === "N" || key.escape) {
        handleConfirm(false);
      }
      return;
    }

    // --- Help overlay ---
    if (overlay.kind === "help") {
      if (input === "?" || key.escape) {
        setOverlay({ kind: "none" });
        setFocus("list");
      }
      return;
    }

    // --- Action menu ---
    if (overlay.kind === "menu") {
      if (key.escape) {
        setOverlay({ kind: "none" });
        setFocus(showDetail ? "detail" : "list");
        return;
      }
      if (key.upArrow) {
        setOverlay((prev) => {
          if (prev.kind !== "menu") return prev;
          return { ...prev, cursor: Math.max(0, prev.cursor - 1) };
        });
        return;
      }
      if (key.downArrow) {
        setOverlay((prev) => {
          if (prev.kind !== "menu") return prev;
          return {
            ...prev,
            cursor: Math.min(prev.items.length - 1, prev.cursor + 1),
          };
        });
        return;
      }
      if (key.return) {
        if (overlay.items.length > 0) {
          const selected = overlay.items[overlay.cursor];
          if (selected) handleAction(selected.action);
        }
        return;
      }
      return;
    }

    // --- Filter mode ---
    if (focus === "filter") {
      if (key.escape) {
        setFilterQuery("");
        setFocus("list");
        return;
      }
      if (key.return) {
        setFocus("list");
        return;
      }
      if (key.backspace || key.delete) {
        setFilterQuery((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFilterQuery((prev) => prev + input);
      }
      return;
    }

    // --- Global keys (both list and detail focus) ---
    if (input === "q" && focus === "list") {
      exit();
      return;
    }
    if (input === "?") {
      setOverlay({ kind: "help" });
      setFocus("help");
      return;
    }

    // --- Detail overlay focus ---
    if (focus === "detail") {
      if (key.escape) {
        closeDetail();
        return;
      }
      if (key.upArrow) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setScrollOffset((prev) => prev + 1);
        return;
      }
      if (key.pageUp) {
        setScrollOffset((prev) => Math.max(0, prev - contentHeight));
        return;
      }
      if (key.pageDown) {
        setScrollOffset((prev) => prev + contentHeight);
        return;
      }
      if (key.leftArrow) {
        cycleTabs(setActiveTab, setScrollOffset, -1);
        return;
      }
      if (key.rightArrow) {
        cycleTabs(setActiveTab, setScrollOffset, 1);
        return;
      }
      if (input === "s") {
        setActiveTab("summary");
        setScrollOffset(0);
        return;
      }
      if (input === "p") {
        setActiveTab("plan");
        setScrollOffset(0);
        return;
      }
      if (input === "g") {
        setActiveTab("progress");
        setScrollOffset(0);
        return;
      }
      if (input === "o") {
        setActiveTab("output");
        setScrollOffset(0);
        return;
      }
      if (input === "f") {
        setFollowTail((prev) => !prev);
        return;
      }
      if (input === "a" || key.return) {
        openActionMenu();
        return;
      }
      return;
    }

    // --- List focus ---
    if (key.escape) return;

    if (key.upArrow) {
      moveCursor(-1, displayPlans.length);
      return;
    }
    if (key.downArrow) {
      moveCursor(1, displayPlans.length);
      return;
    }

    if (key.return) {
      openDetail();
      return;
    }

    if (input === "a") {
      openActionMenu();
      return;
    }

    // [ / ] switch repos
    if (input === "[") {
      switchRepo(-1);
      return;
    }
    if (input === "]") {
      switchRepo(1);
      return;
    }

    if (input === "/") {
      setFocus("filter");
      return;
    }
  });
}

// --- Helpers ---

const TAB_ORDER: DetailTab[] = ["summary", "plan", "progress", "output"];

function cycleTabs(
  setActiveTab: (fn: (prev: DetailTab) => DetailTab) => void,
  setScrollOffset: (n: number) => void,
  delta: 1 | -1,
) {
  setActiveTab((prev) => {
    const idx = TAB_ORDER.indexOf(prev);
    return TAB_ORDER[(idx + delta + TAB_ORDER.length) % TAB_ORDER.length]!;
  });
  setScrollOffset(0);
}
