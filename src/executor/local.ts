/**
 * LocalExecutor — runs the agent as a local child process.
 *
 * Extracted from the original `spawnAgent()` function in `src/runner.ts`.
 * Preserves identical behavior: stdio passthrough, timeout via
 * AbortController, exit code handling, and IPC broadcast.
 */

import type {
  AgentExecutor,
  ExecutorSpawnOptions,
  ExecutorSpawnResult,
} from "./types.ts";

import { shellSplit } from "../shell-split.ts";
import { resolveAgentVerboseFlags } from "./agent-flags.ts";
import { spawnChild } from "./spawn-child.ts";

// ---------------------------------------------------------------------------
// LocalExecutor
// ---------------------------------------------------------------------------

/**
 * Executes the agent command as a local child process on the host.
 *
 * This is the default executor when `sandbox` is `"none"`. It inherits
 * the current `process.env` (with an optional `RALPHAI_NONCE` override),
 * passes stdio through to the terminal, and supports per-iteration
 * timeout via `AbortController`.
 */
export class LocalExecutor implements AgentExecutor {
  async spawn(opts: ExecutorSpawnOptions): Promise<ExecutorSpawnResult> {
    const {
      agentCommand,
      prompt,
      iterationTimeout,
      cwd,
      outputLogPath,
      ipcBroadcast,
      nonce,
      verbose,
      agentVerboseFlags,
    } = opts;

    // Split the agent command respecting quotes
    const parts = shellSplit(agentCommand);
    const cmd = parts[0]!;
    // Inject verbose flags between command parts and prompt when --verbose is active
    const verboseFlags = verbose
      ? resolveAgentVerboseFlags(agentCommand, agentVerboseFlags)
      : [];
    const args = [...parts.slice(1), ...verboseFlags, prompt];

    return spawnChild({
      command: cmd,
      args,
      spawnOptions: {
        cwd,
        env: {
          ...process.env,
          HUSKY: "0",
          ...(nonce ? { RALPHAI_NONCE: nonce } : {}),
        },
      },
      iterationTimeout,
      outputLogPath,
      ipcBroadcast,
      errorLabel: "agent",
    });
  }
}
