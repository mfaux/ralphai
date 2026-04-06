/**
 * Tests for the use-pipeline-state hook.
 *
 * Since `ink-testing-library` is not yet available, we test the exported
 * pure `loadReducer` state machine that drives the hook. This covers:
 *   - Initial state
 *   - Loading transitions (start → success, start → failure)
 *   - Refresh semantics (re-entering loading from idle-with-state)
 *   - Error clearing on re-load
 *
 * Component-level rendering tests are deferred until
 * `ink-testing-library` is available.
 */

import { describe, it, expect } from "bun:test";
import type { PipelineState } from "../../pipeline-state.ts";
import {
  loadReducer,
  INITIAL_LOAD_STATE,
  type LoadState,
  type LoadAction,
} from "./use-pipeline-state.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    backlog: [],
    inProgress: [],
    completedSlugs: [],
    worktrees: [],
    problems: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// INITIAL_LOAD_STATE
// ---------------------------------------------------------------------------

describe("INITIAL_LOAD_STATE", () => {
  it("starts idle with no state and no error", () => {
    expect(INITIAL_LOAD_STATE).toEqual({
      phase: "idle",
      state: null,
      error: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// loadReducer
// ---------------------------------------------------------------------------

describe("loadReducer", () => {
  // -----------------------------------------------------------------------
  // start action
  // -----------------------------------------------------------------------

  describe("start action", () => {
    it("transitions from idle to loading", () => {
      const next = loadReducer(INITIAL_LOAD_STATE, { type: "start" });
      expect(next.phase).toBe("loading");
      expect(next.state).toBeNull();
      expect(next.error).toBeUndefined();
    });

    it("preserves existing state during reload", () => {
      const existing = makeState({ completedSlugs: ["a", "b"] });
      const current: LoadState = {
        phase: "idle",
        state: existing,
        error: undefined,
      };

      const next = loadReducer(current, { type: "start" });
      expect(next.phase).toBe("loading");
      expect(next.state).toBe(existing); // same reference
    });

    it("clears previous error when re-loading", () => {
      const current: LoadState = {
        phase: "idle",
        state: null,
        error: "previous failure",
      };

      const next = loadReducer(current, { type: "start" });
      expect(next.phase).toBe("loading");
      expect(next.error).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // success action
  // -----------------------------------------------------------------------

  describe("success action", () => {
    it("transitions from loading to idle with state", () => {
      const loading: LoadState = {
        phase: "loading",
        state: null,
        error: undefined,
      };
      const freshState = makeState({ completedSlugs: ["done-1"] });

      const next = loadReducer(loading, {
        type: "success",
        state: freshState,
      });
      expect(next.phase).toBe("idle");
      expect(next.state).toBe(freshState);
      expect(next.error).toBeUndefined();
    });

    it("replaces previous state on refresh success", () => {
      const oldState = makeState({ completedSlugs: ["old"] });
      const loading: LoadState = {
        phase: "loading",
        state: oldState,
        error: undefined,
      };
      const newState = makeState({ completedSlugs: ["new"] });

      const next = loadReducer(loading, {
        type: "success",
        state: newState,
      });
      expect(next.state).toBe(newState);
      expect(next.state).not.toBe(oldState);
    });

    it("clears any lingering error on success", () => {
      const loading: LoadState = {
        phase: "loading",
        state: null,
        error: "stale error",
      };
      const freshState = makeState();

      const next = loadReducer(loading, {
        type: "success",
        state: freshState,
      });
      expect(next.error).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // failure action
  // -----------------------------------------------------------------------

  describe("failure action", () => {
    it("transitions from loading to idle with error", () => {
      const loading: LoadState = {
        phase: "loading",
        state: null,
        error: undefined,
      };

      const next = loadReducer(loading, {
        type: "failure",
        error: "git worktree list failed",
      });
      expect(next.phase).toBe("idle");
      expect(next.error).toBe("git worktree list failed");
      expect(next.state).toBeNull();
    });

    it("preserves existing state on failure during refresh", () => {
      const existing = makeState({ completedSlugs: ["kept"] });
      const loading: LoadState = {
        phase: "loading",
        state: existing,
        error: undefined,
      };

      const next = loadReducer(loading, {
        type: "failure",
        error: "transient error",
      });
      expect(next.phase).toBe("idle");
      expect(next.state).toBe(existing); // stale data preserved
      expect(next.error).toBe("transient error");
    });
  });

  // -----------------------------------------------------------------------
  // Full lifecycle
  // -----------------------------------------------------------------------

  describe("full lifecycle", () => {
    it("handles initial load → success → refresh → success", () => {
      // 1. Initial idle
      let s = INITIAL_LOAD_STATE;
      expect(s.phase).toBe("idle");
      expect(s.state).toBeNull();

      // 2. Start loading
      s = loadReducer(s, { type: "start" });
      expect(s.phase).toBe("loading");

      // 3. First success
      const first = makeState({ completedSlugs: ["v1"] });
      s = loadReducer(s, { type: "success", state: first });
      expect(s.phase).toBe("idle");
      expect(s.state).toBe(first);

      // 4. Refresh (start again)
      s = loadReducer(s, { type: "start" });
      expect(s.phase).toBe("loading");
      expect(s.state).toBe(first); // old data still available

      // 5. Second success
      const second = makeState({ completedSlugs: ["v2"] });
      s = loadReducer(s, { type: "success", state: second });
      expect(s.phase).toBe("idle");
      expect(s.state).toBe(second);
    });

    it("handles initial load → failure → retry → success", () => {
      // 1. Start
      let s = loadReducer(INITIAL_LOAD_STATE, { type: "start" });

      // 2. Failure
      s = loadReducer(s, { type: "failure", error: "no git repo" });
      expect(s.phase).toBe("idle");
      expect(s.error).toBe("no git repo");
      expect(s.state).toBeNull();

      // 3. Retry
      s = loadReducer(s, { type: "start" });
      expect(s.phase).toBe("loading");
      expect(s.error).toBeUndefined(); // error cleared

      // 4. Success
      const state = makeState({
        backlog: [{ filename: "p.md", scope: "", dependsOn: [] }],
      });
      s = loadReducer(s, { type: "success", state });
      expect(s.phase).toBe("idle");
      expect(s.state).toBe(state);
      expect(s.error).toBeUndefined();
    });

    it("handles success → refresh → failure (preserves stale data)", () => {
      const good = makeState({ completedSlugs: ["ok"] });

      let s: LoadState = { phase: "idle", state: good, error: undefined };

      // Refresh
      s = loadReducer(s, { type: "start" });
      expect(s.state).toBe(good);

      // Failure during refresh
      s = loadReducer(s, { type: "failure", error: "disk full" });
      expect(s.phase).toBe("idle");
      expect(s.state).toBe(good); // stale data kept
      expect(s.error).toBe("disk full");
    });
  });
});
