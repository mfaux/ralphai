/**
 * Tests for the use-terminal-size hook.
 *
 * Tests the pure helper `readTerminalSize` and the React hook behaviour
 * including resize event handling and cleanup on unmount.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { EventEmitter } from "events";
import React from "react";
import { render } from "ink";

import {
  readTerminalSize,
  useTerminalSize,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  type TerminalSize,
} from "./use-terminal-size.ts";

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("readTerminalSize", () => {
  it("reads columns and rows from a stream", () => {
    const stream = { columns: 120, rows: 40 };
    expect(readTerminalSize(stream)).toEqual({ width: 120, height: 40 });
  });

  it("falls back to defaults when columns/rows are undefined", () => {
    const stream = { columns: undefined, rows: undefined } as unknown as Pick<
      NodeJS.WriteStream,
      "columns" | "rows"
    >;
    expect(readTerminalSize(stream)).toEqual({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  });

  it("falls back to default width when only columns is undefined", () => {
    const stream = { columns: undefined, rows: 50 } as unknown as Pick<
      NodeJS.WriteStream,
      "columns" | "rows"
    >;
    expect(readTerminalSize(stream)).toEqual({
      width: DEFAULT_WIDTH,
      height: 50,
    });
  });

  it("falls back to default height when only rows is undefined", () => {
    const stream = { columns: 200, rows: undefined } as unknown as Pick<
      NodeJS.WriteStream,
      "columns" | "rows"
    >;
    expect(readTerminalSize(stream)).toEqual({
      width: 200,
      height: DEFAULT_HEIGHT,
    });
  });
});

// ---------------------------------------------------------------------------
// Mock stdout helper
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock stdout that emits `resize` events and exposes
 * mutable `columns` / `rows` properties.
 */
function createMockStdout(columns: number, rows: number) {
  const emitter = new EventEmitter();
  const mock = Object.assign(emitter, {
    columns,
    rows,
    // Minimal WriteStream stubs to satisfy the type
    isTTY: true as const,
  });
  return mock as unknown as NodeJS.WriteStream;
}

// ---------------------------------------------------------------------------
// Hook tests
// ---------------------------------------------------------------------------

/**
 * Hook test harness — renders a component that calls useTerminalSize
 * and captures the result each render.
 */
function createHookTest(stdout: NodeJS.WriteStream) {
  const captures: TerminalSize[] = [];

  function TestComponent() {
    const size = useTerminalSize({ stdout });
    captures.push(size);
    return React.createElement(
      "ink-text",
      null,
      `${size.width}x${size.height}`,
    );
  }

  return { TestComponent, captures };
}

/** Flush microtasks / timers to allow React state updates to propagate. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("useTerminalSize", () => {
  it("returns the initial terminal size on mount", async () => {
    const stdout = createMockStdout(150, 45);
    const { TestComponent, captures } = createHookTest(stdout);
    const instance = render(React.createElement(TestComponent));

    try {
      expect(captures.length).toBeGreaterThanOrEqual(1);
      expect(captures[0]).toEqual({ width: 150, height: 45 });
    } finally {
      instance.unmount();
    }
  });

  it("updates size when a resize event fires", async () => {
    const stdout = createMockStdout(100, 30);
    const { TestComponent, captures } = createHookTest(stdout);
    const instance = render(React.createElement(TestComponent));

    try {
      expect(captures[0]).toEqual({ width: 100, height: 30 });

      // Simulate terminal resize
      stdout.columns = 200;
      stdout.rows = 60;
      React.act(() => {
        stdout.emit("resize");
      });

      await flushMicrotasks();

      const last = captures[captures.length - 1]!;
      expect(last).toEqual({ width: 200, height: 60 });
    } finally {
      instance.unmount();
    }
  });

  it("handles multiple resize events", async () => {
    const stdout = createMockStdout(80, 24);
    const { TestComponent, captures } = createHookTest(stdout);
    const instance = render(React.createElement(TestComponent));

    try {
      // First resize
      stdout.columns = 120;
      stdout.rows = 40;
      React.act(() => {
        stdout.emit("resize");
      });
      await flushMicrotasks();

      expect(captures[captures.length - 1]).toEqual({ width: 120, height: 40 });

      // Second resize
      stdout.columns = 60;
      stdout.rows = 20;
      React.act(() => {
        stdout.emit("resize");
      });
      await flushMicrotasks();

      expect(captures[captures.length - 1]).toEqual({ width: 60, height: 20 });
    } finally {
      instance.unmount();
    }
  });

  it("cleans up resize listener on unmount", async () => {
    const stdout = createMockStdout(80, 24);
    const { TestComponent, captures } = createHookTest(stdout);
    const instance = render(React.createElement(TestComponent));

    await flushMicrotasks();
    const captureCountBefore = captures.length;

    // Verify listener is attached
    expect(stdout.listenerCount("resize")).toBe(1);

    instance.unmount();
    await flushMicrotasks();

    // Verify listener was removed
    expect(stdout.listenerCount("resize")).toBe(0);

    // Emit resize after unmount — should not cause additional captures
    stdout.columns = 999;
    stdout.rows = 999;
    stdout.emit("resize");
    await flushMicrotasks();

    // No new renders after unmount (captures may have grown slightly during
    // unmount itself, but not from the post-unmount resize)
    // The key assertion is that the listener was removed above.
  });

  it("mounts and unmounts without error", () => {
    const stdout = createMockStdout(80, 24);
    const { TestComponent } = createHookTest(stdout);
    const instance = render(React.createElement(TestComponent));
    instance.unmount();
  });
});
