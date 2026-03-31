/**
 * Tests for the IPC server module.
 *
 * Uses real net.Server/net.Socket pairs to verify broadcast delivery
 * and multi-client support.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { connect, type Socket } from "net";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { createIpcServer, type IpcServer } from "./ipc-server.ts";
import {
  deserialize,
  type OutputMessage,
  type ProgressMessage,
  type ReceiptMessage,
  type CompleteMessage,
  type IpcMessage,
} from "./ipc-protocol.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let server: IpcServer | null = null;
const openSockets: Socket[] = [];

function freshSocketPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "ipc-test-"));
  return join(tmpDir, "test.sock");
}

function connectClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => {
      openSockets.push(socket);
      resolve(socket);
    });
    socket.on("error", reject);
  });
}

/** Collect data from a socket until it receives at least `count` newline-delimited messages. */
function collectMessages(
  socket: Socket,
  count: number,
  timeoutMs = 2000,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    let buffer = "";
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for ${count} messages (got ${messages.length})`,
        ),
      );
    }, timeoutMs);

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          messages.push(line);
          if (messages.length >= count) {
            clearTimeout(timeout);
            resolve(messages);
          }
        }
      }
    });
  });
}

afterEach(() => {
  // Clean up sockets
  for (const socket of openSockets) {
    try {
      socket.destroy();
    } catch {
      // Ignore
    }
  }
  openSockets.length = 0;

  // Clean up server
  if (server) {
    server.close();
    server = null;
  }

  // Clean up temp dir
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IPC server", () => {
  test("creates server and accepts a client connection", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    expect(existsSync(socketPath)).toBe(true);
    expect(server.clientCount()).toBe(0);

    const client = await connectClient(socketPath);
    // Give the server a moment to register the connection
    await new Promise((r) => setTimeout(r, 50));

    expect(server.clientCount()).toBe(1);
    client.destroy();
  });

  test("broadcasts a message to a single client", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client = await connectClient(socketPath);
    const collecting = collectMessages(client, 1);

    const msg: OutputMessage = {
      type: "output",
      data: "hello world",
      stream: "stdout",
    };
    server.broadcast(msg);

    const messages = await collecting;
    expect(messages.length).toBe(1);
    expect(deserialize(messages[0]!)).toEqual(msg);
  });

  test("broadcasts to multiple clients simultaneously", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client1 = await connectClient(socketPath);
    const client2 = await connectClient(socketPath);
    const client3 = await connectClient(socketPath);

    await new Promise((r) => setTimeout(r, 50));
    expect(server.clientCount()).toBe(3);

    const collect1 = collectMessages(client1, 1);
    const collect2 = collectMessages(client2, 1);
    const collect3 = collectMessages(client3, 1);

    const msg: OutputMessage = {
      type: "output",
      data: "broadcast test",
      stream: "stderr",
    };
    server.broadcast(msg);

    const [msgs1, msgs2, msgs3] = await Promise.all([
      collect1,
      collect2,
      collect3,
    ]);

    expect(deserialize(msgs1[0]!)).toEqual(msg);
    expect(deserialize(msgs2[0]!)).toEqual(msg);
    expect(deserialize(msgs3[0]!)).toEqual(msg);
  });

  test("client disconnect does not affect other clients", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client1 = await connectClient(socketPath);
    const client2 = await connectClient(socketPath);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.clientCount()).toBe(2);

    // Disconnect client1
    client1.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.clientCount()).toBe(1);

    // client2 should still receive messages
    const collecting = collectMessages(client2, 1);
    const msg: OutputMessage = {
      type: "output",
      data: "after disconnect",
      stream: "stdout",
    };
    server.broadcast(msg);

    const messages = await collecting;
    expect(deserialize(messages[0]!)).toEqual(msg);
  });

  test("broadcasts multiple messages in sequence", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client = await connectClient(socketPath);
    const collecting = collectMessages(client, 3);

    const msgs: OutputMessage[] = [
      { type: "output", data: "first", stream: "stdout" },
      { type: "output", data: "second", stream: "stderr" },
      { type: "output", data: "third", stream: "stdout" },
    ];

    for (const msg of msgs) {
      server.broadcast(msg);
    }

    const received = await collecting;
    expect(received.length).toBe(3);
    expect(deserialize(received[0]!)).toEqual(msgs[0]!);
    expect(deserialize(received[1]!)).toEqual(msgs[1]!);
    expect(deserialize(received[2]!)).toEqual(msgs[2]!);
  });

  test("close removes the socket file", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);
    expect(existsSync(socketPath)).toBe(true);

    server.close();
    server = null;

    expect(existsSync(socketPath)).toBe(false);
  });

  test("close disconnects all clients", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client1 = await connectClient(socketPath);
    const client2 = await connectClient(socketPath);
    await new Promise((r) => setTimeout(r, 50));

    let client1Closed = false;
    let client2Closed = false;
    client1.on("close", () => {
      client1Closed = true;
    });
    client2.on("close", () => {
      client2Closed = true;
    });

    server.close();
    server = null;
    await new Promise((r) => setTimeout(r, 100));

    expect(client1Closed).toBe(true);
    expect(client2Closed).toBe(true);
  });

  test("removes stale socket file before listening", async () => {
    const socketPath = freshSocketPath();

    // Create a stale socket file
    const { writeFileSync } = await import("fs");
    writeFileSync(socketPath, "stale");
    expect(existsSync(socketPath)).toBe(true);

    // Server should start despite stale file
    server = await createIpcServer(socketPath);
    expect(existsSync(socketPath)).toBe(true);

    const client = await connectClient(socketPath);
    const collecting = collectMessages(client, 1);

    server.broadcast({ type: "output", data: "works", stream: "stdout" });
    const messages = await collecting;
    expect(messages.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Broadcasting non-output message types
// ---------------------------------------------------------------------------

describe("IPC server message type broadcasts", () => {
  test("broadcasts progress message to client", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client = await connectClient(socketPath);
    const collecting = collectMessages(client, 1);

    const msg: ProgressMessage = {
      type: "progress",
      iteration: 2,
      content: "- [x] Updated config\n- [x] Added tests",
    };
    server.broadcast(msg);

    const messages = await collecting;
    expect(messages.length).toBe(1);
    expect(deserialize(messages[0]!)).toEqual(msg);
  });

  test("broadcasts receipt message to client", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client = await connectClient(socketPath);
    const collecting = collectMessages(client, 1);

    const msg: ReceiptMessage = {
      type: "receipt",
      tasksCompleted: 5,
    };
    server.broadcast(msg);

    const messages = await collecting;
    expect(messages.length).toBe(1);
    expect(deserialize(messages[0]!)).toEqual(msg);
  });

  test("broadcasts complete message to client", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client = await connectClient(socketPath);
    const collecting = collectMessages(client, 1);

    const msg: CompleteMessage = {
      type: "complete",
      planSlug: "feat-auth-flow",
    };
    server.broadcast(msg);

    const messages = await collecting;
    expect(messages.length).toBe(1);
    expect(deserialize(messages[0]!)).toEqual(msg);
  });

  test("broadcasts mixed message types in sequence", async () => {
    const socketPath = freshSocketPath();
    server = await createIpcServer(socketPath);

    const client = await connectClient(socketPath);
    const collecting = collectMessages(client, 4);

    const msgs: IpcMessage[] = [
      { type: "output", data: "starting...", stream: "stdout" },
      { type: "progress", iteration: 1, content: "- [x] Done" },
      { type: "receipt", tasksCompleted: 1 },
      { type: "complete", planSlug: "my-plan" },
    ];

    for (const msg of msgs) {
      server.broadcast(msg);
    }

    const received = await collecting;
    expect(received.length).toBe(4);
    expect(deserialize(received[0]!)).toEqual(msgs[0]!);
    expect(deserialize(received[1]!)).toEqual(msgs[1]!);
    expect(deserialize(received[2]!)).toEqual(msgs[2]!);
    expect(deserialize(received[3]!)).toEqual(msgs[3]!);
  });
});
