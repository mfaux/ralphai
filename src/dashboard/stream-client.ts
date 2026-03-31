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
        return { ...state, connectionState: "connected" };
      }
      return state;

    case "disconnect":
    case "error":
      if (
        state.connectionState === "connecting" ||
        state.connectionState === "connected"
      ) {
        return { ...state, connectionState: "disconnected", lineBuffer: "" };
      }
      return state;

    case "data":
      if (state.connectionState === "connected") {
        processChunk(state, event.chunk);
      }
      return state;

    case "reset":
      state.outputLines.clear();
      return { ...state, connectionState: "idle", lineBuffer: "" };

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
 * Handle a parsed IPC message. Currently only processes `output` messages;
 * other types are reserved for future slices.
 */
function handleMessage(state: StreamClientState, msg: IpcMessage): void {
  switch (msg.type) {
    case "output":
      pushOutputLines(state.outputLines, (msg as OutputMessage).data);
      break;
    case "progress":
    case "receipt":
    case "complete":
      // Reserved for future slices — no-op for now
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
