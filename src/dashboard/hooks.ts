/**
 * Custom hooks for the dashboard.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { PlanInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// useAutoRefresh
// ---------------------------------------------------------------------------

/**
 * Auto-refresh hook: calls `loader` immediately and then every `intervalMs`.
 * Re-invokes the loader whenever its identity changes (fixing the flash
 * where stale data would show for up to one interval after a dependency
 * change, e.g. selecting a new repo).
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

  // Re-invoke immediately when loader identity changes
  useEffect(() => {
    setData(loader());
  }, [loader]);

  useEffect(() => {
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, refresh };
}

// ---------------------------------------------------------------------------
// filterPlans
// ---------------------------------------------------------------------------

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
 *
 * Supports prefix filters:
 * - `state:<value>` — matches plan state (backlog, in-progress, completed,
 *   or aliases: active, queued, done)
 * - `scope:<value>` — matches plan scope
 * - Remaining text matches against plan slugs (case-insensitive)
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
// useSpinner
// ---------------------------------------------------------------------------

/** Braille dot animation frames. */
export const SPINNER_FRAMES = [
  "\u280B",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283C",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280F",
] as const;

/**
 * Animated braille-dot spinner hook. When `active` is true, cycles through
 * SPINNER_FRAMES at ~100ms. Returns the current frame character, or an
 * empty string when inactive.
 */
export function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return "";
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!;
}

// ---------------------------------------------------------------------------
// useListCursor
// ---------------------------------------------------------------------------

export interface ListCursorResult {
  cursor: number;
  moveCursor: (delta: number, listLength: number) => void;
  setCursor: (index: number) => void;
}

/**
 * Simple single-list cursor hook. Replaces the old multi-panel navigation.
 * Clamps cursor within [0, listLength - 1].
 */
export function useListCursor(): ListCursorResult {
  const [cursor, setCursorState] = useState(0);

  const moveCursor = useCallback((delta: number, listLength: number) => {
    setCursorState((prev) => {
      const next = Math.max(0, Math.min(listLength - 1, prev + delta));
      return next;
    });
  }, []);

  const setCursor = useCallback((index: number) => {
    setCursorState(Math.max(0, index));
  }, []);

  return { cursor, moveCursor, setCursor };
}
