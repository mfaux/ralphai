/**
 * useAppState — core state management hook for the dashboard.
 *
 * Manages: data loading (repos, plans, worktrees), selection tracking,
 * overlay state, toast messages, filter state, and action/confirm handlers.
 *
 * Option B layout: single full-width plan list with detail overlay.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { getRepoPipelineDirs, type RepoSummary } from "../global-state.ts";
import { getSocketPath } from "../ipc-protocol.ts";
import type {
  FocusTarget,
  DetailTab,
  PlanInfo,
  ActionMenuItem,
  ActionContext,
  WorktreeInfo,
} from "./types.ts";
import {
  loadReposAsync,
  loadPlansAsync,
  loadWorktreesAsync,
  loadPlanContentAsync,
  loadProgressContentAsync,
  loadOutputTailAsync,
} from "./data/index.ts";
import { useAsyncAutoRefresh, filterPlans, useListCursor } from "./hooks.ts";
import { defaultTabForState } from "./DetailOverlay.tsx";
import { buildMenuItems } from "./ActionMenu.tsx";
import {
  spawnRunner,
  resetPlan,
  purgePlan,
  removeWorktree,
  stopRunner,
  pullAndRunIssue,
  pullAndRunOldest,
} from "./actions.ts";
import { loadGithubIssuesAsync } from "./issue-loader.ts";
import { useRunnerStream } from "./use-runner-stream.ts";
import { getCachedPipelineDirs } from "./data/shared.ts";

const REFRESH_MS = 3000;
const GITHUB_REFRESH_MS = 30_000;

/**
 * Height reserved for non-plan-list chrome.
 * 3 RepoBar (1 content + 2 border) + 1 StatusBar + 2 PanelBox border rows = 6.
 */
export const CHROME_ROWS = 6;

/** Minimum terminal width for side-by-side split pane layout. */
export const SPLIT_MIN_COLS = 80;

/** Overlay types for the modal stack. */
export type Overlay =
  | { kind: "none" }
  | { kind: "menu"; items: ActionMenuItem[]; cursor: number; title: string }
  | { kind: "confirm"; action: string; slug: string }
  | { kind: "help" }
  | { kind: "repoSelect"; cursor: number };

export function useAppState(termRows: number, termCols: number) {
  // --- List cursor (single plan list) ---
  const listCursor = useListCursor();
  const { cursor: planCursor, moveCursor, setCursor } = listCursor;

  // --- Focus target ---
  const [focus, setFocus] = useState<FocusTarget>("list");

  // --- Selected repo ---
  const [selectedRepoIdx, setSelectedRepoIdx] = useState(0);

  // --- Detail overlay state ---
  const [showDetail, setShowDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("summary");
  const [scrollOffset, setScrollOffset] = useState(0);

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

  // --- Data loading (async — avoids blocking the event loop) ---
  const repoLoader = useCallback(() => loadReposAsync(), []);
  const { data: repos } = useAsyncAutoRefresh<RepoSummary[]>(
    repoLoader,
    REFRESH_MS,
    [],
  );

  // Clamp selectedRepoIdx when repo list changes
  useEffect(() => {
    if (repos.length === 0) return;
    if (selectedRepoIdx >= repos.length) {
      setSelectedRepoIdx(Math.max(0, repos.length - 1));
    }
  }, [repos.length, selectedRepoIdx]);

  const selectedRepo: RepoSummary | null =
    repos[selectedRepoIdx] ?? repos[0] ?? null;

  // Repo selector overlay
  const openRepoSelect = useCallback(() => {
    if (repos.length === 0) return;
    setOverlay({ kind: "repoSelect", cursor: selectedRepoIdx });
    setFocus("menu");
  }, [repos.length, selectedRepoIdx]);

  const selectRepo = useCallback(
    (index: number) => {
      setSelectedRepoIdx(index);
      setCursor(0);
      setOverlay({ kind: "none" });
      setFocus("list");
    },
    [setCursor],
  );

  /** Cycle the selected repo by delta (±1) with clamping. Resets plan cursor. */
  const cycleRepo = useCallback(
    (delta: number) => {
      if (repos.length === 0) return;
      setSelectedRepoIdx((prev) => {
        const next = prev + delta;
        return Math.max(0, Math.min(repos.length - 1, next));
      });
      setCursor(0);
    },
    [repos.length, setCursor],
  );

  // cwd-based initial repo selection (one-shot)
  const cwdMatchDone = useRef(false);
  useEffect(() => {
    if (cwdMatchDone.current || repos.length === 0) return;
    cwdMatchDone.current = true;
    const cwd = resolve(process.cwd());
    const idx = repos.findIndex(
      (r) => r.repoPath !== null && resolve(r.repoPath) === cwd,
    );
    if (idx >= 0) setSelectedRepoIdx(idx);
  }, [repos]);

  const planLoader = useCallback(
    () =>
      selectedRepo?.repoPath
        ? loadPlansAsync(selectedRepo.repoPath)
        : Promise.resolve([]),
    [selectedRepo?.repoPath],
  );
  const { data: plans } = useAsyncAutoRefresh<PlanInfo[]>(
    planLoader,
    REFRESH_MS,
    [],
  );

  // --- GitHub issues (longer poll interval to avoid rate-limiting) ---
  const githubIssueLoader = useCallback(
    () =>
      selectedRepo?.repoPath
        ? loadGithubIssuesAsync(selectedRepo.repoPath, plans)
        : Promise.resolve([]),
    [selectedRepo?.repoPath, plans],
  );
  const { data: githubIssues } = useAsyncAutoRefresh<PlanInfo[]>(
    githubIssueLoader,
    GITHUB_REFRESH_MS,
    [],
  );

  // Merge local plans with remote GitHub issues.
  const allPlans = useMemo(
    () => [...plans, ...githubIssues],
    [plans, githubIssues],
  );

  const worktreeLoader = useCallback(
    () =>
      selectedRepo?.repoPath
        ? loadWorktreesAsync(selectedRepo.repoPath, allPlans)
        : Promise.resolve([]),
    [selectedRepo?.repoPath, allPlans],
  );
  const { data: worktrees } = useAsyncAutoRefresh<WorktreeInfo[]>(
    worktreeLoader,
    REFRESH_MS,
    [],
  );

  // --- Filter plans ---
  const filterActive = filterQuery.trim().length > 0;
  const displayPlans = useMemo(
    () => filterPlans(allPlans, filterQuery),
    [allPlans, filterQuery],
  );

  // Clamp plan cursor when display plans change
  useEffect(() => {
    if (displayPlans.length === 0) return;
    if (planCursor >= displayPlans.length) {
      setCursor(Math.max(0, displayPlans.length - 1));
    }
  }, [displayPlans.length, planCursor, setCursor]);

  // --- Derived selections ---
  const selectedPlan: PlanInfo | null = displayPlans[planCursor] ?? null;

  // --- Detail content ---
  const planContentLoader = useCallback(
    () =>
      selectedPlan && selectedRepo?.repoPath
        ? loadPlanContentAsync(selectedRepo.repoPath, selectedPlan)
        : Promise.resolve(null),
    [selectedPlan?.slug, selectedPlan?.state, selectedRepo?.repoPath],
  );
  const { data: planContent } = useAsyncAutoRefresh<string | null>(
    planContentLoader,
    REFRESH_MS,
    null,
  );

  // --- IPC streaming for real-time output ---
  // Compute socket path when the selected plan is in-progress with a runner.
  // Placed before progress/output loaders so ipcConnected can gate polling.
  const socketPath = useMemo(() => {
    if (
      !selectedPlan ||
      !selectedRepo?.repoPath ||
      selectedPlan.state !== "in-progress" ||
      !selectedPlan.runnerPid
    ) {
      return null;
    }
    try {
      const dirs = getCachedPipelineDirs(selectedRepo.repoPath);
      const path = getSocketPath(dirs.wipDir, selectedPlan.slug);
      return existsSync(path) ? path : null;
    } catch {
      return null;
    }
  }, [
    selectedPlan?.slug,
    selectedPlan?.state,
    selectedPlan?.runnerPid,
    selectedRepo?.repoPath,
  ]);

  const {
    outputLines: ipcOutputLines,
    connected: ipcConnected,
    progressContent: ipcProgressContent,
    tasksCompleted: ipcTasksCompleted,
    completed: ipcCompleted,
  } = useRunnerStream(socketPath, selectedRepo?.repoPath ?? null, selectedPlan);

  // Progress and output poll on the refresh interval so live updates appear.
  // When IPC is connected, skip filesystem reads (IPC provides real-time data).
  const progressLoader = useCallback(
    () =>
      ipcConnected
        ? Promise.resolve(null)
        : selectedPlan && selectedRepo?.repoPath
          ? loadProgressContentAsync(selectedRepo.repoPath, selectedPlan)
          : Promise.resolve(null),
    [
      selectedPlan?.slug,
      selectedPlan?.state,
      selectedRepo?.repoPath,
      ipcConnected,
    ],
  );
  const { data: progressContent } = useAsyncAutoRefresh<string | null>(
    progressLoader,
    REFRESH_MS,
    null,
  );

  const outputLoader = useCallback(
    () =>
      ipcConnected
        ? Promise.resolve(null)
        : selectedPlan && selectedRepo?.repoPath
          ? loadOutputTailAsync(selectedRepo.repoPath, selectedPlan)
          : Promise.resolve(null),
    [
      selectedPlan?.slug,
      selectedPlan?.state,
      selectedRepo?.repoPath,
      ipcConnected,
    ],
  );
  const { data: outputData } = useAsyncAutoRefresh<{
    content: string;
    totalLines: number;
  } | null>(outputLoader, REFRESH_MS, null);

  // Merge IPC output with polled output: IPC takes priority when connected.
  const mergedOutputData = useMemo(() => {
    if (ipcConnected && ipcOutputLines.length > 0) {
      const content = ipcOutputLines.join("\n");
      return { content, totalLines: ipcOutputLines.length };
    }
    return outputData;
  }, [ipcConnected, ipcOutputLines, outputData]);

  // Merge IPC progress with polled progress: IPC takes priority when connected.
  const mergedProgressContent = useMemo(() => {
    if (ipcConnected && ipcProgressContent) {
      return ipcProgressContent;
    }
    return progressContent;
  }, [ipcConnected, ipcProgressContent, progressContent]);

  // Detail overlay content area: terminal height minus border chrome (2),
  // title row (1), tab bar (1), content margin (1).
  const contentHeight = Math.max(5, termRows - 6);

  // --- Split pane layout ---
  const isSplitMode = showDetail && termCols >= SPLIT_MIN_COLS;
  const splitListWidth = Math.max(20, Math.floor(termCols * 0.3));
  const splitDetailWidth = termCols - splitListWidth;
  // In split mode, detail is inline (same vertical space as plan list).
  // Detail chrome: 2 border rows + 1 title + 1 tab bar = 4.
  const splitContentHeight = Math.max(5, termRows - CHROME_ROWS - 4);

  // --- Auto-set default tab when plan selection changes ---
  useEffect(() => {
    if (selectedPlan) {
      setActiveTab(defaultTabForState(selectedPlan.state, selectedPlan.source));
      setScrollOffset(0);
    }
  }, [selectedPlan?.slug]);

  // --- Open detail (split or overlay) ---
  const openDetail = useCallback(() => {
    if (!selectedPlan) return;
    setShowDetail(true);
    setFocus(termCols >= SPLIT_MIN_COLS ? "list" : "detail");
  }, [selectedPlan, termCols]);

  const focusDetail = useCallback(() => {
    if (!selectedPlan) return;
    setShowDetail(true);
    setFocus("detail");
  }, [selectedPlan]);

  // --- Close detail ---
  const closeDetail = useCallback(() => {
    setShowDetail(false);
    setFocus("list");
  }, []);

  // --- Action handler ---
  const handleAction = useCallback(
    (action: string) => {
      setOverlay({ kind: "none" });

      // Restore focus to the appropriate pane. When invoked from a menu
      // overlay, focus is "menu"; without this it would stay on "menu"
      // after the overlay is dismissed, leaving no panel with focus.
      setFocus(showDetail ? "detail" : "list");

      switch (action) {
        case "view-plan":
          setActiveTab("plan");
          setShowDetail(true);
          setFocus("detail");
          break;
        case "view-progress":
          setActiveTab("progress");
          setShowDetail(true);
          setFocus("detail");
          break;
        case "view-output":
          setActiveTab("output");
          setShowDetail(true);
          setFocus("detail");
          break;
        case "view-summary":
          setActiveTab("summary");
          setShowDetail(true);
          setFocus("detail");
          break;
        case "view-linked-plan": {
          // Find the worktree's linked plan in display plans
          const linkedSlug = worktrees.find((w) => w.linkedPlan)?.linkedPlan;
          if (linkedSlug) {
            const idx = displayPlans.findIndex((p) => p.slug === linkedSlug);
            if (idx >= 0) {
              setCursor(idx);
              showToast(`Linked: ${linkedSlug}`);
            } else {
              showToast("Linked plan not in current view");
            }
          }
          break;
        }
        case "run": {
          if (!selectedPlan || !selectedRepo?.repoPath) {
            showToast("No plan or repo selected");
            break;
          }
          const pid = spawnRunner(selectedRepo.repoPath, selectedPlan.slug);
          showToast(
            pid
              ? `Started Ralphai run for ${selectedPlan.slug} (pid ${pid})`
              : `Failed to start Ralphai run for ${selectedPlan.slug}`,
          );
          break;
        }
        case "pull-run-issue": {
          if (!selectedPlan?.issueNumber || !selectedRepo?.repoPath) {
            showToast("No GitHub issue selected");
            break;
          }
          const pullResult = pullAndRunIssue(
            selectedRepo.repoPath,
            selectedPlan.issueNumber,
          );
          showToast(pullResult.message);
          break;
        }
        case "pull-run-oldest": {
          if (!selectedRepo?.repoPath) {
            showToast("No repo selected");
            break;
          }
          const oldestResult = pullAndRunOldest(selectedRepo.repoPath);
          showToast(oldestResult.message);
          break;
        }
        case "stop-run":
          if (!selectedPlan?.runnerPid || !selectedRepo?.repoPath) {
            showToast("No running agent to stop");
            break;
          }
          setOverlay({
            kind: "confirm",
            action: "stop-run",
            slug: selectedPlan.slug,
          });
          setFocus("menu");
          break;
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
                ? (worktrees[0]?.shortBranch ?? "")
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
      selectedPlan,
      worktrees,
      displayPlans,
      setCursor,
      showToast,
      selectedRepo?.repoPath,
      showDetail,
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
          case "stop-run": {
            const plan = displayPlans.find((p) => p.slug === slug);
            if (!plan?.runnerPid) {
              showToast("No running agent to stop");
              break;
            }
            const dirs = getRepoPipelineDirs(selectedRepo.repoPath);
            const slugDir = join(dirs.wipDir, slug);
            const result = stopRunner(plan.runnerPid, slugDir);
            switch (result) {
              case "stopped":
                showToast(`Stopped agent for ${slug}`);
                break;
              case "already-exited":
                showToast(`Agent for ${slug} already exited`);
                break;
              case "failed":
                showToast(`Failed to stop agent for ${slug}`);
                break;
            }
            break;
          }
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
      setFocus("list");
    },
    [overlay, selectedRepo?.repoPath, worktrees, displayPlans, showToast],
  );

  // --- Open action menu for the selected plan ---
  const openActionMenu = useCallback(() => {
    const context: ActionContext = selectedPlan ? "plan" : "none";
    const menuItems = buildMenuItems(context, selectedPlan, null);
    if (menuItems.length > 0) {
      const title = selectedPlan?.slug ?? "Actions";
      setOverlay({ kind: "menu", items: menuItems, cursor: 0, title });
      setFocus("menu");
    }
  }, [selectedPlan]);

  return {
    // List cursor
    listCursor,
    planCursor,
    moveCursor,
    setCursor,
    // Focus
    focus,
    setFocus,
    // Repos
    repos,
    selectedRepo,
    selectedRepoIdx,
    openRepoSelect,
    selectRepo,
    cycleRepo,
    // Plans
    plans: allPlans,
    displayPlans,
    selectedPlan,
    // GitHub issues
    githubIssues,
    // Worktrees
    worktrees,
    // Detail
    showDetail,
    openDetail,
    focusDetail,
    closeDetail,
    activeTab,
    setActiveTab,
    scrollOffset,
    setScrollOffset,
    planContent,
    progressContent: mergedProgressContent,
    outputData: mergedOutputData,
    ipcConnected,
    contentHeight,
    // Split pane
    isSplitMode,
    splitListWidth,
    splitDetailWidth,
    splitContentHeight,
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
