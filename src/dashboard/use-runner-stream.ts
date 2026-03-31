/**
 * useRunnerStream — React hook for IPC streaming from a runner.
 *
 * Thin wrapper managing the actual `net.Socket` lifecycle via `useEffect`
 * cleanup. Connects when `socketPath` is non-null, disconnects on cleanup.
 *
 * Not tested per DESIGN.md convention (thin React glue, no pure logic).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { connect, type Socket } from "net";
import { existsSync } from "fs";
import {
  createStreamClientState,
  applyEvent,
  type StreamClientState,
} from "./stream-client.ts";
import { loadOutputTailAsync } from "./data/output.ts";
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
 * and streams output. On initial connect, performs a one-time tail read
 * of `agent-output.log` to populate historical output, then appends
 * IPC data after it.
 *
 * When `socketPath` is null (no runner, or no socket file), returns
 * empty state so the caller can fall back to file-based polling.
 */
export function useRunnerStream(
  socketPath: string | null,
  repoPath: string | null,
  plan: PlanInfo | null,
): RunnerStreamResult {
  const stateRef = useRef<StreamClientState>(createStreamClientState());
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [historicalLines, setHistoricalLines] = useState<string[]>([]);
  const [progressContent, setProgressContent] = useState("");
  const [tasksCompleted, setTasksCompleted] = useState(0);
  const [completed, setCompleted] = useState(false);
  const catchUpDoneRef = useRef(false);

  /** Sync React state from the pure state machine. */
  const syncState = useCallback(() => {
    const s = stateRef.current;
    const ipcLines = s.outputLines.toArray();
    setOutputLines([...historicalLines, ...ipcLines]);
    setProgressContent(s.progressContent);
    setTasksCompleted(s.tasksCompleted);
    setCompleted(s.completed);
  }, [historicalLines]);

  useEffect(() => {
    // Reset when socketPath changes
    stateRef.current = createStreamClientState();
    catchUpDoneRef.current = false;
    setHistoricalLines([]);
    setOutputLines([]);
    setConnected(false);
    setProgressContent("");
    setTasksCompleted(0);
    setCompleted(false);

    if (!socketPath || !existsSync(socketPath)) {
      return;
    }

    stateRef.current = applyEvent(stateRef.current, { type: "connect-start" });

    const socket = connect(socketPath, () => {
      stateRef.current = applyEvent(stateRef.current, {
        type: "connect-success",
      });
      setConnected(true);

      // One-time catch-up: read historical output from the log file
      if (!catchUpDoneRef.current && repoPath && plan) {
        catchUpDoneRef.current = true;
        loadOutputTailAsync(repoPath, plan).then((result) => {
          if (result && result.content) {
            const lines = result.content.split("\n");
            setHistoricalLines(lines);
          }
        });
      }
    });

    socketRef.current = socket;

    socket.on("data", (data: Buffer) => {
      applyEvent(stateRef.current, { type: "data", chunk: data.toString() });
      syncState();
    });

    socket.on("close", () => {
      stateRef.current = applyEvent(stateRef.current, { type: "disconnect" });
      setConnected(false);
    });

    socket.on("error", () => {
      stateRef.current = applyEvent(stateRef.current, { type: "error" });
      setConnected(false);
    });

    return () => {
      socket.destroy();
      socketRef.current = null;
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
