/**
 * Shared async helpers and caching for dashboard data loading.
 */

import { access } from "node:fs/promises";
import { exec } from "node:child_process";
import { getRepoPipelineDirs } from "../../global-state.ts";

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

/** Promise-based check for file/dir existence. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Promise-based exec with string result. */
export function execAsync(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, encoding: "utf-8" }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Yield to the event loop. Insert between batches of synchronous work
 * so spinner intervals and keyboard events can fire.
 */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Pipeline directory cache
// ---------------------------------------------------------------------------

/**
 * Cached pipeline dirs by cwd. The directory paths never change during a
 * dashboard session, so we call getRepoPipelineDirs once per repo and
 * reuse the result. This avoids repeated mkdirSync / existsSync calls
 * on every 3-second poll cycle (5 loaders x 3 dir checks = 15 syscalls).
 */
export const pipelineDirsCache = new Map<
  string,
  ReturnType<typeof getRepoPipelineDirs>
>();

export function getCachedPipelineDirs(
  cwd: string,
): ReturnType<typeof getRepoPipelineDirs> {
  let cached = pipelineDirsCache.get(cwd);
  if (!cached) {
    cached = getRepoPipelineDirs(cwd);
    pipelineDirsCache.set(cwd, cached);
  }
  return cached;
}
