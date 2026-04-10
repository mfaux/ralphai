import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import * as clack from "@clack/prompts";
import { RESET, DIM, TEXT } from "./utils.ts";
import {
  getRalphaiHome,
  getRepoPipelineDirs,
  resolveRepoStateDir,
  listPlanSlugs,
} from "./plan-lifecycle.ts";
import { getConfigFilePath } from "./config.ts";
import { detectInstallerPM } from "./self-update.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UninstallOptions {
  yes: boolean;
  global: boolean;
  cwd: string;
  env?: Record<string, string | undefined>;
}

interface PipelineWarning {
  repoId: string;
  backlogCount: number;
  inProgressCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan every repo under `<ralphaiHome>/repos/` and report any that still
 * have plans in the backlog or in-progress directories.
 */
function findPipelineWarnings(ralphaiHome: string): PipelineWarning[] {
  const reposDir = join(ralphaiHome, "repos");
  if (!existsSync(reposDir)) return [];

  const warnings: PipelineWarning[] = [];

  let entries: string[];
  try {
    entries = readdirSync(reposDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  for (const repoId of entries) {
    const backlogDir = join(reposDir, repoId, "pipeline", "backlog");
    const wipDir = join(reposDir, repoId, "pipeline", "in-progress");

    const backlogCount = listPlanSlugs(backlogDir, true).length;
    const inProgressCount = listPlanSlugs(wipDir).length;

    if (backlogCount > 0 || inProgressCount > 0) {
      warnings.push({ repoId, backlogCount, inProgressCount });
    }
  }

  return warnings;
}

function printWarnings(warnings: PipelineWarning[]): void {
  console.log(
    `${TEXT}Warning: active plans found in ${warnings.length} repo${warnings.length !== 1 ? "s" : ""}:${RESET}`,
  );
  for (const w of warnings) {
    const parts: string[] = [];
    if (w.backlogCount > 0) {
      parts.push(`${w.backlogCount} in backlog`);
    }
    if (w.inProgressCount > 0) {
      parts.push(`${w.inProgressCount} in progress`);
    }
    console.log(
      `  ${TEXT}${w.repoId}${RESET} ${DIM}(${parts.join(", ")})${RESET}`,
    );
  }
  console.log();
}

function buildUninstallCommand(
  pm: ReturnType<typeof detectInstallerPM>,
): string {
  switch (pm) {
    case "pnpm":
      return "pnpm remove -g ralphai";
    case "yarn":
      return "yarn global remove ralphai";
    case "bun":
      return "bun remove -g ralphai";
    case "npm":
      return "npm uninstall -g ralphai";
  }
}

// ---------------------------------------------------------------------------
// Repo-scoped uninstall (default — no --global)
// ---------------------------------------------------------------------------

async function runRepoUninstall(options: UninstallOptions): Promise<void> {
  const configPath = getConfigFilePath(options.cwd, options.env);
  if (!existsSync(configPath)) {
    console.log(
      `${TEXT}Ralphai is not set up in this project (no config found).${RESET}`,
    );
    return;
  }

  const stateDir = resolveRepoStateDir(options.cwd, options.env);

  if (!options.yes) {
    clack.intro("Uninstall Ralphai");
    const confirmed = await clack.confirm({
      message:
        "This will permanently delete the global state for this repo. " +
        "Any plans will be lost. Continue?",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Uninstall cancelled.");
      return;
    }
  }

  // Remove global state directory for this repo
  rmSync(stateDir, { recursive: true, force: true, maxRetries: 5 });

  console.log(`${TEXT}Ralphai torn down.${RESET}`);
  console.log();
  console.log(`${DIM}Removed:${RESET}`);
  console.log(`  ${stateDir}  ${DIM}Global state${RESET}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Global uninstall (--global)
// ---------------------------------------------------------------------------

async function runGlobalUninstall(options: UninstallOptions): Promise<void> {
  const ralphaiHome = getRalphaiHome(options.env);
  const homeExists = existsSync(ralphaiHome);

  // Check for active plans across all repos
  const warnings = homeExists ? findPipelineWarnings(ralphaiHome) : [];

  if (!options.yes) {
    clack.intro("Uninstall Ralphai");

    // Show plan warnings before asking for confirmation
    if (warnings.length > 0) {
      console.log();
      printWarnings(warnings);
    }

    const confirmed = await clack.confirm({
      message: homeExists
        ? `This will permanently delete ${ralphaiHome} and all repo state. Continue?`
        : "Uninstall ralphai?",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Uninstall cancelled.");
      return;
    }
  } else if (warnings.length > 0) {
    // Even in --yes mode, print warnings so they're visible in logs
    printWarnings(warnings);
  }

  // 1. Remove ~/.ralphai (global state for all repos)
  if (homeExists) {
    rmSync(ralphaiHome, { recursive: true, force: true, maxRetries: 5 });
    console.log(`${TEXT}Removed ${ralphaiHome}${RESET}`);
  } else {
    console.log(
      `${DIM}No global state directory found (${ralphaiHome})${RESET}`,
    );
  }

  // 2. Detect package manager and print uninstall command
  const pm = detectInstallerPM();
  const uninstallCmd = buildUninstallCommand(pm);

  console.log();
  console.log(
    `${TEXT}Global state removed. To finish uninstalling, run:${RESET}`,
  );
  console.log();
  console.log(`  ${TEXT}${uninstallCmd}${RESET}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runUninstall(options: UninstallOptions): Promise<void> {
  if (options.global) {
    await runGlobalUninstall(options);
  } else {
    await runRepoUninstall(options);
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function showUninstallHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai uninstall [options]`);
  console.log();
  console.log(
    `${DIM}Remove Ralphai from the current project (repo-scoped by default).${RESET}`,
  );
  console.log();
  console.log(
    `${DIM}By default, removes only this repo's state directory. Use --global${RESET}`,
  );
  console.log(
    `${DIM}to remove ~/.ralphai (or $RALPHAI_HOME) and all repo state.${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--global${RESET}    ${DIM}Remove all global state and show how to uninstall the CLI${RESET}`,
  );
  console.log(
    `  ${TEXT}--yes, -y${RESET}   ${DIM}Skip confirmation prompt${RESET}`,
  );
}
