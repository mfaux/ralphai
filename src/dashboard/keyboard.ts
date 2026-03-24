/**
 * useKeyboardRouting — single useInput handler that routes keys
 * based on the current FocusTarget and overlay state.
 */

import { useInput } from "ink";
import type { DetailTab, PanelId, PlanInfo, WorktreeInfo } from "./types.ts";
import type { Overlay } from "./app-state.ts";
import type { useAppState } from "./app-state.ts";
import type { RepoSummary } from "../global-state.ts";

type AppState = ReturnType<typeof useAppState>;

export function useKeyboardRouting(state: AppState, exit: () => void) {
  const {
    panelNav,
    activePanel,
    focus,
    setFocus,
    repos,
    setSelectedRepoIdx,
    displayPlans,
    worktrees,
    selectedPlan,
    activeTab,
    setActiveTab,
    scrollOffset,
    setScrollOffset,
    followTail,
    setFollowTail,
    contentHeight,
    overlay,
    setOverlay,
    filterQuery,
    setFilterQuery,
    handleAction,
    handleConfirm,
    openActionMenu,
  } = state;

  const { moveCursor, setActivePanel, cyclePanels, getCursor } = panelNav;

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
        setFocus("panel");
      }
      return;
    }

    // --- Action menu ---
    if (overlay.kind === "menu") {
      if (key.escape) {
        setOverlay({ kind: "none" });
        setFocus("panel");
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
        setFocus("panel");
        return;
      }
      if (key.return) {
        setFocus("panel");
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

    // --- Global keys ---
    if (input === "q") {
      exit();
      return;
    }
    if (input === "?") {
      setOverlay({ kind: "help" });
      setFocus("help");
      return;
    }
    if (input === "1") {
      setActivePanel("repos");
      setFocus("panel");
      return;
    }
    if (input === "2") {
      setActivePanel("pipeline");
      setFocus("panel");
      return;
    }
    if (input === "3") {
      setActivePanel("worktrees");
      setFocus("panel");
      return;
    }

    // --- Detail focus ---
    if (focus === "detail") {
      if (key.escape) {
        setFocus("panel");
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
      if (key.return) {
        openActionMenu();
        return;
      }
      return;
    }

    // --- Panel focus ---
    if (key.escape) return;

    if (key.tab) {
      cyclePanels(key.shift ? -1 : 1);
      return;
    }

    if (key.upArrow) {
      const len = listLengthForPanel(
        activePanel,
        repos,
        displayPlans,
        worktrees,
      );
      moveCursor(-1, len);
      return;
    }
    if (key.downArrow) {
      const len = listLengthForPanel(
        activePanel,
        repos,
        displayPlans,
        worktrees,
      );
      moveCursor(1, len);
      return;
    }

    if (key.return) {
      if (activePanel === "repos" && repos.length > 0) {
        const repoIdx = getCursor("repos");
        setSelectedRepoIdx(repoIdx);
        setActivePanel("pipeline");
        return;
      }
      openActionMenu();
      return;
    }

    if (input === "l" || key.rightArrow) {
      if (selectedPlan) setFocus("detail");
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

function listLengthForPanel(
  panel: PanelId,
  repos: RepoSummary[],
  plans: PlanInfo[],
  worktrees: WorktreeInfo[],
): number {
  switch (panel) {
    case "repos":
      return repos.length;
    case "pipeline":
      return plans.length;
    case "worktrees":
      return worktrees.length;
  }
}
