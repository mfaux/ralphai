/**
 * Agent output log loading for the dashboard.
 */

import { existsSync, readFileSync } from "fs";
import { open } from "node:fs/promises";
import { join } from "path";
import { getRepoPipelineDirs } from "../../global-state.ts";
import type { PlanInfo } from "../types.ts";
import { getCachedPipelineDirs } from "./shared.ts";

/** Chunk size for backward seeking (64 KiB). */
const CHUNK_SIZE = 64 * 1024;

// ---------------------------------------------------------------------------
// Sync loader
// ---------------------------------------------------------------------------

/**
 * Read the last `maxLines` of agent-output.log for a plan.
 * Returns null if the file does not exist.
 */
export function loadOutputTail(
  cwd: string,
  plan: PlanInfo,
  maxLines = 200,
): { content: string; totalLines: number } | null {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getRepoPipelineDirs(cwd);
  } catch {
    return null;
  }

  const { wipDir: inProgressDir, archiveDir } = dirs;

  let outputPath: string | null = null;
  if (plan.state === "in-progress") {
    outputPath = join(inProgressDir, plan.slug, "agent-output.log");
  } else if (plan.state === "completed") {
    outputPath = join(archiveDir, plan.slug, "agent-output.log");
  }

  if (!outputPath || !existsSync(outputPath)) return null;

  try {
    const raw = readFileSync(outputPath, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;

    const tail =
      totalLines > maxLines ? lines.slice(-maxLines).join("\n") : raw;

    return { content: tail, totalLines };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Async loader — byte-offset seeking
// ---------------------------------------------------------------------------

/**
 * Resolve the output log path for a plan, or null if not applicable.
 */
function resolveOutputPath(
  dirs: { wipDir: string; archiveDir: string },
  plan: PlanInfo,
): string | null {
  if (plan.state === "in-progress") {
    return join(dirs.wipDir, plan.slug, "agent-output.log");
  }
  if (plan.state === "completed") {
    return join(dirs.archiveDir, plan.slug, "agent-output.log");
  }
  return null;
}

/**
 * Count newline bytes in the portion of the file before `tailStartOffset`.
 * Reads forward in chunks to avoid loading the entire prefix into memory.
 */
async function countNewlinesInPrefix(
  fh: import("node:fs/promises").FileHandle,
  tailStartOffset: number,
): Promise<number> {
  let count = 0;
  const buf = Buffer.allocUnsafe(CHUNK_SIZE);
  let pos = 0;
  while (pos < tailStartOffset) {
    const toRead = Math.min(CHUNK_SIZE, tailStartOffset - pos);
    const { bytesRead } = await fh.read(buf, 0, toRead, pos);
    if (bytesRead === 0) break;
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0x0a) count++;
    }
    pos += bytesRead;
  }
  return count;
}

/**
 * Async version of loadOutputTail. Uses file handle seeking to read only
 * the tail of the file, avoiding loading the entire contents into memory.
 *
 * Approach: open the file, stat for size, seek backwards in chunks until
 * enough newlines are found, then return the tail content and total line
 * count (computed by counting newlines in the unread prefix separately).
 */
export async function loadOutputTailAsync(
  cwd: string,
  plan: PlanInfo,
  maxLines = 200,
): Promise<{ content: string; totalLines: number } | null> {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getCachedPipelineDirs(cwd);
  } catch {
    return null;
  }

  const outputPath = resolveOutputPath(dirs, plan);
  if (!outputPath) return null;

  let fh: import("node:fs/promises").FileHandle;
  try {
    fh = await open(outputPath, "r");
  } catch {
    return null;
  }

  try {
    const stat = await fh.stat();
    const fileSize = stat.size;

    // Empty file
    if (fileSize === 0) {
      return { content: "", totalLines: 1 };
    }

    // -----------------------------------------------------------------
    // Read backwards from EOF to find the byte offset where the tail
    // (last maxLines lines) begins.
    // -----------------------------------------------------------------
    let newlineCount = 0;
    let readPos = fileSize; // byte position we're about to read back from
    let tailStartOffset = 0; // byte offset where the tail content begins
    let reachedBOF = false;
    const buf = Buffer.allocUnsafe(CHUNK_SIZE);

    while (readPos > 0) {
      const chunkLen = Math.min(CHUNK_SIZE, readPos);
      readPos -= chunkLen;
      const { bytesRead } = await fh.read(buf, 0, chunkLen, readPos);

      // Scan from end of chunk toward beginning
      for (let i = bytesRead - 1; i >= 0; i--) {
        if (buf[i] === 0x0a) {
          newlineCount++;
          // We need maxLines *lines*, which means maxLines newlines
          // give us maxLines+1 segments. But the original implementation
          // uses split("\n") which counts the segment after the last \n
          // as a line too. We need maxLines newlines to delimit maxLines
          // lines (the tail starts just after this newline).
          if (newlineCount === maxLines) {
            tailStartOffset = readPos + i + 1;
            break;
          }
        }
      }

      if (newlineCount >= maxLines) break;

      if (readPos === 0) {
        reachedBOF = true;
      }
    }

    // If we reached BOF without finding enough newlines, the entire file
    // is the tail.
    if (reachedBOF && newlineCount < maxLines) {
      tailStartOffset = 0;
    }

    // -----------------------------------------------------------------
    // Read the tail content
    // -----------------------------------------------------------------
    const tailSize = fileSize - tailStartOffset;
    const tailBuf = Buffer.allocUnsafe(tailSize);
    await fh.read(tailBuf, 0, tailSize, tailStartOffset);
    const content = tailBuf.toString("utf-8");

    // -----------------------------------------------------------------
    // Compute totalLines: newlines in the tail content are already known
    // from backward scan (or can be derived from content). For accuracy,
    // count from the content directly, plus newlines in the prefix.
    // -----------------------------------------------------------------
    let tailNewlines = 0;
    for (let i = 0; i < tailBuf.length; i++) {
      if (tailBuf[i] === 0x0a) tailNewlines++;
    }

    // totalLines = segments from split("\n") = newline_count + 1
    // for the entire file.
    let prefixNewlines = 0;
    if (tailStartOffset > 0) {
      prefixNewlines = await countNewlinesInPrefix(fh, tailStartOffset);
    }
    const totalLines = prefixNewlines + tailNewlines + 1;

    return { content, totalLines };
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}
