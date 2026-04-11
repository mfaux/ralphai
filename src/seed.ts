import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { RESET, DIM, TEXT } from "./utils.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";
import { getConfigFilePath } from "./config.ts";

// ---------------------------------------------------------------------------
// Sample plan content
// ---------------------------------------------------------------------------

/** Content for the hello-world sample plan. Used by `init` and `seed`. */
export const HELLO_WORLD_PLAN = loadSamplePlan("hello-world.md");

export const HELLO_WORLD_SLUG = "hello-world";

function loadSamplePlan(filename: string): string {
  const candidates = [
    new URL(`./sample-plans/${filename}`, import.meta.url),
    new URL(`../src/sample-plans/${filename}`, import.meta.url),
    // When bundled into dist/_chunks/, go up two levels to reach repo root.
    new URL(`../../src/sample-plans/${filename}`, import.meta.url),
  ];

  for (const url of candidates) {
    try {
      return readFileSync(url, "utf-8");
    } catch {
      continue;
    }
  }

  throw new Error(`Missing sample plan: ${filename}`);
}

// ---------------------------------------------------------------------------
// Seed & backlog-dir commands
// ---------------------------------------------------------------------------

export function runBacklogDir(cwd: string): void {
  const configPath = getConfigFilePath(cwd);
  if (!existsSync(configPath)) {
    console.log(
      `${TEXT}Ralphai is not set up in this project (no config found).${RESET}`,
    );
    console.log(`${DIM}Run ${TEXT}ralphai init${DIM} first.${RESET}`);
    return;
  }
  const { backlogDir } = getRepoPipelineDirs(cwd);
  console.log(backlogDir);
}

export function runSeed(cwd: string): void {
  const configPath = getConfigFilePath(cwd);
  if (!existsSync(configPath)) {
    console.log(
      `${TEXT}Ralphai is not set up in this project (no config found).${RESET}`,
    );
    console.log(`${DIM}Run ${TEXT}ralphai init${DIM} first.${RESET}`);
    return;
  }

  const {
    backlogDir,
    wipDir: inProgressDir,
    archiveDir,
  } = getRepoPipelineDirs(cwd);

  // Abort if a runner is actively executing the plan
  const ipSlugDir = join(inProgressDir, HELLO_WORLD_SLUG);
  const pidPath = join(ipSlugDir, "runner.pid");
  if (existsSync(pidPath)) {
    const raw = readFileSync(pidPath, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        // Process is alive — abort
        console.log(
          `${TEXT}Cannot seed: a runner is actively executing ${HELLO_WORLD_SLUG} (PID ${pid}).${RESET}`,
        );
        console.log(`${DIM}Stop the runner first, then retry.${RESET}`);
        return;
      } catch {
        // Process is gone — stale PID file, safe to continue
      }
    }
  }

  // Clean up any existing hello-world artifacts
  const cleaned: string[] = [];

  if (existsSync(ipSlugDir)) {
    rmSync(ipSlugDir, { recursive: true, force: true });
    cleaned.push("in-progress");
  }

  const archiveSlugDir = join(archiveDir, HELLO_WORLD_SLUG);
  if (existsSync(archiveSlugDir)) {
    rmSync(archiveSlugDir, { recursive: true, force: true });
    cleaned.push("archive");
  }

  const backlogFile = join(backlogDir, `${HELLO_WORLD_SLUG}.md`);
  if (existsSync(backlogFile)) {
    rmSync(backlogFile, { force: true });
    cleaned.push("backlog");
  }

  // Write fresh plan to backlog
  mkdirSync(backlogDir, { recursive: true });
  writeFileSync(backlogFile, HELLO_WORLD_PLAN);

  if (cleaned.length > 0) {
    console.log(
      `${TEXT}Cleaned ${HELLO_WORLD_SLUG} from: ${cleaned.join(", ")}${RESET}`,
    );
  }
  console.log(`${TEXT}Seeded ${HELLO_WORLD_SLUG} into backlog.${RESET}`);
}
