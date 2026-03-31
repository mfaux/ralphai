/**
 * Tests for the runner stream client (pure logic).
 */

import { describe, test, expect } from "bun:test";
import {
  serialize,
  type IpcMessage,
  type OutputMessage,
} from "../ipc-protocol.ts";
import {
  createStreamClientState,
  applyEvent,
  type StreamClientState,
  type StreamEvent,
} from "./stream-client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply multiple events in sequence. */
function applyEvents(
  state: StreamClientState,
  events: StreamEvent[],
): StreamClientState {
  let s = state;
  for (const event of events) {
    s = applyEvent(s, event);
  }
  return s;
}

/** Create a connected client state (shortcut for tests). */
function connectedState(capacity = 200): StreamClientState {
  return applyEvents(createStreamClientState(capacity), [
    { type: "connect-start" },
    { type: "connect-success" },
  ]);
}

// ---------------------------------------------------------------------------
// Connection state machine
// ---------------------------------------------------------------------------

describe("connection state machine", () => {
  test("initial state is idle", () => {
    const state = createStreamClientState();
    expect(state.connectionState).toBe("idle");
  });

  test("idle -> connecting on connect-start", () => {
    const state = createStreamClientState();
    const next = applyEvent(state, { type: "connect-start" });
    expect(next.connectionState).toBe("connecting");
  });

  test("connecting -> connected on connect-success", () => {
    const state = applyEvents(createStreamClientState(), [
      { type: "connect-start" },
    ]);
    const next = applyEvent(state, { type: "connect-success" });
    expect(next.connectionState).toBe("connected");
  });

  test("connecting -> disconnected on error", () => {
    const state = applyEvents(createStreamClientState(), [
      { type: "connect-start" },
    ]);
    const next = applyEvent(state, { type: "error" });
    expect(next.connectionState).toBe("disconnected");
  });

  test("connecting -> disconnected on disconnect", () => {
    const state = applyEvents(createStreamClientState(), [
      { type: "connect-start" },
    ]);
    const next = applyEvent(state, { type: "disconnect" });
    expect(next.connectionState).toBe("disconnected");
  });

  test("connected -> disconnected on disconnect", () => {
    const state = connectedState();
    const next = applyEvent(state, { type: "disconnect" });
    expect(next.connectionState).toBe("disconnected");
  });

  test("connected -> disconnected on error", () => {
    const state = connectedState();
    const next = applyEvent(state, { type: "error" });
    expect(next.connectionState).toBe("disconnected");
  });

  test("disconnected -> connecting on connect-start", () => {
    const state = applyEvents(createStreamClientState(), [
      { type: "connect-start" },
      { type: "disconnect" },
    ]);
    expect(state.connectionState).toBe("disconnected");
    const next = applyEvent(state, { type: "connect-start" });
    expect(next.connectionState).toBe("connecting");
  });

  test("idle ignores connect-success", () => {
    const state = createStreamClientState();
    const next = applyEvent(state, { type: "connect-success" });
    expect(next.connectionState).toBe("idle");
  });

  test("idle ignores disconnect", () => {
    const state = createStreamClientState();
    const next = applyEvent(state, { type: "disconnect" });
    expect(next.connectionState).toBe("idle");
  });

  test("idle ignores data", () => {
    const state = createStreamClientState();
    const next = applyEvent(state, { type: "data", chunk: "hello" });
    expect(next.connectionState).toBe("idle");
    expect(next.outputLines.length).toBe(0);
  });

  test("reset clears state and returns to idle", () => {
    const state = connectedState();
    // Push some data
    const msg: OutputMessage = {
      type: "output",
      data: "hello",
      stream: "stdout",
    };
    applyEvent(state, { type: "data", chunk: serialize(msg) });
    expect(state.outputLines.length).toBeGreaterThan(0);

    const next = applyEvent(state, { type: "reset" });
    expect(next.connectionState).toBe("idle");
    expect(next.outputLines.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

describe("message parsing", () => {
  test("parses output message and pushes lines", () => {
    const state = connectedState();
    const msg: OutputMessage = {
      type: "output",
      data: "hello world",
      stream: "stdout",
    };
    applyEvent(state, { type: "data", chunk: serialize(msg) });

    expect(state.outputLines.length).toBe(1);
    expect(state.outputLines.toArray()).toEqual(["hello world"]);
  });

  test("splits multi-line output data into individual lines", () => {
    const state = connectedState();
    const msg: OutputMessage = {
      type: "output",
      data: "line1\nline2\nline3",
      stream: "stdout",
    };
    applyEvent(state, { type: "data", chunk: serialize(msg) });

    expect(state.outputLines.length).toBe(3);
    expect(state.outputLines.toArray()).toEqual(["line1", "line2", "line3"]);
  });

  test("handles multiple messages in a single chunk", () => {
    const state = connectedState();
    const msgs: OutputMessage[] = [
      { type: "output", data: "first", stream: "stdout" },
      { type: "output", data: "second", stream: "stderr" },
    ];
    const chunk = msgs.map(serialize).join("");
    applyEvent(state, { type: "data", chunk });

    expect(state.outputLines.length).toBe(2);
    expect(state.outputLines.toArray()).toEqual(["first", "second"]);
  });

  test("handles partial lines across chunk boundaries", () => {
    const state = connectedState();
    const msg: OutputMessage = {
      type: "output",
      data: "complete line",
      stream: "stdout",
    };
    const full = serialize(msg);
    const splitPoint = Math.floor(full.length / 2);

    // First chunk: partial line
    applyEvent(state, { type: "data", chunk: full.slice(0, splitPoint) });
    expect(state.outputLines.length).toBe(0);
    expect(state.lineBuffer.length).toBeGreaterThan(0);

    // Second chunk: completes the line
    applyEvent(state, { type: "data", chunk: full.slice(splitPoint) });
    expect(state.outputLines.length).toBe(1);
    expect(state.outputLines.toArray()).toEqual(["complete line"]);
  });

  test("buffers data across multiple partial chunks", () => {
    const state = connectedState();
    const msg: OutputMessage = {
      type: "output",
      data: "assembled from parts",
      stream: "stdout",
    };
    const full = serialize(msg);

    // Split into 4 parts
    const partLen = Math.ceil(full.length / 4);
    const parts = [];
    for (let i = 0; i < full.length; i += partLen) {
      parts.push(full.slice(i, i + partLen));
    }

    for (const part of parts) {
      applyEvent(state, { type: "data", chunk: part });
    }

    expect(state.outputLines.length).toBe(1);
    expect(state.outputLines.toArray()).toEqual(["assembled from parts"]);
  });

  test("ignores non-output message types", () => {
    const state = connectedState();
    const msgs: IpcMessage[] = [
      { type: "progress", tasksCompleted: 1, totalTasks: 5 },
      { type: "receipt", fields: { branch: "test" } },
      { type: "complete", success: true },
    ];

    for (const msg of msgs) {
      applyEvent(state, { type: "data", chunk: serialize(msg) });
    }

    // No output lines should be added
    expect(state.outputLines.length).toBe(0);
  });

  test("handles mixed message types", () => {
    const state = connectedState();
    const chunk =
      serialize({
        type: "output",
        data: "hello",
        stream: "stdout",
      } as OutputMessage) +
      serialize({ type: "progress", tasksCompleted: 1, totalTasks: 3 }) +
      serialize({
        type: "output",
        data: "world",
        stream: "stderr",
      } as OutputMessage);

    applyEvent(state, { type: "data", chunk });

    expect(state.outputLines.length).toBe(2);
    expect(state.outputLines.toArray()).toEqual(["hello", "world"]);
  });

  test("ignores invalid JSON lines", () => {
    const state = connectedState();
    const chunk =
      "{invalid json}\n" +
      serialize({
        type: "output",
        data: "valid",
        stream: "stdout",
      } as OutputMessage);

    applyEvent(state, { type: "data", chunk });

    expect(state.outputLines.length).toBe(1);
    expect(state.outputLines.toArray()).toEqual(["valid"]);
  });

  test("data in non-connected state is ignored", () => {
    // In connecting state
    const state = applyEvent(createStreamClientState(), {
      type: "connect-start",
    });
    const msg: OutputMessage = {
      type: "output",
      data: "ignored",
      stream: "stdout",
    };
    applyEvent(state, { type: "data", chunk: serialize(msg) });
    expect(state.outputLines.length).toBe(0);

    // In disconnected state
    const disconnected = applyEvent(state, { type: "disconnect" });
    applyEvent(disconnected, { type: "data", chunk: serialize(msg) });
    expect(disconnected.outputLines.length).toBe(0);
  });

  test("disconnect clears line buffer", () => {
    const state = connectedState();
    const msg: OutputMessage = {
      type: "output",
      data: "partial",
      stream: "stdout",
    };
    const full = serialize(msg);
    // Send partial data
    applyEvent(state, { type: "data", chunk: full.slice(0, 5) });
    expect(state.lineBuffer.length).toBeGreaterThan(0);

    // Disconnect should clear the buffer
    const next = applyEvent(state, { type: "disconnect" });
    expect(next.lineBuffer).toBe("");
  });

  test("output with trailing newline in data produces empty trailing line", () => {
    const state = connectedState();
    const msg: OutputMessage = {
      type: "output",
      data: "hello\n",
      stream: "stdout",
    };
    applyEvent(state, { type: "data", chunk: serialize(msg) });

    // "hello\n".split("\n") = ["hello", ""]
    expect(state.outputLines.length).toBe(2);
    expect(state.outputLines.toArray()).toEqual(["hello", ""]);
  });
});

// ---------------------------------------------------------------------------
// Ring buffer overflow via stream
// ---------------------------------------------------------------------------

describe("ring buffer overflow via stream", () => {
  test("overflow evicts oldest lines", () => {
    const state = connectedState(3); // Tiny buffer

    const msgs: OutputMessage[] = [
      { type: "output", data: "line1", stream: "stdout" },
      { type: "output", data: "line2", stream: "stdout" },
      { type: "output", data: "line3", stream: "stdout" },
      { type: "output", data: "line4", stream: "stdout" }, // Evicts line1
    ];

    for (const msg of msgs) {
      applyEvent(state, { type: "data", chunk: serialize(msg) });
    }

    expect(state.outputLines.length).toBe(3);
    expect(state.outputLines.toArray()).toEqual(["line2", "line3", "line4"]);
  });
});
