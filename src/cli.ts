#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runRalphai, runRalphaiStatus } from "./ralphai.ts";
import { RESET, BOLD, DIM, TEXT } from "./utils.ts";
import { checkForUpdate, spawnUpdateCheck } from "./self-update.ts";
import { getConfigFilePath } from "./config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Quick check: is the cwd inside a git repo? */
function isInsideGitRepoQuick(): boolean {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function showHelp(): void {
  console.log(`${BOLD}Usage:${RESET} ralphai <command> [options]

${BOLD}Commands:${RESET}
  init         Set up Ralphai in your project (interactive wizard)
  run          Create or reuse a worktree and run a plan
  prd          Run a PRD issue in continuous mode (shorthand for run)
  worktree     Manage ralphai git worktrees
  status       Show pipeline status (auto-refreshes in terminal)
  stop         Stop running plan(s)
  reset        Move in-progress plans back to backlog and clean up
  purge        Delete archived artifacts from pipeline/out/
  update       Update ralphai to the latest (or specified) version
  teardown     Remove Ralphai from your project
  uninstall    Remove all global state and uninstall the CLI
  doctor       Check your ralphai setup for problems
  check        Verify whether ralphai is configured for a repo
  backlog-dir  Print the path to the plan backlog directory
  repos        List all known repos with pipeline summaries

${BOLD}Options:${RESET}
  --help, -h      Show this help message
  --version, -v   Show version number
  --no-color      Disable colored output (also: NO_COLOR env var)

Run ${TEXT}'ralphai <command> --help'${RESET} for command-specific options.

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} ralphai               ${DIM}# show pipeline status (auto-refreshes in terminal)${RESET}
  ${DIM}$${RESET} ralphai init          ${DIM}# set up your project${RESET}
  ${DIM}$${RESET} ralphai run           ${DIM}# run the next plan headlessly${RESET}
  ${DIM}$${RESET} ralphai worktree list ${DIM}# show active worktrees${RESET}
  ${DIM}$${RESET} ralphai worktree clean ${DIM}# remove completed worktrees${RESET}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle top-level flags before dispatching to runRalph
  if (args.includes("--version") || args.includes("-v")) {
    console.log(getVersion());
    return;
  }

  // Only show top-level help if --help is before any subcommand or is the only arg.
  // Subcommands like `worktree --help` should be handled by the subcommand.
  const firstNonFlag = args.find((a) => !a.startsWith("-"));
  const helpRequested = args.includes("--help") || args.includes("-h");
  if (helpRequested && !firstNonFlag) {
    showHelp();
    return;
  }

  if (args.length === 0) {
    // Show pipeline status when no subcommand is given
    if (process.stdout.isTTY && process.stdin.isTTY) {
      // Nudge init if we're in an un-initialized git repo
      if (
        isInsideGitRepoQuick() &&
        !existsSync(getConfigFilePath(process.cwd()))
      ) {
        const clack = await import("@clack/prompts");
        console.log(`${TEXT}ralphai${RESET} ${DIM}v${getVersion()}${RESET}`);
        console.log();
        const shouldInit = await clack.confirm({
          message: "This repo isn't set up yet. Run ralphai init?",
        });

        if (clack.isCancel(shouldInit)) {
          return;
        }

        if (shouldInit) {
          await runRalphai(["init"]);
          return;
        }
        // User declined — fall through to status
      }

      runRalphaiStatus({ cwd: process.cwd() });
      return;
    }
    // Non-interactive: show help text
    console.log(`${TEXT}ralphai${RESET} ${DIM}v${getVersion()}${RESET}`);
    console.log();
    showHelp();
    return;
  }

  // Dispatch directly to runRalphai — args are already the subcommands
  await runRalphai(args);

  // Update notification (after command completes, so it doesn't interfere).
  // Skip after uninstall — the cache dir would re-create ~/.ralphai.
  const isUninstall = args[0] === "uninstall";
  if (!process.env.RALPHAI_NO_UPDATE_CHECK && !isUninstall) {
    const currentVersion = getVersion();
    const update = checkForUpdate("ralphai", currentVersion);
    if (update) {
      console.log(
        `  ${DIM}Update available: ${update.current} \u2192 ${BOLD}${update.latest}${RESET}`,
      );
      console.log(
        `  ${DIM}Run ${TEXT}ralphai update${RESET}${DIM} to upgrade${RESET}`,
      );
      console.log();
    }
    spawnUpdateCheck("ralphai");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
