/**
 * IPC server for the runner side.
 *
 * Encapsulates a `net.Server` behind a simple interface:
 * - `create(socketPath)` — start listening on the given socket path
 * - `broadcast(msg)` — send a message to all connected clients
 * - `close()` — stop listening and clean up the socket file
 *
 * The server:
 * - Accepts multiple simultaneous client connections
 * - Calls `server.unref()` so it does not prevent the runner from exiting
 * - Removes the `.sock` file on close
 * - Removes any stale `.sock` file before listening (crash recovery)
 */

import { createServer, type Server, type Socket } from "net";
import { rmSync } from "fs";
import { serialize, type IpcMessage } from "./ipc-protocol.ts";

export interface IpcServer {
  /** Send a message to all connected clients. */
  broadcast(msg: IpcMessage): void;
  /** Stop listening and clean up. */
  close(): void;
  /** Number of currently connected clients. */
  clientCount(): number;
}

/**
 * Create and start an IPC server on the given socket path.
 *
 * Returns a promise that resolves with the server interface once listening,
 * or rejects if the server fails to start.
 */
export function createIpcServer(socketPath: string): Promise<IpcServer> {
  return new Promise((resolve, reject) => {
    // Remove stale socket file (e.g., from a previous crash)
    try {
      rmSync(socketPath, { force: true });
    } catch {
      // Ignore — file may not exist
    }

    const clients = new Set<Socket>();
    const server: Server = createServer((socket) => {
      clients.add(socket);
      socket.on("close", () => {
        clients.delete(socket);
      });
      socket.on("error", () => {
        clients.delete(socket);
      });
    });

    // Don't prevent the runner from exiting
    server.unref();

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(socketPath, () => {
      resolve({
        broadcast(msg: IpcMessage): void {
          const data = serialize(msg);
          for (const socket of clients) {
            try {
              socket.write(data);
            } catch {
              // Client disconnected — will be cleaned up by close event
            }
          }
        },

        close(): void {
          // Close all client connections
          for (const socket of clients) {
            try {
              socket.destroy();
            } catch {
              // Ignore errors during cleanup
            }
          }
          clients.clear();

          // Close the server
          server.close();

          // Remove the socket file
          try {
            rmSync(socketPath, { force: true });
          } catch {
            // Best-effort cleanup
          }
        },

        clientCount(): number {
          return clients.size;
        },
      });
    });
  });
}
