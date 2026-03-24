/**
 * useAppState — core state management hook for the dashboard.
 *
 * Manages: data loading (repos, plans, worktrees), selection tracking,
 * overlay state, toast messages, filter state, and action/confirm handlers.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import type { RepoSummary } from "../global-state.ts";
import type {
  PanelId,
  FocusTarget,
  DetailTab,
  PlanInfo,
  ActionMenuItem,
  WorktreeInfo,
} from "./types.ts";
import {
  loadRepos,
  loadPlans,
  loadWorktrees,
  loadPlanContent,
  loadProgressContent,
  loadOutputTail,
} from "./data.ts";
import { useAutoRefresh, filterPlans, usePanelNavigation } from "./hooks.ts";
import { defaultTabForState } from "./DetailPane.tsx";
import { buildMenuItems } from "./ActionMenu.tsx";
import {
  spawnRunner,
  spawnWorktreeRunner,
  resetPlan,
  purgePlan,
  removeWorktree,
} from "./actions.ts";

const REFRESH_MS = 3000;

/** Height reserved for status bar + panel border chrome (2 rows per panel × 3 panels + 1 status bar). */
export const CHROME_ROWS = 9;

/** Overlay types for the modal stack. */
export type Overlay =
  | { kind: "none" }
  | { kind: "menu"; items: ActionMenuItem[]; cursor: number; title: string }
  | { kind: "confirm"; action: string; slug: string }
  | { kind: "help" };

export function useAppState(termRows: number) {
  // --- Panel navigation ---
  const panelNav = usePanelNavigation();
  const { activePanel, setActivePanel, getCursor } = panelNav;

  // --- Focus target ---
  const [focus, setFocus] = useState<FocusTarget>("panel");

  // --- Selected repo ---
  const [selectedRepoIdx, setSelectedRepoIdx] = useState(0);

  // --- Detail state ---
  const [activeTab, setActiveTab] = useState<DetailTab>("summary");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [followTail, setFollowTail] = useState(false);

  // --- Overlay ---
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });

  // --- Toast ---
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // --- Filter ---
  const [filterQuery, setFilterQuery] = useState("");

  // --- Data loading ---
  const repoLoader = useCallback(() => loadRepos(), []);
  const { data: repos } = useAutoRefresh(repoLoader, REFRESH_MS);

  const selectedRepo: RepoSummary | null =
    repos[selectedRepoIdx] ?? repos[0] ?? null;

  const planLoader = useCallback(
    () => (selectedRepo?.repoPath ? loadPlans(selectedRepo.repoPath) : []),
    [selectedRepo?.repoPath],
  );
  const { data: plans } = useAutoRefresh<PlanInfo[]>(planLoader, REFRESH_MS);

  const worktreeLoader = useCallback(
    () =>
      selectedRepo?.repoPath ? loadWorktrees(selectedRepo.repoPath, plans) : [],
    [selectedRepo?.repoPath, plans],
  );
  const { data: worktrees } = useAutoRefresh<WorktreeInfo[]>(
    worktreeLoader,
    REFRESH_MS,
  );

  // --- Filter plans ---
  const filterActive = filterQuery.trim().length > 0;
  const displayPlans = useMemo(
    () => filterPlans(plans, filterQuery),
    [plans, filterQuery],
  );

  // --- Derived selections ---
  const pipelineCursor = getCursor("pipeline");
  const selectedPlan: PlanInfo | null = displayPlans[pipelineCursor] ?? null;
  const worktreeCursor = getCursor("worktrees");
  const selectedWorktree: WorktreeInfo | null =
    worktrees[worktreeCursor] ?? null;

  // --- Detail content ---
  const planContent = useMemo(
    () =>
      selectedPlan && selectedRepo?.repoPath
        ? loadPlanContent(selectedRepo.repoPath, selectedPlan)
        : null,
    [selectedPlan?.slug, selectedPlan?.state, selectedRepo?.repoPath],
  );

  // Progress and output poll on the refresh interval so live updates appear.
  const progressLoader = useCallback(
    () =>
      selectedPlan && selectedRepo?.repoPath
        ? loadProgressContent(selectedRepo.repoPath, selectedPlan)
        : null,
    [selectedPlan?.slug, selectedPlan?.state, selectedRepo?.repoPath],
  );
  const { data: progressContent } = useAutoRefresh(progressLoader, REFRESH_MS);

  const outputLoader = useCallback(
    () =>
      selectedPlan && selectedRepo?.repoPath
        ? loadOutputTail(selectedRepo.repoPath, selectedPlan)
        : null,
    [selectedPlan?.slug, selectedPlan?.state, selectedRepo?.repoPath],
  );
  const { data: outputData } = useAutoRefresh(outputLoader, REFRESH_MS);

  // Detail pane content area: terminal height minus status bar (1),
  // detail border chrome (2), title row (1), tab bar (1), content margin (1).
  const contentHeight = Math.max(5, termRows - 6);

  // --- Auto-set default tab when plan selection changes ---
  useEffect(() => {
    if (selectedPlan) {
      setActiveTab(defaultTabForState(selectedPlan.state));
      setScrollOffset(0);
      setFollowTail(false);
    }
  }, [selectedPlan?.slug]);

  // --- Follow-tail: auto-scroll output ---
  useEffect(() => {
    if (followTail && activeTab === "output" && outputData) {
      const total = outputData.content.split("\n").length;
      setScrollOffset(Math.max(0, total - contentHeight));
    }
  }, [followTail, activeTab, outputData?.content, contentHeight]);

  // --- Action handler ---
  const handleAction = useCallback(
    (action: string) => {
      setOverlay({ kind: "none" });

      switch (action) {
        case "select-repo": {
          const repoIdx = getCursor("repos");
          setSelectedRepoIdx(repoIdx);
          setActivePanel("pipeline");
          break;
        }
        case "view-plan":
          setActiveTab("plan");
          setFocus("detail");
          break;
        case "view-progress":
          setActiveTab("progress");
          setFocus("detail");
          break;
        case "view-output":
          setActiveTab("output");
          setFocus("detail");
          break;
        case "view-summary":
          setActiveTab("summary");
          setFocus("detail");
          break;
        case "view-linked-plan": {
          if (selectedWorktree?.linkedPlan) {
            const idx = displayPlans.findIndex(
              (p) => p.slug === selectedWorktree.linkedPlan,
            );
            if (idx >= 0) {
              setActivePanel("pipeline");
              showToast(`Linked: ${selectedWorktree.linkedPlan}`);
            } else {
              showToast("Linked plan not in current view");
            }
          }
          break;
        }
        case "run":
        case "run-worktree": {
          if (!selectedPlan || !selectedRepo?.repoPath) {
            showToast("No plan or repo selected");
            break;
          }
          if (action === "run") {
            const pid = spawnRunner(selectedRepo.repoPath, selectedPlan.slug);
            showToast(
              pid
                ? `Started runner for ${selectedPlan.slug} (pid ${pid})`
                : `Failed to start runner for ${selectedPlan.slug}`,
            );
          } else {
            const pid = spawnWorktreeRunner(
              selectedRepo.repoPath,
              selectedPlan.slug,
            );
            showToast(
              pid
                ? `Started worktree runner for ${selectedPlan.slug} (pid ${pid})`
                : `Failed to start worktree runner for ${selectedPlan.slug}`,
            );
          }
          break;
        }
        case "reset":
        case "purge":
        case "remove-worktree":
          if (
            action === "reset" ||
            action === "purge" ||
            action === "remove-worktree"
          ) {
            const slug =
              action === "remove-worktree"
                ? (selectedWorktree?.shortBranch ?? "")
                : (selectedPlan?.slug ?? "");
            setOverlay({ kind: "confirm", action, slug });
            setFocus("menu");
          }
          break;
        default:
          showToast(`Unknown action: ${action}`);
      }
    },
    [
      getCursor,
      selectedPlan,
      selectedWorktree,
      displayPlans,
      setActivePanel,
      showToast,
    ],
  );

  // --- Confirm handler ---
  const handleConfirm = useCallback(
    (confirmed: boolean) => {
      if (overlay.kind !== "confirm") return;
      if (confirmed && selectedRepo?.repoPath) {
        const { action, slug } = overlay;
        let success = false;
        switch (action) {
          case "reset":
            success = resetPlan(selectedRepo.repoPath, slug);
            showToast(
              success ? `Reset ${slug} to backlog` : `Failed to reset ${slug}`,
            );
            break;
          case "purge":
            success = purgePlan(selectedRepo.repoPath, slug);
            showToast(success ? `Purged ${slug}` : `Failed to purge ${slug}`);
            break;
          case "remove-worktree": {
            const wt = worktrees.find((w) => w.shortBranch === slug);
            if (wt) {
              success = removeWorktree(
                selectedRepo.repoPath,
                wt.path,
                wt.branch,
              );
            }
            showToast(
              success
                ? `Removed worktree ${slug}`
                : `Failed to remove worktree ${slug}`,
            );
            break;
          }
          default:
            showToast(`Confirmed: ${action} ${slug}`);
        }
      }
      setOverlay({ kind: "none" });
      setFocus("panel");
    },
    [overlay, selectedRepo?.repoPath, worktrees, showToast],
  );

  // --- Open action menu for the current selection ---
  const openActionMenu = useCallback(() => {
    const menuItems = buildMenuItems(
      activePanel,
      selectedPlan,
      selectedWorktree,
    );
    if (menuItems.length > 0) {
      const title =
        activePanel === "pipeline"
          ? (selectedPlan?.slug ?? "Actions")
          : activePanel === "worktrees"
            ? (selectedWorktree?.shortBranch ?? "Actions")
            : "Actions";
      setOverlay({ kind: "menu", items: menuItems, cursor: 0, title });
      setFocus("menu");
    }
  }, [activePanel, selectedPlan, selectedWorktree]);

  return {
    // Panel navigation
    panelNav,
    activePanel,
    // Focus
    focus,
    setFocus,
    // Repos
    repos,
    selectedRepo,
    selectedRepoIdx,
    setSelectedRepoIdx,
    // Plans
    plans,
    displayPlans,
    selectedPlan,
    // Worktrees
    worktrees,
    selectedWorktree,
    // Detail
    activeTab,
    setActiveTab,
    scrollOffset,
    setScrollOffset,
    followTail,
    setFollowTail,
    planContent,
    progressContent,
    outputData,
    contentHeight,
    // Overlay
    overlay,
    setOverlay,
    // Toast
    toast,
    showToast,
    // Filter
    filterQuery,
    setFilterQuery,
    filterActive,
    // Actions
    handleAction,
    handleConfirm,
    openActionMenu,
  };
}
