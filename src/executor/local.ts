/**
 * LocalExecutor — runs the agent as a local child process.
 *
 * Extracted from the original `spawnAgent()` function in `src/runner.ts`.
 * Preserves identical behavior: stdio passthrough, timeout via
 * AbortController, exit code handling, and IPC broadcast.
 */

import { spawn, type ChildProcess } from "child_process";
import { createWriteStream } from "fs";

import type {
  AgentExecutor,
  ExecutorSpawnOptions,
  ExecutorSpawnResult,
} from "./types.ts";

import { shellSplit } from "../shell-split.ts";
import { resolveAgentVerboseFlags } from "./agent-flags.ts";

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

    return new Promise((resolve) => {
      // Split the agent command respecting quotes
      const parts = shellSplit(agentCommand);
      const cmd = parts[0]!;
      // Inject verbose flags between command parts and prompt when --verbose is active
      const verboseFlags = verbose
        ? resolveAgentVerboseFlags(agentCommand, agentVerboseFlags)
        : [];
      const args = [...parts.slice(1), ...verboseFlags, prompt];

      // Open a write stream for the agent output log (append mode).
      // Errors are swallowed so logging never breaks the run.
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
      const spawnOpts: {
        cwd: string;
        stdio: ["pipe", "pipe", "pipe"];
        signal?: AbortSignal;
        env?: Record<string, string | undefined>;
      } = {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: nonce ? { ...process.env, RALPHAI_NONCE: nonce } : undefined,
      };

      if (iterationTimeout > 0) {
        ac = new AbortController();
        spawnOpts.signal = ac.signal;
        setTimeout(() => {
          timedOut = true;
          ac!.abort();
        }, iterationTimeout * 1000);
      }

      let child: ChildProcess;
      try {
        child = spawn(cmd, args, spawnOpts);
      } catch (err) {
        console.error(
          `Failed to spawn agent: ${err instanceof Error ? err.message : err}`,
        );
        logStream?.end();
        resolve({ output: "", exitCode: 1, timedOut: false });
        return;
      }

      // Close stdin so the agent knows no input is coming.
      // Without this, agents that read or wait for stdin EOF will hang.
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
          console.error(`Agent error: ${err.message}`);
          const output = Buffer.concat(chunks).toString("utf-8");
          resolve({ output, exitCode: 1, timedOut: false });
        }
      });
    });
  }
}
