/**
 * Hook that tracks terminal dimensions and updates on resize.
 *
 * Returns `{ width, height }` reflecting the current terminal size.
 * Listens for the `resize` event on `process.stdout` (triggered by
 * SIGWINCH) and re-renders when the terminal is resized. Cleans up
 * the listener on unmount.
 *
 * Falls back to 80x24 when stdout is not a TTY (e.g. piped output,
 * CI environments, tests).
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalSize {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Default size when stdout lacks column/row information. */
export const DEFAULT_WIDTH = 80;
export const DEFAULT_HEIGHT = 24;

/**
 * Read the current terminal size from a writable stream.
 *
 * Returns the stream's `columns` and `rows` if available, otherwise
 * falls back to sensible defaults (80x24).
 */
export function readTerminalSize(
  stream: Pick<NodeJS.WriteStream, "columns" | "rows">,
): TerminalSize {
  return {
    width: stream.columns ?? DEFAULT_WIDTH,
    height: stream.rows ?? DEFAULT_HEIGHT,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseTerminalSizeOptions {
  /**
   * The writable stream to read dimensions from. Defaults to
   * `process.stdout`. Override in tests to supply a mock stream.
   */
  stdout?: NodeJS.WriteStream;
}

export function useTerminalSize(opts?: UseTerminalSizeOptions): TerminalSize {
  const stdout = opts?.stdout ?? process.stdout;

  const [size, setSize] = useState<TerminalSize>(() =>
    readTerminalSize(stdout),
  );

  useEffect(() => {
    const onResize = () => {
      setSize(readTerminalSize(stdout));
    };

    stdout.on("resize", onResize);

    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}
