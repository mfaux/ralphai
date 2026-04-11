/**
 * Executor abstraction — interface for agent process execution.
 *
 * Defines the contract that all executor implementations must satisfy.
 * The runner calls `executor.spawn()` instead of invoking `spawnAgent()`
 * directly, enabling different execution strategies (local, Docker, etc.).
 */

import type { IpcMessage } from "../ipc-protocol.ts";

// ---------------------------------------------------------------------------
// Spawn options and result types
// ---------------------------------------------------------------------------

/** Options passed to `AgentExecutor.spawn()`. */
export interface ExecutorSpawnOptions {
  /** The full agent command string (e.g. "claude -p"). */
  agentCommand: string;
  /** The prompt to pass as the final argument. */
  prompt: string;
  /** Timeout in seconds (0 = no timeout). */
  iterationTimeout: number;
  /** Working directory for the agent process. */
  cwd: string;
  /** Optional path to append agent output to. */
  outputLogPath?: string;
  /** Optional IPC broadcast callback for streaming output. */
  ipcBroadcast?: (msg: IpcMessage) => void;
  /** Optional nonce injected as RALPHAI_NONCE env var. */
  nonce?: string;
  /** Optional path to the feedback wrapper script (bind-mounted into Docker). */
  feedbackWrapperPath?: string;
  /**
   * When true, agent-specific verbose/debug flags are injected into the
   * command before the prompt argument. The exact flags depend on the
   * detected agent type (see `resolveAgentVerboseFlags`).
   */
  verbose?: boolean;
  /**
   * User-provided override for agent verbose flags (from `agentVerboseFlags`
   * config key). When set, these flags are used instead of the built-in map.
   */
  agentVerboseFlags?: string;
}

/** Result returned by `AgentExecutor.spawn()`. */
export interface ExecutorSpawnResult {
  /** Combined stdout + stderr output. */
  output: string;
  /** Process exit code (1 if unknown). */
  exitCode: number;
  /** Whether the process was killed due to timeout. */
  timedOut: boolean;
}

// ---------------------------------------------------------------------------
// Executor interface
// ---------------------------------------------------------------------------

/**
 * Agent executor interface.
 *
 * Implementations control how the agent process is spawned and managed.
 * The runner is agnostic to the execution strategy — it only calls
 * `spawn()` and processes the result.
 */
export interface AgentExecutor {
  /** Spawn the agent process and return its result. */
  spawn(opts: ExecutorSpawnOptions): Promise<ExecutorSpawnResult>;
}
