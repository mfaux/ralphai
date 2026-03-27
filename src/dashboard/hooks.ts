/**
 * Custom hooks for the dashboard.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useContext,
  createContext,
} from "react";
import type { PlanInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// useAutoRefresh (sync — kept for backward-compat, prefer useAsyncAutoRefresh)
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
// useAsyncAutoRefresh
// ---------------------------------------------------------------------------

/**
 * Async auto-refresh hook: calls an async `loader` without blocking
 * the main thread (no synchronous FS or child_process calls).
 *
 * - Runs the loader immediately on mount and when its identity changes.
 * - Re-runs every `intervalMs` via setInterval.
 * - Stale responses (from a previous loader identity) are discarded.
 * - Overlapping in-flight loads are skipped to avoid piling up work.
 *
 * The `initialData` argument provides the value before the first load
 * resolves, avoiding a flash of empty state.
 */
export function useAsyncAutoRefresh<T>(
  loader: () => Promise<T>,
  intervalMs: number,
  initialData: T,
): { data: T; refresh: () => void } {
  const [data, setData] = useState<T>(initialData);
  const loadingRef = useRef(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const refresh = useCallback(() => {
    if (loadingRef.current) return; // skip if already in-flight
    loadingRef.current = true;
    const currentLoader = loaderRef.current;
    currentLoader().then(
      (result) => {
        // Only apply if the loader identity hasn't changed
        if (loaderRef.current === currentLoader) {
          setData(result);
        }
        loadingRef.current = false;
      },
      () => {
        loadingRef.current = false;
      },
    );
  }, []);

  // Run immediately when loader identity changes
  useEffect(() => {
    loaderRef.current = loader;
    loadingRef.current = false; // reset so the new loader can fire
    refresh();
  }, [loader, refresh]);

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
// Shared spinner (single interval via React context)
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

/** Spinner interval in milliseconds. */
const SPINNER_INTERVAL_MS = 160;

/**
 * Context that carries the current spinner frame index. A single
 * SpinnerProvider runs one setInterval for the entire component tree,
 * replacing the per-component intervals that previously caused N+3
 * independent timers and N+3 setState calls per tick.
 */
export const SpinnerContext = createContext<number>(0);

/**
 * SpinnerProvider — mount once at the root of the Ink tree.
 * Runs a single setInterval that increments the frame counter.
 * All useSpinner() consumers read from this context instead of
 * maintaining their own timer.
 */
export function useSpinnerProvider(): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return frame;
}

/**
 * Animated braille-dot spinner hook. When `active` is true, returns the
 * current frame character from the shared SpinnerContext. Returns an
 * empty string when inactive.
 *
 * Requires SpinnerProvider to be mounted above this component in the tree.
 */
export function useSpinner(active: boolean): string {
  const frame = useContext(SpinnerContext);
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
