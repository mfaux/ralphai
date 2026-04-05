/**
 * Async hook for loading pipeline state in the TUI.
 *
 * Wraps the synchronous `gatherPipelineState()` + `listRalphaiWorktrees()`
 * calls so the TUI renders immediately while data loads in the background.
 *
 * Returns `{ state, loading, refresh }` where:
 * - `state` is `null` until the first gather completes
 * - `loading` is `true` during gather operations
 * - `refresh()` triggers a re-gather (e.g. after returning from a sub-flow)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { PipelineState } from "../../pipeline-state.ts";
import { gatherPipelineState } from "../../pipeline-state.ts";
import { listRalphaiWorktrees } from "../../worktree/index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsePipelineStateResult {
  state: PipelineState | null;
  loading: boolean;
  refresh: () => void;
}

export interface UsePipelineStateOptions {
  cwd: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePipelineState(
  opts: UsePipelineStateOptions,
): UsePipelineStateResult {
  const { cwd } = opts;
  const [state, setState] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Run synchronous filesystem operations in a microtask to avoid
    // blocking the initial render.
    void Promise.resolve().then(() => {
      try {
        const worktrees = listRalphaiWorktrees(cwd);
        const result = gatherPipelineState(cwd, { worktrees });
        if (!cancelled && mountedRef.current) {
          setState(result);
          setLoading(false);
        }
      } catch {
        // If gather fails (e.g. not in a git repo), leave state null
        // and stop loading so the UI can handle the empty state.
        if (!cancelled && mountedRef.current) {
          setLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cwd, refreshToken]);

  const refresh = useCallback(() => {
    setRefreshToken((t) => t + 1);
  }, []);

  return { state, loading, refresh };
}
