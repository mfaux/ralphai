/**
 * Agent output log loading for the dashboard.
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
// Async loader
// ---------------------------------------------------------------------------

/**
 * Async version of loadOutputTail. Uses fs/promises to avoid blocking
 * on potentially large agent-output.log files.
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

  const { wipDir: inProgressDir, archiveDir } = dirs;

  let outputPath: string | null = null;
  if (plan.state === "in-progress") {
    outputPath = join(inProgressDir, plan.slug, "agent-output.log");
  } else if (plan.state === "completed") {
    outputPath = join(archiveDir, plan.slug, "agent-output.log");
  }

  if (!outputPath || !(await fileExists(outputPath))) return null;

  try {
    const raw = await readFile(outputPath, "utf-8");
    const lines = raw.split("\n");
    const totalLines = lines.length;

    const tail =
      totalLines > maxLines ? lines.slice(-maxLines).join("\n") : raw;

    return { content: tail, totalLines };
  } catch {
    return null;
  }
}
