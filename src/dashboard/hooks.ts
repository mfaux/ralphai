/**
 * Custom hooks for the dashboard.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { PlanInfo, PanelId } from "./types.ts";

// ---------------------------------------------------------------------------
// useAutoRefresh
// ---------------------------------------------------------------------------

/**
 * Auto-refresh hook: calls `loader` immediately and then every `intervalMs`.
 * Returns the latest data and a manual `refresh` trigger.
 */
export function useAutoRefresh<T>(
  loader: () => T,
  intervalMs: number,
): { data: T; refresh: () => void } {
  const [data, setData] = useState<T>(() => loader());

  const refresh = useCallback(() => {
    setData(loader());
  }, [loader]);

  useEffect(() => {
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, refresh };
}

// ---------------------------------------------------------------------------
// useFilter
// ---------------------------------------------------------------------------

export interface FilterResult {
  filtered: PlanInfo[];
  query: string;
  setQuery: (q: string) => void;
  isActive: boolean;
}

/**
 * Filters a plan list by a query string. Supports prefix filters:
 * - `state:<value>` — matches plan state (backlog, in-progress, completed,
 *   or aliases: active, queued, done)
 * - `scope:<value>` — matches plan scope
 * - Remaining text matches against plan slugs (case-insensitive)
 */
export function useFilter(plans: PlanInfo[]): FilterResult {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => filterPlans(plans, query), [plans, query]);

  return { filtered, query, setQuery, isActive: query.length > 0 };
}

/** State alias mapping for friendlier filter terms. */
const STATE_ALIASES: Record<string, PlanInfo["state"]> = {
  active: "in-progress",
  queued: "backlog",
  done: "completed",
  backlog: "backlog",
  "in-progress": "in-progress",
  completed: "completed",
};

/**
 * Pure function that applies filter logic. Exported for testing.
 */
export function filterPlans(plans: PlanInfo[], query: string): PlanInfo[] {
  if (!query.trim()) return plans;

  const tokens = query.trim().toLowerCase().split(/\s+/);
  let stateFilter: PlanInfo["state"] | null = null;
  let scopeFilter: string | null = null;
  const textTokens: string[] = [];

  for (const token of tokens) {
    if (token.startsWith("state:")) {
      const val = token.slice(6);
      stateFilter = STATE_ALIASES[val] ?? null;
    } else if (token.startsWith("scope:")) {
      scopeFilter = token.slice(6);
    } else {
      textTokens.push(token);
    }
  }

  return plans.filter((plan) => {
    if (stateFilter && plan.state !== stateFilter) return false;
    if (
      scopeFilter &&
      (!plan.scope || !plan.scope.toLowerCase().includes(scopeFilter))
    ) {
      return false;
    }
    if (textTokens.length > 0) {
      const slug = plan.slug.toLowerCase();
      if (!textTokens.every((t) => slug.includes(t))) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// usePanelNavigation
// ---------------------------------------------------------------------------

const PANEL_ORDER: PanelId[] = ["repos", "pipeline", "worktrees"];

export interface PanelNavigationResult {
  activePanel: PanelId;
  cursor: number;
  moveCursor: (delta: number, listLength: number) => void;
  setActivePanel: (panel: PanelId) => void;
  /** Move to next/previous panel. */
  cyclePanels: (delta: 1 | -1) => void;
  /** Get cursor for a specific panel. */
  getCursor: (panel: PanelId) => number;
}

/**
 * Manages focus across three stacked panels and per-panel cursor positions.
 */
export function usePanelNavigation(): PanelNavigationResult {
  const [activePanel, setActivePanelState] = useState<PanelId>("repos");
  const [cursorByPanel, setCursorByPanel] = useState<Record<PanelId, number>>({
    repos: 0,
    pipeline: 0,
    worktrees: 0,
  });

  const cursor = cursorByPanel[activePanel];

  const moveCursor = useCallback(
    (delta: number, listLength: number) => {
      setCursorByPanel((prev) => {
        const current = prev[activePanel];
        const next = Math.max(0, Math.min(listLength - 1, current + delta));
        if (next === current) return prev;
        return { ...prev, [activePanel]: next };
      });
    },
    [activePanel],
  );

  const setActivePanel = useCallback((panel: PanelId) => {
    setActivePanelState(panel);
  }, []);

  const cyclePanels = useCallback((delta: 1 | -1) => {
    setActivePanelState((prev) => {
      const idx = PANEL_ORDER.indexOf(prev);
      const next = (idx + delta + PANEL_ORDER.length) % PANEL_ORDER.length;
      return PANEL_ORDER[next]!;
    });
  }, []);

  const getCursor = useCallback(
    (panel: PanelId) => cursorByPanel[panel],
    [cursorByPanel],
  );

  return {
    activePanel,
    cursor,
    moveCursor,
    setActivePanel,
    cyclePanels,
    getCursor,
  };
}
