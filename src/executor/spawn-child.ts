/**
 * Shared child-process lifecycle helper used by both LocalExecutor and
 * DockerExecutor.
 *
 * Encapsulates the common pattern of spawning a process with optional
 * timeout, stdout/stderr passthrough, log streaming, IPC broadcast,
 * and exit/error handling.
 */

import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { createWriteStream } from "fs";

import type { ExecutorSpawnResult } from "./types.ts";
import type { IpcMessage } from "../ipc-protocol.ts";

/** Options for the shared spawn helper. */
export interface SpawnChildOptions {
  /** The command to run (e.g. "claude" or "docker"). */
  command: string;
  /** Arguments to the command. */
  args: string[];
  /** spawn() options (cwd, env, etc. — stdio is always overridden). */
  spawnOptions?: Omit<SpawnOptions, "stdio" | "signal">;
  /** Timeout in seconds (0 = no timeout). */
  iterationTimeout: number;
  /** Optional path to append agent output to. */
  outputLogPath?: string;
  /** Optional IPC broadcast callback for streaming output. */
  ipcBroadcast?: (msg: IpcMessage) => void;
  /** Label for error messages (e.g. "agent" or "Docker container"). */
  errorLabel: string;
}

/**
 * Spawn a child process and manage its lifecycle.
 *
 * Handles:
 * - Optional output log file (append mode, best-effort)
 * - Optional timeout via AbortController
 * - stdin close (so the child knows no input is coming)
 * - stdout/stderr passthrough to the terminal, log file, and IPC
 * - Exit code and timeout reporting
 */
export function spawnChild(
  opts: SpawnChildOptions,
): Promise<ExecutorSpawnResult> {
  const {
    command,
    args,
    spawnOptions = {},
    iterationTimeout,
    outputLogPath,
    ipcBroadcast,
    errorLabel,
  } = opts;

  return new Promise((resolve) => {
    // Open a write stream for the agent output log (append mode).
    let logStream: ReturnType<typeof createWriteStream> | undefined;
    if (outputLogPath) {
      try {
        logStream = createWriteStream(outputLogPath, { flags: "a" });
      } catch {
        // Best-effort: if we can't open the log, continue without it
      }
    }

    let ac: AbortController | undefined;
    let timedOut = false;

    const finalOpts: SpawnOptions = {
      ...spawnOptions,
      stdio: ["pipe", "pipe", "pipe"] as const,
    };

    if (iterationTimeout > 0) {
      ac = new AbortController();
      (finalOpts as any).signal = ac.signal;
      setTimeout(() => {
        timedOut = true;
        ac!.abort();
      }, iterationTimeout * 1000);
    }

    let child: ChildProcess;
    try {
      child = spawn(command, args, finalOpts);
    } catch (err) {
      console.error(
        `Failed to spawn ${errorLabel}: ${err instanceof Error ? err.message : err}`,
      );
      logStream?.end();
      resolve({ output: "", exitCode: 1, timedOut: false });
      return;
    }

    // Close stdin so the child knows no input is coming.
    child.stdin?.end();

    const chunks: Buffer[] = [];

    child.stdout?.on("data", (data: Buffer) => {
      process.stdout.write(data);
      logStream?.write(data);
      chunks.push(data);
      ipcBroadcast?.({
        type: "output",
        data: data.toString(),
        stream: "stdout",
      });
    });

    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
      logStream?.write(data);
      chunks.push(data);
      ipcBroadcast?.({
        type: "output",
        data: data.toString(),
        stream: "stderr",
      });
    });

    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf-8");
      if (logStream) {
        logStream.end(() => {
          resolve({ output, exitCode: code ?? 1, timedOut });
        });
      } else {
        resolve({ output, exitCode: code ?? 1, timedOut });
      }
    });

    child.on("error", (err) => {
      logStream?.end();
      if (timedOut) {
        const output = Buffer.concat(chunks).toString("utf-8");
        resolve({ output, exitCode: 124, timedOut: true });
      } else {
        console.error(`${errorLabel} error: ${err.message}`);
        const output = Buffer.concat(chunks).toString("utf-8");
        resolve({ output, exitCode: 1, timedOut: false });
      }
    });
  });
}
