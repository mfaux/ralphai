/**
 * Terminal size hook for the TUI.
 *
 * Returns `{ width, height }` and automatically re-renders when the
 * terminal is resized (SIGWINCH).  Cleans up the signal listener on
 * unmount.
 *
 * The hook reads dimensions from `process.stdout` by default but
 * accepts an injected `getSize` function for testing.
 *
 * State machine (exported for testing):
 *   The reducer is trivially `resize → new dimensions`, but exporting
 *   it keeps the pattern consistent with the other hooks in this
 *   directory.
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalSize {
  /** Terminal width in columns. */
  width: number;
  /** Terminal height in rows. */
  height: number;
}

export interface UseTerminalSizeResult extends TerminalSize {}

export interface UseTerminalSizeOptions {
  /**
   * Injected function that returns current terminal dimensions.
   * Defaults to reading `process.stdout.columns` / `process.stdout.rows`.
   * Override in tests.
   */
  getSize?: () => TerminalSize;
  /**
   * Injected function to subscribe to resize events.
   * Called with a callback; returns an unsubscribe function.
   * Defaults to listening for SIGWINCH on `process`.
   * Override in tests.
   */
  onResize?: (cb: () => void) => () => void;
}

// ---------------------------------------------------------------------------
// State machine types (exported for testing)
// ---------------------------------------------------------------------------

export type SizeAction = { type: "resize"; width: number; height: number };

/**
 * Pure reducer for the terminal size state machine.
 * Exported for unit testing without React.
 */
export function sizeReducer(
  _current: TerminalSize,
  action: SizeAction,
): TerminalSize {
  return { width: action.width, height: action.height };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default size reader — reads from `process.stdout`. */
function defaultGetSize(): TerminalSize {
  return {
    width: process.stdout.columns ?? 80,
    height: process.stdout.rows ?? 24,
  };
}

/** Default resize subscriber — listens for SIGWINCH on `process`. */
function defaultOnResize(cb: () => void): () => void {
  process.on("SIGWINCH", cb);
  return () => {
    process.off("SIGWINCH", cb);
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTerminalSize(
  opts?: UseTerminalSizeOptions,
): UseTerminalSizeResult {
  const getSize = opts?.getSize ?? defaultGetSize;
  const onResize = opts?.onResize ?? defaultOnResize;

  const [size, setSize] = useState<TerminalSize>(() => getSize());

  useEffect(() => {
    const handleResize = () => {
      const next = getSize();
      setSize((prev) => sizeReducer(prev, { type: "resize", ...next }));
    };

    const unsubscribe = onResize(handleResize);
    return unsubscribe;
  }, [getSize, onResize]);

  return size;
}
