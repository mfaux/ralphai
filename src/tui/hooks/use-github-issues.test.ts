/**
 * Tests for the use-github-issues hook.
 *
 * Like the pipeline-state tests, we test the exported pure
 * `fetchReducer` state machine that drives the hook. This covers:
 *   - Initial state
 *   - Loading transitions (start -> success, start -> failure)
 *   - Error detection for systemic failures
 *   - Count accumulation from regular + PRD results
 *
 * Component-level rendering tests are deferred until
 * `ink-testing-library` is available.
 */

import { describe, it, expect } from "bun:test";
import {
  fetchReducer,
  INITIAL_FETCH_STATE,
  type FetchState,
} from "./use-github-issues.ts";

// ---------------------------------------------------------------------------
// INITIAL_FETCH_STATE
// ---------------------------------------------------------------------------

describe("INITIAL_FETCH_STATE", () => {
  it("starts idle with no count and no error", () => {
    expect(INITIAL_FETCH_STATE).toEqual({
      phase: "idle",
      count: undefined,
      error: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// fetchReducer
// ---------------------------------------------------------------------------

describe("fetchReducer", () => {
  // -----------------------------------------------------------------------
  // start action
  // -----------------------------------------------------------------------

  describe("start action", () => {
    it("transitions from idle to loading", () => {
      const next = fetchReducer(INITIAL_FETCH_STATE, { type: "start" });
      expect(next.phase).toBe("loading");
      expect(next.count).toBeUndefined();
      expect(next.error).toBeUndefined();
    });

    it("preserves existing count during re-fetch", () => {
      const current: FetchState = {
        phase: "idle",
        count: 5,
        error: undefined,
      };
      const next = fetchReducer(current, { type: "start" });
      expect(next.phase).toBe("loading");
      expect(next.count).toBe(5);
    });

    it("clears previous error when re-loading", () => {
      const current: FetchState = {
        phase: "idle",
        count: undefined,
        error: "previous failure",
      };
      const next = fetchReducer(current, { type: "start" });
      expect(next.phase).toBe("loading");
      expect(next.error).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // success action
  // -----------------------------------------------------------------------

  describe("success action", () => {
    it("transitions from loading to idle with count", () => {
      const loading: FetchState = {
        phase: "loading",
        count: undefined,
        error: undefined,
      };
      const next = fetchReducer(loading, { type: "success", count: 7 });
      expect(next.phase).toBe("idle");
      expect(next.count).toBe(7);
      expect(next.error).toBeUndefined();
    });

    it("handles zero count as a valid success", () => {
      const loading: FetchState = {
        phase: "loading",
        count: undefined,
        error: undefined,
      };
      const next = fetchReducer(loading, { type: "success", count: 0 });
      expect(next.phase).toBe("idle");
      expect(next.count).toBe(0);
      expect(next.error).toBeUndefined();
    });

    it("replaces previous count on success", () => {
      const loading: FetchState = {
        phase: "loading",
        count: 3,
        error: undefined,
      };
      const next = fetchReducer(loading, { type: "success", count: 10 });
      expect(next.count).toBe(10);
    });

    it("clears any lingering error on success", () => {
      const loading: FetchState = {
        phase: "loading",
        count: undefined,
        error: "stale error",
      };
      const next = fetchReducer(loading, { type: "success", count: 2 });
      expect(next.error).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // failure action
  // -----------------------------------------------------------------------

  describe("failure action", () => {
    it("transitions from loading to idle with error", () => {
      const loading: FetchState = {
        phase: "loading",
        count: undefined,
        error: undefined,
      };
      const next = fetchReducer(loading, {
        type: "failure",
        error: "gh CLI not available",
      });
      expect(next.phase).toBe("idle");
      expect(next.error).toBe("gh CLI not available");
      expect(next.count).toBeUndefined();
    });

    it("preserves existing count on failure", () => {
      const loading: FetchState = {
        phase: "loading",
        count: 5,
        error: undefined,
      };
      const next = fetchReducer(loading, {
        type: "failure",
        error: "transient error",
      });
      expect(next.phase).toBe("idle");
      expect(next.count).toBe(5);
      expect(next.error).toBe("transient error");
    });
  });

  // -----------------------------------------------------------------------
  // Full lifecycle
  // -----------------------------------------------------------------------

  describe("full lifecycle", () => {
    it("handles initial load -> success", () => {
      let s = INITIAL_FETCH_STATE;
      expect(s.phase).toBe("idle");
      expect(s.count).toBeUndefined();

      s = fetchReducer(s, { type: "start" });
      expect(s.phase).toBe("loading");

      s = fetchReducer(s, { type: "success", count: 12 });
      expect(s.phase).toBe("idle");
      expect(s.count).toBe(12);
      expect(s.error).toBeUndefined();
    });

    it("handles initial load -> failure -> retry -> success", () => {
      // 1. Start
      let s = fetchReducer(INITIAL_FETCH_STATE, { type: "start" });

      // 2. Failure
      s = fetchReducer(s, {
        type: "failure",
        error: "Could not detect GitHub repo",
      });
      expect(s.phase).toBe("idle");
      expect(s.error).toBe("Could not detect GitHub repo");
      expect(s.count).toBeUndefined();

      // 3. Retry
      s = fetchReducer(s, { type: "start" });
      expect(s.phase).toBe("loading");
      expect(s.error).toBeUndefined();

      // 4. Success
      s = fetchReducer(s, { type: "success", count: 4 });
      expect(s.phase).toBe("idle");
      expect(s.count).toBe(4);
      expect(s.error).toBeUndefined();
    });

    it("handles success -> re-fetch -> failure (preserves stale count)", () => {
      let s: FetchState = { phase: "idle", count: 8, error: undefined };

      s = fetchReducer(s, { type: "start" });
      expect(s.count).toBe(8);

      s = fetchReducer(s, {
        type: "failure",
        error: "gh CLI not authenticated",
      });
      expect(s.phase).toBe("idle");
      expect(s.count).toBe(8); // stale count kept
      expect(s.error).toBe("gh CLI not authenticated");
    });
  });
});
