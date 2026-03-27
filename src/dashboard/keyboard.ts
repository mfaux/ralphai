/**
 * useKeyboardRouting -- single useInput handler that routes keys
 * based on the current FocusTarget and overlay state.
 *
 * Pane navigation: `1` RepoBar, `2` Pipeline, `3` Detail (when open).
 * Tab cycles forward through panes, Shift+Tab cycles backward.
 * When the detail pane is not open, `3` and Tab skip past it.
 * Arrow keys navigate within the focused pane only.
 */

import { useInput } from "ink";
import type { DetailTab, FocusTarget } from "./types.ts";
import { PANE_ORDER } from "./types.ts";
import type { useAppState } from "./app-state.ts";

type AppState = ReturnType<typeof useAppState>;

/** Map number keys to pane focus targets. */
const PANE_BY_NUMBER: Record<string, FocusTarget> = {
  "1": "repo",
  "2": "list",
  "3": "detail",
};

/**
 * Cycle to the next/prev pane, skipping "detail" when it is not available.
 */
function cyclePane(
  current: FocusTarget,
  delta: 1 | -1,
  detailAvailable: boolean,
): FocusTarget {
  const order = detailAvailable
    ? PANE_ORDER
    : PANE_ORDER.filter((p) => p !== "detail");
  const idx = order.indexOf(current);
  if (idx < 0) return order[0]!;
  return order[(idx + delta + order.length) % order.length]!;
}

export function useKeyboardRouting(state: AppState, exit: () => void) {
  const {
    focus,
    setFocus,
    repos,
    displayPlans,
    selectedPlan,
    moveCursor,
    openRepoSelect,
    selectRepo,
    cycleRepo,
    activeTab,
    setActiveTab,
    scrollOffset,
    setScrollOffset,
    contentHeight,
    showDetail,
    openDetail,
    closeDetail,
    isSplitMode,
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

    // --- Repo selector dropdown overlay ---
    if (overlay.kind === "repoSelect") {
      if (key.escape) {
        setOverlay({ kind: "none" });
        setFocus("repo");
        return;
      }
      if (key.upArrow) {
        setOverlay((prev) => {
          if (prev.kind !== "repoSelect") return prev;
          return { ...prev, cursor: Math.max(0, prev.cursor - 1) };
        });
        return;
      }
      if (key.downArrow) {
        setOverlay((prev) => {
          if (prev.kind !== "repoSelect") return prev;
          return {
            ...prev,
            cursor: Math.min(repos.length - 1, prev.cursor + 1),
          };
        });
        return;
      }
      if (key.return) {
        selectRepo(overlay.cursor);
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

    // --- Global keys (available from repo, list, and detail focus) ---
    if (input === "q" && (focus === "list" || focus === "repo")) {
      exit();
      return;
    }
    if (input === "?") {
      setOverlay({ kind: "help" });
      setFocus("help");
      return;
    }

    // --- Pane switching (number keys and Tab) ---
    // Works from any non-overlay focus. "3" / detail is only reachable
    // when the split pane is open; otherwise it is skipped.
    if (input && PANE_BY_NUMBER[input]) {
      const target = PANE_BY_NUMBER[input]!;
      // "3" (detail) is only valid when split is open
      if (target === "detail" && !showDetail) {
        // Pressing 3 with no detail open: open detail in split mode
        openDetail();
        return;
      }
      setFocus(target);
      return;
    }

    if (key.tab) {
      const next = key.shift
        ? cyclePane(focus, -1, showDetail)
        : cyclePane(focus, 1, showDetail);
      setFocus(next);
      return;
    }

    // --- Detail pane focus ---
    if (focus === "detail") {
      if (key.escape) {
        // Split mode: Esc returns focus to list (split stays open).
        // Overlay mode: Esc closes the overlay entirely.
        if (isSplitMode) {
          setFocus("list");
        } else {
          closeDetail();
        }
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
      if (input === "a" || key.return) {
        openActionMenu();
        return;
      }
      return;
    }

    // --- Repo bar focus ---
    if (focus === "repo") {
      if (key.upArrow) {
        cycleRepo(-1);
        return;
      }
      if (key.downArrow) {
        cycleRepo(1);
        return;
      }
      if (key.return) {
        openRepoSelect();
        return;
      }
      return;
    }

    // --- List focus ---
    if (key.escape) {
      // If split is open, Esc from list closes the split.
      if (showDetail) {
        closeDetail();
      }
      return;
    }

    if (key.upArrow) {
      moveCursor(-1, displayPlans.length);
      return;
    }
    if (key.downArrow) {
      moveCursor(1, displayPlans.length);
      return;
    }

    if (key.return) {
      // If split is already open, Enter opens action menu (plan is visible).
      // If split is closed, Enter opens detail.
      if (showDetail) {
        openActionMenu();
      } else {
        openDetail();
      }
      return;
    }

    if (input === "a") {
      openActionMenu();
      return;
    }

    // Direct action hotkeys (state-gated)
    if (input === "r" && selectedPlan?.state === "backlog") {
      handleAction("run");
      return;
    }
    if (input === "R" && selectedPlan?.state === "in-progress") {
      handleAction("reset");
      return;
    }
    if (input === "P" && selectedPlan?.state === "completed") {
      handleAction("purge");
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
