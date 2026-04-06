/**
 * Async GitHub issues hook for the TUI.
 *
 * Wraps `peekGithubIssues()` + `peekPrdIssues()` so the menu can
 * render immediately while the `gh` CLI queries run in the background.
 *
 * Returns `{ count, loading, error }`.
 *
 * Session-cached: once the first fetch succeeds, the result is reused
 * for the lifetime of the component (no re-fetch on re-render or
 * refresh). This avoids hammering the GitHub API on every menu loop.
 *
 * State machine (exported for testing):
 *   idle  ──fetch()──>  loading  ──success──>  idle (count set)
 *                                 ──failure──>  idle (error set)
 */

import { useState, useEffect, useRef } from "react";

import type { PeekIssueOptions, PeekIssueResult } from "../../issues.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseGithubIssuesResult {
  /** Combined issue count (regular + PRD), or `undefined` while loading. */
  count: number | undefined;
  /** `true` while the peek queries are in flight. */
  loading: boolean;
  /** Human-readable error string if the peek failed. */
  error: string | undefined;
}

export interface UseGithubIssuesOptions {
  /** Options forwarded to `peekGithubIssues()` / `peekPrdIssues()`. */
  peekOptions: PeekIssueOptions;
  /**
   * Injected peek function for regular (standalone) issues.
   * Defaults to the real `peekGithubIssues` — override in tests.
   */
  peekGithub?: (opts: PeekIssueOptions) => PeekIssueResult;
  /**
   * Injected peek function for PRD issues.
   * Defaults to the real `peekPrdIssues` — override in tests.
   */
  peekPrd?: (opts: PeekIssueOptions) => PeekIssueResult;
}

// ---------------------------------------------------------------------------
// State machine types (exported for testing)
// ---------------------------------------------------------------------------

export type FetchPhase = "idle" | "loading";

export interface FetchState {
  phase: FetchPhase;
  count: number | undefined;
  error: string | undefined;
}

export type FetchAction =
  | { type: "start" }
  | { type: "success"; count: number }
  | { type: "failure"; error: string };

export const INITIAL_FETCH_STATE: FetchState = {
  phase: "idle",
  count: undefined,
  error: undefined,
};

/**
 * Pure reducer for the fetch state machine.
 * Exported for unit testing without React.
 */
export function fetchReducer(
  current: FetchState,
  action: FetchAction,
): FetchState {
  switch (action.type) {
    case "start":
      return { ...current, phase: "loading", error: undefined };

    case "success":
      return { phase: "idle", count: action.count, error: undefined };

    case "failure":
      return { ...current, phase: "idle", error: action.error };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGithubIssues(
  opts: UseGithubIssuesOptions,
): UseGithubIssuesResult {
  const { peekOptions, peekGithub, peekPrd } = opts;

  const [fetchState, setFetchState] = useState<FetchState>(INITIAL_FETCH_STATE);

  // Track whether we've already fetched successfully (session cache).
  const fetchedRef = useRef(false);

  // Keep a ref to the latest options so the async callback sees
  // current values without needing them in the useEffect dep array.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    // Session-cached: skip if we already have a successful result.
    if (fetchedRef.current) return;

    setFetchState((prev) => fetchReducer(prev, { type: "start" }));

    // Defer to next microtask so React can paint the loading state.
    void Promise.resolve().then(() => {
      try {
        const currentOpts = optsRef.current;
        const regularResult = currentOpts.peekGithub
          ? currentOpts.peekGithub(currentOpts.peekOptions)
          : { found: false, count: 0, message: "" };
        const prdResult = currentOpts.peekPrd
          ? currentOpts.peekPrd(currentOpts.peekOptions)
          : { found: false, count: 0, message: "" };

        // Check for error messages from the peek results.
        // Both peekGithubIssues and peekPrdIssues return a message
        // that may describe an error condition (gh not available, etc.).
        // If neither found issues AND neither function was provided,
        // that's not an error — it's just no issues.
        const regularError =
          !regularResult.found && regularResult.count === 0
            ? regularResult.message
            : undefined;
        const prdError =
          !prdResult.found && prdResult.count === 0
            ? prdResult.message
            : undefined;

        // If both returned "not found" with an error-like message that
        // indicates a systemic failure (gh unavailable, repo detection
        // failed), surface it. But if the message just says "no issues
        // found", that's a normal zero-count result.
        const isSystemicError = (msg: string | undefined): boolean => {
          if (!msg) return false;
          return (
            msg.includes("not available") ||
            msg.includes("not authenticated") ||
            msg.includes("Could not detect") ||
            msg.includes("Could not list") ||
            msg.includes("Failed to parse")
          );
        };

        const systemicRegular = isSystemicError(regularError);
        const systemicPrd = isSystemicError(prdError);

        if (systemicRegular || systemicPrd) {
          // Surface the first systemic error we find.
          const errorMsg = systemicRegular ? regularError! : prdError!;
          setFetchState((prev) =>
            fetchReducer(prev, { type: "failure", error: errorMsg }),
          );
          return;
        }

        // Sum counts (some overlap may exist between regular and PRD,
        // but close enough for a label hint).
        const count = (regularResult.count || 0) + (prdResult.count || 0);
        fetchedRef.current = true;
        setFetchState((prev) => fetchReducer(prev, { type: "success", count }));
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown error fetching GitHub issues";
        setFetchState((prev) =>
          fetchReducer(prev, { type: "failure", error: message }),
        );
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- session-cached, runs once

  return {
    count: fetchState.count,
    loading: fetchState.phase === "loading",
    error: fetchState.error,
  };
}
