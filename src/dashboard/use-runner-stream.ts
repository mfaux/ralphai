/**
 * useRunnerStream — React hook for IPC streaming from a runner.
 *
 * Manages the `net.Socket` lifecycle, reconnection with exponential backoff,
 * and stale socket detection. Connects when `socketPath` is non-null,
 * disconnects on cleanup or when `socketPath` changes.
 *
 * **Reconnection**: When the connection drops unexpectedly, retries with
 * exponential backoff (100ms → 200ms → ... → 3s cap). Stops when:
 * - `socketPath` becomes null (plan no longer in-progress)
 * - A `complete` message was received before disconnect
 *
 * **Stale socket detection**: Before connecting, checks PID liveness via
 * `runner.pid`. Dead PID → delete socket, fall back to polling.
 *
 * **Catch-up on reconnect**: On each successful (re)connect, performs a
 * fresh tail read of `agent-output.log` to fill gaps from the disconnect.
 *
 * Not tested per DESIGN.md convention (thin React glue, no pure logic).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { connect, type Socket } from "net";
import { existsSync } from "fs";
import { join } from "path";
import {
  createStreamClientState,
  applyEvent,
  getReconnectDelay,
  type StreamClientState,
} from "./stream-client.ts";
import { loadOutputTailAsync } from "./data/output.ts";
import { checkSocketStatus, removeStaleSocket } from "./stale-socket.ts";
import type { PlanInfo } from "./types.ts";

export interface RunnerStreamResult {
  /** Output lines from IPC streaming. */
  outputLines: string[];
  /** Whether the IPC connection is active. */
  connected: boolean;
  /** Accumulated progress content from IPC progress messages. */
  progressContent: string;
  /** Latest tasks-completed count from IPC receipt messages. */
  tasksCompleted: number;
  /** Whether a completion message was received. */
  completed: boolean;
}

/**
 * Connect to a runner's IPC socket and stream output in real-time.
 *
 * When `socketPath` is non-null and the socket file exists, connects
 * and streams output. On each connect/reconnect, performs a tail read
 * of `agent-output.log` to populate/refresh historical output, then
 * appends IPC data after it.
 *
 * When `socketPath` is null (no runner, or no socket file), returns
 * empty state so the caller can fall back to file-based polling.
 *
 * @param pidFilePath - Path to the runner.pid file for stale detection.
 *                      If null, stale detection is skipped.
 */
export function useRunnerStream(
  socketPath: string | null,
  repoPath: string | null,
  plan: PlanInfo | null,
  pidFilePath?: string | null,
): RunnerStreamResult {
  const stateRef = useRef<StreamClientState>(createStreamClientState());
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [historicalLines, setHistoricalLines] = useState<string[]>([]);
  const [progressContent, setProgressContent] = useState("");
  const [tasksCompleted, setTasksCompleted] = useState(0);
  const [completed, setCompleted] = useState(false);

  // Track the current socketPath in a ref so the reconnect timer can
  // check whether reconnection should continue (socketPath may have
  // changed between scheduling and firing).
  const socketPathRef = useRef(socketPath);
  socketPathRef.current = socketPath;

  /** Sync React state from the pure state machine. */
  const syncState = useCallback((hist: string[]) => {
    const s = stateRef.current;
    const ipcLines = s.outputLines.toArray();
    setOutputLines([...hist, ...ipcLines]);
    setProgressContent(s.progressContent);
    setTasksCompleted(s.tasksCompleted);
    setCompleted(s.completed);
  }, []);

  /** Perform catch-up read and return the historical lines. */
  const doCatchUp = useCallback(
    async (repo: string, p: PlanInfo): Promise<string[]> => {
      try {
        const result = await loadOutputTailAsync(repo, p);
        if (result && result.content) {
          return result.content.split("\n");
        }
      } catch {
        // Non-fatal — continue with IPC data only
      }
      return [];
    },
    [],
  );

  /** Attempt a connection to the socket path. */
  const attemptConnect = useCallback(
    (path: string, repo: string | null, p: PlanInfo | null) => {
      // Stale socket check
      if (pidFilePath) {
        const status = checkSocketStatus(pidFilePath);
        if (status.status === "stale") {
          removeStaleSocket(path);
          return; // Fall back to polling
        }
        if (status.status === "no-pid-file") {
          return; // No runner, fall back to polling
        }
      }

      if (!existsSync(path)) {
        return; // Socket file gone (runner exited cleanly)
      }

      stateRef.current = applyEvent(stateRef.current, {
        type: "connect-start",
      });

      const socket = connect(path, () => {
        stateRef.current = applyEvent(stateRef.current, {
          type: "connect-success",
        });
        setConnected(true);

        // Catch-up: fresh tail read on every connect/reconnect
        if (repo && p) {
          doCatchUp(repo, p).then((lines) => {
            setHistoricalLines(lines);
            syncState(lines);
          });
        }
      });

      socketRef.current = socket;

      socket.on("data", (data: Buffer) => {
        applyEvent(stateRef.current, { type: "data", chunk: data.toString() });
        syncState(historicalLines);
      });

      socket.on("close", () => {
        stateRef.current = applyEvent(stateRef.current, {
          type: "disconnect",
        });
        setConnected(false);
        socketRef.current = null;

        // Schedule reconnection if the plan is still in-progress
        // and we didn't receive a complete message
        if (socketPathRef.current === path && !stateRef.current.completed) {
          scheduleReconnect(path, repo, p);
        }
      });

      socket.on("error", () => {
        stateRef.current = applyEvent(stateRef.current, { type: "error" });
        setConnected(false);
        socketRef.current = null;

        // ECONNREFUSED with a live PID = possible PID recycling.
        // Don't delete the socket, just fall back to polling gracefully.
        // Schedule reconnect to try again later.
        if (socketPathRef.current === path && !stateRef.current.completed) {
          scheduleReconnect(path, repo, p);
        }
      });
    },
    [pidFilePath, doCatchUp, syncState, historicalLines],
  );

  /** Schedule a reconnection attempt with exponential backoff. */
  const scheduleReconnect = useCallback(
    (path: string, repo: string | null, p: PlanInfo | null) => {
      // Clear any existing timer
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      const delay = getReconnectDelay(stateRef.current.reconnectAttempts);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;

        // Guard: stop if socketPath changed (plan transitioned)
        if (socketPathRef.current !== path) {
          return;
        }

        attemptConnect(path, repo, p);
      }, delay);
    },
    [attemptConnect],
  );

  useEffect(() => {
    // Reset when socketPath changes (new plan, plan completed, etc.)
    stateRef.current = applyEvent(stateRef.current, { type: "reset" });
    setHistoricalLines([]);
    setOutputLines([]);
    setConnected(false);
    setProgressContent("");
    setTasksCompleted(0);
    setCompleted(false);

    // Cancel any pending reconnect
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (!socketPath) {
      return;
    }

    attemptConnect(socketPath, repoPath, plan);

    return () => {
      // Cleanup: destroy socket, cancel timers
      if (socketRef.current) {
        socketRef.current.destroy();
        socketRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      stateRef.current = applyEvent(stateRef.current, { type: "reset" });
      setConnected(false);
    };
  }, [socketPath]);

  // Re-compute output when historical lines arrive
  useEffect(() => {
    if (historicalLines.length > 0) {
      const ipcLines = stateRef.current.outputLines.toArray();
      setOutputLines([...historicalLines, ...ipcLines]);
    }
  }, [historicalLines]);

  return { outputLines, connected, progressContent, tasksCompleted, completed };
}
