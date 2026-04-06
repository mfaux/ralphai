/**
 * Terminal safety — crash recovery handlers for the Ink TUI.
 *
 * When the TUI is running, `process.stdin` is in raw mode and the
 * terminal cursor is hidden. If the process exits abnormally (SIGINT,
 * SIGTERM, uncaught exception, unhandled rejection), the terminal can
 * be left in a broken state: no visible cursor, raw mode still active,
 * and no echo.
 *
 * This module installs supplementary signal and error handlers that
 * ensure `process.stdin.setRawMode(false)` and cursor restoration
 * (`\x1b[?25h`) always run before exit. The handlers are installed
 * before Ink mounts and removed after Ink unmounts.
 *
 * Ink already handles SIGINT for normal quit (calls `useApp().exit()`),
 * but it does not cover SIGTERM, uncaught exceptions, or unhandled
 * rejections. The SIGINT handler here is supplementary: it runs
 * `restoreTerminal()` and then re-raises the signal so the default
 * behavior (process exit) still occurs.
 */

// ---------------------------------------------------------------------------
// ANSI escape sequences
// ---------------------------------------------------------------------------

/** Show the terminal cursor (DECTCEM). */
const SHOW_CURSOR = "\x1b[?25h";

// ---------------------------------------------------------------------------
// restoreTerminal
// ---------------------------------------------------------------------------

/**
 * Restore the terminal to a safe state.
 *
 * - Disables raw mode on stdin (if it's a TTY and raw mode is active).
 * - Writes the "show cursor" escape sequence to stdout.
 *
 * This function is intentionally synchronous and idempotent — it's safe
 * to call multiple times and from signal handlers where async work is
 * not guaranteed to complete.
 */
export function restoreTerminal(): void {
  try {
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // stdin may already be destroyed — ignore
  }

  try {
    if (process.stdout.isTTY) {
      process.stdout.write(SHOW_CURSOR);
    }
  } catch {
    // stdout may already be destroyed — ignore
  }
}

// ---------------------------------------------------------------------------
// Handler references (needed for removal)
// ---------------------------------------------------------------------------

type SignalHandler = (signal: NodeJS.Signals) => void;
type ErrorHandler = (err: unknown) => void;

let sigintHandler: SignalHandler | undefined;
let sigtermHandler: SignalHandler | undefined;
let uncaughtExceptionHandler: ErrorHandler | undefined;
let unhandledRejectionHandler: ErrorHandler | undefined;

// ---------------------------------------------------------------------------
// install / remove
// ---------------------------------------------------------------------------

/**
 * Install terminal safety handlers.
 *
 * Call this **before** mounting the Ink app. Returns nothing — call
 * `removeTerminalSafetyHandlers()` after Ink unmounts to clean up.
 *
 * The `onCleanExit` callback is invoked for SIGINT/SIGTERM to allow
 * the caller to unmount Ink before the process exits. For uncaught
 * exceptions and unhandled rejections, the terminal is restored and
 * the error is re-thrown / the process exits with code 1.
 */
export function installTerminalSafetyHandlers(onCleanExit?: () => void): void {
  // Guard against double-install
  if (sigintHandler) return;

  sigintHandler = (_signal: NodeJS.Signals) => {
    restoreTerminal();
    onCleanExit?.();
    // Re-raise SIGINT so the default handler fires (exit code 130)
    process.removeListener("SIGINT", sigintHandler!);
    process.kill(process.pid, "SIGINT");
  };

  sigtermHandler = (_signal: NodeJS.Signals) => {
    restoreTerminal();
    onCleanExit?.();
    // Re-raise SIGTERM so the default handler fires
    process.removeListener("SIGTERM", sigtermHandler!);
    process.kill(process.pid, "SIGTERM");
  };

  uncaughtExceptionHandler = (err: unknown) => {
    restoreTerminal();
    // Print the error to stderr before exiting
    console.error(
      "Uncaught exception:",
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exit(1);
  };

  unhandledRejectionHandler = (err: unknown) => {
    restoreTerminal();
    console.error(
      "Unhandled rejection:",
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exit(1);
  };

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);
  process.on("uncaughtException", uncaughtExceptionHandler);
  process.on("unhandledRejection", unhandledRejectionHandler);
}

/**
 * Remove the terminal safety handlers.
 *
 * Call this **after** Ink unmounts so the handlers don't fire during
 * normal post-TUI execution (e.g. the agent runner).
 */
export function removeTerminalSafetyHandlers(): void {
  if (sigintHandler) {
    process.removeListener("SIGINT", sigintHandler);
    sigintHandler = undefined;
  }
  if (sigtermHandler) {
    process.removeListener("SIGTERM", sigtermHandler);
    sigtermHandler = undefined;
  }
  if (uncaughtExceptionHandler) {
    process.removeListener("uncaughtException", uncaughtExceptionHandler);
    uncaughtExceptionHandler = undefined;
  }
  if (unhandledRejectionHandler) {
    process.removeListener("unhandledRejection", unhandledRejectionHandler);
    unhandledRejectionHandler = undefined;
  }
}
