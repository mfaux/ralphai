/**
 * Runner stream client — pure logic for the dashboard side.
 *
 * Connection state machine and line-buffered message parser.
 * No React, no socket I/O — pure functions taking state + event -> new state.
 *
 * The React hook (`useRunnerStream`) wraps this with actual `net.Socket`
 * lifecycle management.
 */

import {
  deserialize,
  type IpcMessage,
  type OutputMessage,
  type ProgressMessage,
  type ReceiptMessage,
} from "../ipc-protocol.ts";
import { RingBuffer } from "./ring-buffer.ts";

// ---------------------------------------------------------------------------
// Connection state machine
// ---------------------------------------------------------------------------

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected";

export interface StreamClientState {
  /** Current connection state. */
  connectionState: ConnectionState;
  /** Ring buffer holding output lines. */
  outputLines: RingBuffer<string>;
  /** Incomplete line buffer for partial-line buffering across chunks. */
  lineBuffer: string;
  /** Accumulated progress content from progress messages. */
  progressContent: string;
  /** Latest tasks-completed count from receipt messages. */
  tasksCompleted: number;
  /** Whether a complete message has been received. */
  completed: boolean;
  /** Number of reconnection attempts since last successful connect. */
  reconnectAttempts: number;
}

/** Events that drive state transitions. */
export type StreamEvent =
  | { type: "connect-start" }
  | { type: "connect-success" }
  | { type: "disconnect" }
  | { type: "data"; chunk: string }
  | { type: "error" }
  | { type: "reset" };

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

/** Create a fresh stream client state. */
export function createStreamClientState(capacity = 200): StreamClientState {
  return {
    connectionState: "idle",
    outputLines: new RingBuffer<string>(capacity),
    lineBuffer: "",
    progressContent: "",
    tasksCompleted: 0,
    completed: false,
    reconnectAttempts: 0,
  };
}

// ---------------------------------------------------------------------------
// State transitions (pure)
// ---------------------------------------------------------------------------

/**
 * Apply an event to the stream client state, returning the new state.
 *
 * This is a pure reducer: it mutates the ring buffer in-place for
 * performance (ring buffers are mutable by design), but returns a new
 * state object when the connection state changes so React can detect
 * the change via reference equality.
 */
export function applyEvent(
  state: StreamClientState,
  event: StreamEvent,
): StreamClientState {
  switch (event.type) {
    case "connect-start":
      if (
        state.connectionState === "idle" ||
        state.connectionState === "disconnected"
      ) {
        return { ...state, connectionState: "connecting" };
      }
      return state;

    case "connect-success":
      if (state.connectionState === "connecting") {
        return { ...state, connectionState: "connected", reconnectAttempts: 0 };
      }
      return state;

    case "disconnect":
    case "error":
      if (
        state.connectionState === "connecting" ||
        state.connectionState === "connected"
      ) {
        return {
          ...state,
          connectionState: "disconnected",
          lineBuffer: "",
          reconnectAttempts: state.reconnectAttempts + 1,
        };
      }
      return state;

    case "data":
      if (state.connectionState === "connected") {
        processChunk(state, event.chunk);
      }
      return state;

    case "reset":
      state.outputLines.clear();
      return {
        ...state,
        connectionState: "idle",
        lineBuffer: "",
        progressContent: "",
        tasksCompleted: 0,
        completed: false,
        reconnectAttempts: 0,
      };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Chunk processing (line-buffered parser)
// ---------------------------------------------------------------------------

/**
 * Process a raw data chunk from the socket. Handles partial lines
 * across chunk boundaries by maintaining a line buffer.
 *
 * Output messages have their `data` field split into individual lines
 * and pushed to the ring buffer.
 */
function processChunk(state: StreamClientState, chunk: string): void {
  const combined = state.lineBuffer + chunk;
  const lines = combined.split("\n");

  // The last element is either empty (if chunk ended with \n) or
  // an incomplete line to buffer for the next chunk
  state.lineBuffer = lines.pop() ?? "";

  for (const line of lines) {
    const msg = deserialize(line);
    if (!msg) continue;

    handleMessage(state, msg);
  }
}

/**
 * Handle a parsed IPC message. Dispatches on message type to update
 * the appropriate state fields.
 */
function handleMessage(state: StreamClientState, msg: IpcMessage): void {
  switch (msg.type) {
    case "output":
      pushOutputLines(state.outputLines, (msg as OutputMessage).data);
      break;
    case "progress": {
      const pm = msg as ProgressMessage;
      // Accumulate iteration blocks (same format as appendProgressBlock)
      const block = `\n### Iteration ${pm.iteration}\n${pm.content}\n`;
      state.progressContent += block;
      break;
    }
    case "receipt": {
      const rm = msg as ReceiptMessage;
      state.tasksCompleted = rm.tasksCompleted;
      break;
    }
    case "complete":
      state.completed = true;
      break;
  }
}

/**
 * Split output data into individual lines and push each to the ring buffer.
 */
function pushOutputLines(buffer: RingBuffer<string>, data: string): void {
  const lines = data.split("\n");
  for (const line of lines) {
    buffer.push(line);
  }
}

// ---------------------------------------------------------------------------
// Reconnection backoff (pure)
// ---------------------------------------------------------------------------

/** Reconnection backoff constants. */
export const BACKOFF_INITIAL_MS = 100;
export const BACKOFF_MAX_MS = 3_000;

/**
 * Compute the reconnection delay for the current attempt.
 *
 * Exponential backoff: 100ms → 200ms → 400ms → 800ms → 1600ms → 3000ms (cap).
 * Pure function — no side effects.
 */
export function getReconnectDelay(attempts: number): number {
  const delay = BACKOFF_INITIAL_MS * Math.pow(2, attempts);
  return Math.min(delay, BACKOFF_MAX_MS);
}
