/**
 * IPC protocol for real-time communication between the runner and CLI clients.
 *
 * Uses newline-delimited JSON over Unix domain sockets (or named pipes on
 * Windows). Each line is a complete JSON object with a `type` discriminator.
 *
 * Four message types:
 * - `output`   — agent stdout/stderr chunk
 * - `progress` — iteration progress block extracted from agent output
 * - `receipt`  — updated tasks-completed count after receipt update
 * - `complete` — plan completed notification
 */

import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** Agent stdout/stderr output chunk. */
export interface OutputMessage {
  type: "output";
  /** The raw text chunk from the agent. */
  data: string;
  /** Which stream the chunk came from. */
  stream: "stdout" | "stderr";
}

/** Progress block extracted from agent output after an iteration. */
export interface ProgressMessage {
  type: "progress";
  /** The iteration number that produced this progress block. */
  iteration: number;
  /** The extracted progress content (markdown text). */
  content: string;
}

/** Updated tasks-completed count after a receipt update. */
export interface ReceiptMessage {
  type: "receipt";
  /** Number of tasks completed so far. */
  tasksCompleted: number;
}

/** Plan completion notification, broadcast before the IPC server closes. */
export interface CompleteMessage {
  type: "complete";
  /** The plan slug that completed. */
  planSlug: string;
}

/** Union of all IPC message types. */
export type IpcMessage =
  | OutputMessage
  | ProgressMessage
  | ReceiptMessage
  | CompleteMessage;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an IPC message to a newline-delimited JSON string.
 * The returned string always ends with a newline.
 */
export function serialize(msg: IpcMessage): string {
  return JSON.stringify(msg) + "\n";
}

/**
 * Deserialize a single line of newline-delimited JSON into an IPC message.
 * Returns `null` if the line is empty or cannot be parsed.
 *
 * Does NOT validate the message shape beyond JSON parsing and checking for
 * a `type` field — callers should handle unknown types gracefully.
 */
export function deserialize(line: string): IpcMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const obj = JSON.parse(trimmed);
    if (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.type === "string"
    ) {
      return obj as IpcMessage;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Socket path resolution
// ---------------------------------------------------------------------------

/**
 * Maximum safe socket path length in bytes.
 *
 * Linux `sun_path` is 108 bytes (including null terminator → 107 usable).
 * macOS `sun_path` is 104 bytes (including null terminator → 103 usable).
 * We use 103 as the safe cross-platform limit.
 */
const MAX_SOCKET_PATH_BYTES = 103;

/**
 * Compute the IPC socket path for a plan.
 *
 * Preferred layout: `<wipDir>/<slug>/runner.sock`
 * (co-located with `runner.pid` and other plan artifacts).
 *
 * When the preferred path exceeds the Unix domain socket path length limit
 * (104 bytes on macOS, 108 on Linux), falls back to a deterministic
 * temp-directory path: `<tmpdir>/ralphai-<hash>.sock`.
 *
 * On Windows, named pipes have no path length restriction, so the
 * preferred path is always used.
 */
export function getSocketPath(wipDir: string, slug: string): string {
  const preferred = join(wipDir, slug, "runner.sock");

  if (process.platform === "win32") return preferred;

  if (Buffer.byteLength(preferred, "utf8") <= MAX_SOCKET_PATH_BYTES) {
    return preferred;
  }

  // Deterministic hash so both server and client resolve the same path.
  const hash = createHash("sha256")
    .update(preferred)
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), `ralphai-${hash}.sock`);
}
