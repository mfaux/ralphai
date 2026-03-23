#!/usr/bin/env node

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runRalphai } from "./ralphai.ts";
import { RESET, BOLD, DIM, TEXT } from "./utils.ts";
import { checkForUpdate, spawnUpdateCheck } from "./self-update.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  run          Start the Ralphai task runner
  worktree     Run in an isolated git worktree
  status       Show pipeline and worktree status
  reset        Move in-progress plans back to backlog and clean up
  purge        Delete archived artifacts from pipeline/out/
  update       Update ralphai to the latest (or specified) version
  teardown     Remove Ralphai from your project
  doctor       Check your ralphai setup for problems
  backlog-dir  Print the path to the plan backlog directory

${BOLD}Options:${RESET}
  --help, -h      Show this help message
  --version, -v   Show version number
  --no-color      Disable colored output (also: NO_COLOR env var)

Run ${TEXT}'ralphai <command> --help'${RESET} for command-specific options.

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} ralphai init          ${DIM}# set up your project${RESET}
  ${DIM}$${RESET} ralphai run           ${DIM}# run the next plan${RESET}
  ${DIM}$${RESET} ralphai run --pr      ${DIM}# run and open a PR${RESET}`);
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
    console.log(`${TEXT}ralphai${RESET} ${DIM}v${getVersion()}${RESET}`);
    console.log();
    showHelp();
    return;
  }

  // Dispatch directly to runRalphai — args are already the subcommands
  await runRalphai(args);

  // Update notification (after command completes, so it doesn't interfere)
  if (!process.env.RALPHAI_NO_UPDATE_CHECK) {
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
