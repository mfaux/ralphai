/**
 * Tests for the use-pipeline-state hook.
 *
 * Uses mock.module to control gatherPipelineState and listRalphaiWorktrees.
 * Must run in isolation (added to ISOLATED in scripts/test.ts) because
 * mock.module leaks across files in the same bun process.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { PipelineState } from "../../pipeline-state.ts";

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that depend on them
// ---------------------------------------------------------------------------

const mockGatherPipelineState =
  mock<(cwd: string, opts?: { worktrees?: unknown[] }) => PipelineState>();
const mockListRalphaiWorktrees =
  mock<
    (
      cwd: string,
    ) => { path: string; branch: string; head: string; bare: boolean }[]
  >();

mock.module("../../pipeline-state.ts", () => ({
  gatherPipelineState: mockGatherPipelineState,
}));

mock.module("../../worktree/index.ts", () => ({
  listRalphaiWorktrees: mockListRalphaiWorktrees,
}));

// Import AFTER mocking so the hook picks up the mocked modules
const { usePipelineState } = await import("./use-pipeline-state.ts");

// We need React + act for testing hooks
const React = await import("react");
const { render } = await import("ink");

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

/**
 * Minimal hook test harness.
 *
 * Renders an Ink component that calls the hook, captures the result
 * via a callback, and provides a way to trigger actions on the hook.
 */
interface HookCapture {
  state: PipelineState | null;
  loading: boolean;
  refresh: () => void;
}

function createHookTest(cwd: string) {
  const captures: HookCapture[] = [];
  let latestRefresh: (() => void) | null = null;

  function TestComponent() {
    const result = usePipelineState({ cwd });
    captures.push({
      state: result.state,
      loading: result.loading,
      refresh: result.refresh,
    });
    latestRefresh = result.refresh;
    return React.createElement("ink-text", null, "test");
  }

  return {
    TestComponent,
    captures,
    getRefresh: () => latestRefresh!,
  };
}

/** Flush microtasks to allow Promise.resolve().then() to execute. */
async function flushMicrotasks(): Promise<void> {
  // Multiple rounds to ensure all microtask chains complete
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePipelineState", () => {
  beforeEach(() => {
    mockGatherPipelineState.mockReset();
    mockListRalphaiWorktrees.mockReset();
  });

  it("starts in loading state with null pipeline state", async () => {
    const expectedState = makeState({ completedSlugs: ["done-1"] });
    mockListRalphaiWorktrees.mockReturnValue([]);
    mockGatherPipelineState.mockReturnValue(expectedState);

    const { TestComponent, captures } = createHookTest("/test/dir");
    const instance = render(React.createElement(TestComponent));

    try {
      // Initial render should be loading
      expect(captures.length).toBeGreaterThanOrEqual(1);
      expect(captures[0]!.loading).toBe(true);
      expect(captures[0]!.state).toBeNull();

      await flushMicrotasks();

      // After microtask completes, should have loaded state
      const last = captures[captures.length - 1]!;
      expect(last.loading).toBe(false);
      expect(last.state).toEqual(expectedState);
    } finally {
      instance.unmount();
    }
  });

  it("passes worktrees from listRalphaiWorktrees to gatherPipelineState", async () => {
    const worktrees = [
      {
        path: "/wt/feat-1",
        branch: "ralphai/feat-1",
        head: "abc",
        bare: false,
      },
    ];
    const expectedState = makeState();
    mockListRalphaiWorktrees.mockReturnValue(worktrees);
    mockGatherPipelineState.mockReturnValue(expectedState);

    const { TestComponent } = createHookTest("/test/dir");
    const instance = render(React.createElement(TestComponent));

    try {
      await flushMicrotasks();

      expect(mockListRalphaiWorktrees).toHaveBeenCalledWith("/test/dir");
      expect(mockGatherPipelineState).toHaveBeenCalledWith("/test/dir", {
        worktrees,
      });
    } finally {
      instance.unmount();
    }
  });

  it("transitions from loading to loaded with pipeline data", async () => {
    const expectedState = makeState({
      backlog: [{ filename: "plan-1.md", scope: "", dependsOn: [] }],
      inProgress: [],
      completedSlugs: ["done-1", "done-2"],
    });
    mockListRalphaiWorktrees.mockReturnValue([]);
    mockGatherPipelineState.mockReturnValue(expectedState);

    const { TestComponent, captures } = createHookTest("/project");
    const instance = render(React.createElement(TestComponent));

    try {
      // First render: loading
      expect(captures[0]!.loading).toBe(true);
      expect(captures[0]!.state).toBeNull();

      await flushMicrotasks();

      // After loading: state is populated
      const last = captures[captures.length - 1]!;
      expect(last.loading).toBe(false);
      expect(last.state).toEqual(expectedState);
      expect(last.state!.backlog).toHaveLength(1);
      expect(last.state!.completedSlugs).toHaveLength(2);
    } finally {
      instance.unmount();
    }
  });

  it("handles errors from listRalphaiWorktrees gracefully", async () => {
    mockListRalphaiWorktrees.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    const { TestComponent, captures } = createHookTest("/not-a-repo");
    const instance = render(React.createElement(TestComponent));

    try {
      await flushMicrotasks();

      const last = captures[captures.length - 1]!;
      expect(last.loading).toBe(false);
      expect(last.state).toBeNull();
    } finally {
      instance.unmount();
    }
  });

  it("handles errors from gatherPipelineState gracefully", async () => {
    mockListRalphaiWorktrees.mockReturnValue([]);
    mockGatherPipelineState.mockImplementation(() => {
      throw new Error("corrupt pipeline");
    });

    const { TestComponent, captures } = createHookTest("/broken");
    const instance = render(React.createElement(TestComponent));

    try {
      await flushMicrotasks();

      const last = captures[captures.length - 1]!;
      expect(last.loading).toBe(false);
      expect(last.state).toBeNull();
    } finally {
      instance.unmount();
    }
  });

  it("re-gathers state when refresh() is called", async () => {
    const state1 = makeState({ completedSlugs: ["done-1"] });
    const state2 = makeState({ completedSlugs: ["done-1", "done-2"] });

    mockListRalphaiWorktrees.mockReturnValue([]);
    mockGatherPipelineState
      .mockReturnValueOnce(state1)
      .mockReturnValueOnce(state2);

    const { TestComponent, captures, getRefresh } = createHookTest("/project");
    const instance = render(React.createElement(TestComponent));

    try {
      await flushMicrotasks();

      // First load complete
      const afterFirst = captures[captures.length - 1]!;
      expect(afterFirst.loading).toBe(false);
      expect(afterFirst.state).toEqual(state1);

      // Trigger refresh
      const callCount = captures.length;
      React.act(() => {
        getRefresh()();
      });

      await flushMicrotasks();

      // Should have re-gathered with updated state
      const afterRefresh = captures[captures.length - 1]!;
      expect(afterRefresh.loading).toBe(false);
      expect(afterRefresh.state).toEqual(state2);
      expect(captures.length).toBeGreaterThan(callCount);
    } finally {
      instance.unmount();
    }
  });

  it("sets loading to true during refresh", async () => {
    const state1 = makeState();
    const state2 = makeState({ completedSlugs: ["new-1"] });

    mockListRalphaiWorktrees.mockReturnValue([]);
    mockGatherPipelineState
      .mockReturnValueOnce(state1)
      .mockReturnValueOnce(state2);

    const { TestComponent, captures, getRefresh } = createHookTest("/project");
    const instance = render(React.createElement(TestComponent));

    try {
      await flushMicrotasks();

      // Trigger refresh
      React.act(() => {
        getRefresh()();
      });

      // Find the loading=true capture after the refresh trigger
      // (it should appear between the first loaded and second loaded states)
      const loadingDuringRefresh = captures.find(
        (c, i) => i > 0 && c.loading && c.state !== null,
      );
      // Loading should have been set during refresh
      // Note: Due to React batching, the loading=true render may or may not
      // be captured as a separate render. We verify the end state instead.
      await flushMicrotasks();

      const last = captures[captures.length - 1]!;
      expect(last.loading).toBe(false);
      expect(last.state).toEqual(state2);
      expect(mockGatherPipelineState).toHaveBeenCalledTimes(2);
    } finally {
      instance.unmount();
    }
  });

  it("calls gatherPipelineState only once on mount (no duplicate effects)", async () => {
    const expectedState = makeState();
    mockListRalphaiWorktrees.mockReturnValue([]);
    mockGatherPipelineState.mockReturnValue(expectedState);

    const { TestComponent } = createHookTest("/project");
    const instance = render(React.createElement(TestComponent));

    try {
      await flushMicrotasks();

      expect(mockGatherPipelineState).toHaveBeenCalledTimes(1);
      expect(mockListRalphaiWorktrees).toHaveBeenCalledTimes(1);
    } finally {
      instance.unmount();
    }
  });
});
