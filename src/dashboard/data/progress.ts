/**
 * Progress content loading for the dashboard.
 */

import { existsSync, readFileSync } from "fs";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { getRepoPipelineDirs } from "../../global-state.ts";
import type { PlanInfo } from "../types.ts";
import { fileExists, getCachedPipelineDirs } from "./shared.ts";

// ---------------------------------------------------------------------------
// Sync loader
// ---------------------------------------------------------------------------

/** Read progress.md for a plan. */
export function loadProgressContent(
  cwd: string,
  plan: PlanInfo,
): string | null {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getRepoPipelineDirs(cwd);
  } catch {
    return null;
  }

  const { wipDir: inProgressDir, archiveDir } = dirs;

  let progressPath: string | null = null;
  if (plan.state === "in-progress") {
    progressPath = join(inProgressDir, plan.slug, "progress.md");
  } else if (plan.state === "completed") {
    progressPath = join(archiveDir, plan.slug, "progress.md");
  }

  if (!progressPath || !existsSync(progressPath)) return null;

  try {
    return readFileSync(progressPath, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Async loader
// ---------------------------------------------------------------------------

/**
 * Async version of loadProgressContent. Uses fs/promises.readFile
 * instead of readFileSync.
 */
export async function loadProgressContentAsync(
  cwd: string,
  plan: PlanInfo,
): Promise<string | null> {
  let dirs: ReturnType<typeof getRepoPipelineDirs>;
  try {
    dirs = getCachedPipelineDirs(cwd);
  } catch {
    return null;
  }

  const { wipDir: inProgressDir, archiveDir } = dirs;

  let progressPath: string | null = null;
  if (plan.state === "in-progress") {
    progressPath = join(inProgressDir, plan.slug, "progress.md");
  } else if (plan.state === "completed") {
    progressPath = join(archiveDir, plan.slug, "progress.md");
  }

  if (!progressPath || !(await fileExists(progressPath))) return null;

  try {
    return await readFile(progressPath, "utf-8");
  } catch {
    return null;
  }
}
