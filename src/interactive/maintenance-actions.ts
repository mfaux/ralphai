/**
 * Maintenance action handlers for the interactive menu.
 *
 * Provides "Doctor", "Clean worktrees", "View config", and "Edit config"
 * actions. Each is a thin wrapper delegating to existing functionality.
 */

import { runRalphai } from "../ralphai.ts";
import { runClean } from "../clean.ts";
import { runConfigCommand } from "../config-cmd.ts";

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Handle the "Doctor" action.
 *
 * Delegates to `runRalphai(["doctor"])` which runs the existing health
 * checks. The doctor command calls `process.exit(1)` on failure, so we
 * intercept that to avoid crashing the menu loop.
 *
 * @returns `"continue"` — always returns to the menu.
 */
export async function handleDoctor(cwd: string): Promise<"continue"> {
  const originalExit = process.exit;
  try {
    // Intercept process.exit so doctor failures don't kill the menu
    process.exit = (() => {
      throw new ExitIntercepted();
    }) as never;
    await runRalphai(["doctor"]);
  } catch (e) {
    if (!(e instanceof ExitIntercepted)) {
      throw e;
    }
    // Doctor reported failures — that's fine, user already saw the output
  } finally {
    process.exit = originalExit;
  }
  return "continue";
}

/**
 * Handle the "Clean worktrees" action.
 *
 * Delegates to `runClean` with `yes: false` so the user gets the
 * existing confirmation prompt. Cleans both worktrees and archive.
 *
 * @returns `"continue"` — always returns to the menu.
 */
export async function handleClean(cwd: string): Promise<"continue"> {
  await runClean({ cwd, yes: false, worktrees: true, archive: true });
  return "continue";
}

/**
 * Handle the "View config" action.
 *
 * Delegates to `runConfigCommand` which prints the fully resolved
 * config with source tracking. The config command may call
 * `process.exit(1)` if not initialized, so we intercept that.
 *
 * @returns `"continue"` — always returns to the menu.
 */
export function handleViewConfig(cwd: string): "continue" {
  const originalExit = process.exit;
  try {
    process.exit = (() => {
      throw new ExitIntercepted();
    }) as never;
    runConfigCommand({ cwd });
  } catch (e) {
    if (!(e instanceof ExitIntercepted)) {
      throw e;
    }
    // Config command failed (e.g. not initialized) — user saw the error
  } finally {
    process.exit = originalExit;
  }
  return "continue";
}

/**
 * Handle the "Edit config" action.
 *
 * Runs the init wizard in re-init mode (`ralphai init --force`). The
 * wizard pre-fills current values as defaults. Cancelling with Ctrl+C
 * returns to the menu with no changes.
 *
 * @returns `"continue"` — always returns to the menu.
 */
export async function handleEditConfig(): Promise<"continue"> {
  const originalExit = process.exit;
  try {
    process.exit = (() => {
      throw new ExitIntercepted();
    }) as never;
    await runRalphai(["init", "--force"]);
  } catch (e) {
    if (!(e instanceof ExitIntercepted)) {
      throw e;
    }
    // Init wizard was cancelled or failed — user saw any output
  } finally {
    process.exit = originalExit;
  }
  return "continue";
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Sentinel error thrown when `process.exit` is intercepted.
 * Used to prevent delegated commands from killing the menu loop.
 */
class ExitIntercepted extends Error {
  constructor() {
    super("process.exit intercepted");
    this.name = "ExitIntercepted";
  }
}

// Re-export for testing
export { ExitIntercepted };
