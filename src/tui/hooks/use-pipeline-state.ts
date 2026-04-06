/**
 * Async pipeline state hook for the TUI.
 *
 * Wraps `gatherPipelineState()` + `listRalphaiWorktrees()` so the menu
 * can render immediately while the (synchronous-but-slow) filesystem +
 * git subprocess work happens in the background.
 *
 * Returns `{ state, loading, error, refresh }`.
 *
 * State machine (exported for testing):
 *   idle  ──load()──▸  loading  ──success──▸  idle (state set)
 *                                ──failure──▸  idle (error set)
 */

import { useState, useEffect, useCallback, useRef } from "react";

import type { PipelineState } from "../../pipeline-state.ts";
import type { WorktreeEntry } from "../../worktree/index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsePipelineStateResult {
  /** Gathered pipeline state, or `null` while the first load is pending. */
  state: PipelineState | null;
  /** `true` while a gather operation is in flight. */
  loading: boolean;
  /** Human-readable error string if the last gather failed. */
  error: string | undefined;
  /** Trigger a fresh gather (e.g. after returning from a sub-flow). */
  refresh: () => void;
}

export interface UsePipelineStateOptions {
  /** Working directory passed to the data-gathering functions. */
  cwd: string;
  /**
   * Injected data-gathering function. Defaults to the real
   * `gatherPipelineState` — override in tests.
   */
  gatherState?: (
    cwd: string,
    opts?: { worktrees?: WorktreeEntry[] },
  ) => PipelineState;
  /**
   * Injected worktree-listing function. Defaults to the real
   * `listRalphaiWorktrees` — override in tests.
   */
  listWorktrees?: (cwd: string) => WorktreeEntry[];
}

// ---------------------------------------------------------------------------
// State machine types (exported for testing)
// ---------------------------------------------------------------------------

export type LoadPhase = "idle" | "loading";

export interface LoadState {
  phase: LoadPhase;
  state: PipelineState | null;
  error: string | undefined;
}

export type LoadAction =
  | { type: "start" }
  | { type: "success"; state: PipelineState }
  | { type: "failure"; error: string };

export const INITIAL_LOAD_STATE: LoadState = {
  phase: "idle",
  state: null,
  error: undefined,
};

/**
 * Pure reducer for the load state machine.
 * Exported for unit testing without React.
 */
export function loadReducer(current: LoadState, action: LoadAction): LoadState {
  switch (action.type) {
    case "start":
      return { ...current, phase: "loading", error: undefined };

    case "success":
      return { phase: "idle", state: action.state, error: undefined };

    case "failure":
      return { ...current, phase: "idle", error: action.error };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePipelineState(
  opts: UsePipelineStateOptions,
): UsePipelineStateResult {
  const { cwd, gatherState, listWorktrees } = opts;

  const [loadState, setLoadState] = useState<LoadState>(INITIAL_LOAD_STATE);

  // Keep a ref to the latest options so the async callback always sees
  // current values without needing them in the useEffect dep array.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const gather = useCallback(() => {
    setLoadState((prev) => loadReducer(prev, { type: "start" }));

    // Defer the synchronous-but-potentially-slow work to the next
    // microtask so React can paint the loading state first.
    void Promise.resolve().then(() => {
      try {
        const currentOpts = optsRef.current;
        const worktrees = currentOpts.listWorktrees
          ? currentOpts.listWorktrees(currentOpts.cwd)
          : [];
        const state = currentOpts.gatherState
          ? currentOpts.gatherState(currentOpts.cwd, { worktrees })
          : ({
              backlog: [],
              inProgress: [],
              completedSlugs: [],
              worktrees: [],
              problems: [],
            } satisfies PipelineState);

        setLoadState((prev) => loadReducer(prev, { type: "success", state }));
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown error gathering pipeline state";
        setLoadState((prev) =>
          loadReducer(prev, { type: "failure", error: message }),
        );
      }
    });
  }, []); // stable — reads opts via ref

  // Auto-gather on mount.
  useEffect(() => {
    gather();
  }, [gather]);

  return {
    state: loadState.state,
    loading: loadState.phase === "loading",
    error: loadState.error,
    refresh: gather,
  };
}
