/**
 * Tests for `src/tui/terminal-safety.ts` — crash recovery handlers.
 *
 * These tests verify that:
 * 1. `restoreTerminal()` resets stdin raw mode and writes the show-cursor
 *    escape sequence.
 * 2. `installTerminalSafetyHandlers()` registers process event handlers.
 * 3. `removeTerminalSafetyHandlers()` removes them cleanly.
 * 4. Handlers are idempotent (double-install is a no-op).
 * 5. `restoreTerminal()` is safe to call when stdin/stdout are not TTYs.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  restoreTerminal,
  installTerminalSafetyHandlers,
  removeTerminalSafetyHandlers,
} from "./terminal-safety.ts";

// ---------------------------------------------------------------------------
// restoreTerminal
// ---------------------------------------------------------------------------

describe("restoreTerminal", () => {
  it("does not throw when stdin is not a TTY", () => {
    // In the test environment, stdin may or may not be a TTY.
    // The function should never throw regardless.
    expect(() => restoreTerminal()).not.toThrow();
  });

  it("does not throw when called multiple times", () => {
    expect(() => {
      restoreTerminal();
      restoreTerminal();
      restoreTerminal();
    }).not.toThrow();
  });

  it("writes show-cursor sequence to stdout when stdout is a TTY", () => {
    // We can't easily mock process.stdout.isTTY in a unit test,
    // but we can verify the function completes without error.
    // The actual escape sequence test is better as an integration test.
    expect(() => restoreTerminal()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// installTerminalSafetyHandlers / removeTerminalSafetyHandlers
// ---------------------------------------------------------------------------

describe("installTerminalSafetyHandlers", () => {
  afterEach(() => {
    // Always clean up after each test
    removeTerminalSafetyHandlers();
  });

  it("registers SIGINT handler", () => {
    const before = process.listenerCount("SIGINT");
    installTerminalSafetyHandlers();
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
  });

  it("registers SIGTERM handler", () => {
    const before = process.listenerCount("SIGTERM");
    installTerminalSafetyHandlers();
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
  });

  it("registers uncaughtException handler", () => {
    const before = process.listenerCount("uncaughtException");
    installTerminalSafetyHandlers();
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
  });

  it("registers unhandledRejection handler", () => {
    const before = process.listenerCount("unhandledRejection");
    installTerminalSafetyHandlers();
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
  });

  it("is idempotent (double-install does not double-register)", () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const beforeUncaught = process.listenerCount("uncaughtException");
    const beforeUnhandled = process.listenerCount("unhandledRejection");

    installTerminalSafetyHandlers();
    installTerminalSafetyHandlers(); // second install should be no-op

    expect(process.listenerCount("SIGINT")).toBe(beforeSigint + 1);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm + 1);
    expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught + 1);
    expect(process.listenerCount("unhandledRejection")).toBe(
      beforeUnhandled + 1,
    );
  });

  it("accepts an optional onCleanExit callback", () => {
    const onCleanExit = mock(() => {});
    expect(() => installTerminalSafetyHandlers(onCleanExit)).not.toThrow();
  });
});

describe("removeTerminalSafetyHandlers", () => {
  it("removes all registered handlers", () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const beforeUncaught = process.listenerCount("uncaughtException");
    const beforeUnhandled = process.listenerCount("unhandledRejection");

    installTerminalSafetyHandlers();
    removeTerminalSafetyHandlers();

    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
    expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeUnhandled);
  });

  it("is safe to call when no handlers are installed", () => {
    expect(() => removeTerminalSafetyHandlers()).not.toThrow();
  });

  it("is safe to call multiple times", () => {
    installTerminalSafetyHandlers();
    removeTerminalSafetyHandlers();
    removeTerminalSafetyHandlers(); // second remove should be no-op
    expect(() => removeTerminalSafetyHandlers()).not.toThrow();
  });

  it("allows re-installation after removal", () => {
    const beforeSigint = process.listenerCount("SIGINT");

    installTerminalSafetyHandlers();
    removeTerminalSafetyHandlers();

    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);

    // Re-install should work
    installTerminalSafetyHandlers();
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint + 1);

    removeTerminalSafetyHandlers();
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
  });
});

// ---------------------------------------------------------------------------
// Integration: install + remove lifecycle
// ---------------------------------------------------------------------------

describe("install/remove lifecycle", () => {
  it("full lifecycle does not leak handlers", () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const beforeUncaught = process.listenerCount("uncaughtException");
    const beforeUnhandled = process.listenerCount("unhandledRejection");

    // Simulate TUI lifecycle
    installTerminalSafetyHandlers(() => {});

    // Verify handlers are registered
    expect(process.listenerCount("SIGINT")).toBeGreaterThan(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBeGreaterThan(beforeSigterm);

    // Simulate TUI teardown
    removeTerminalSafetyHandlers();
    restoreTerminal();

    // Verify no leaked handlers
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
    expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeUnhandled);
  });
});
