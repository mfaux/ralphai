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
  console.log(`
${BOLD}Usage:${RESET} ralphai <command> [options]

${BOLD}Commands:${RESET}
  init           Set up Ralphai in your project (interactive wizard)
  run            Start the Ralphai task runner
  worktree       Create or reuse an isolated git worktree
  status         Show pipeline and worktree status
  reset          Move in-progress plans back to backlog and clean up
  update [tag]   Update ralphai to the latest (or specified) version
  uninstall      Remove Ralphai from your project

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Init Options:${RESET}
  --yes, -y              Skip prompts and use defaults
  --force                Re-scaffold from scratch (deletes existing .ralphai/)
  --shared               Track ralphai.json in git (for team-shared config)
  --agent-command=CMD    Set the agent command (default: opencode run --agent build)

${BOLD}Run Options:${RESET}
  All arguments after 'run' are forwarded directly to the task runner.

${BOLD}Worktree Options:${RESET}
  --plan=<file>     Target a specific backlog plan (default: auto-detect)
  --dir=<path>      Worktree directory (default: ../.ralphai-worktrees/<slug>)
  worktree list     Show active ralphai-managed worktrees
  worktree clean    Remove completed/orphaned worktrees

${BOLD}Reset Options:${RESET}
  --yes, -y         Skip confirmation prompt

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} ralphai init                  ${DIM}# interactive setup${RESET}
  ${DIM}$${RESET} ralphai init --yes             ${DIM}# setup with defaults${RESET}
  ${DIM}$${RESET} ralphai run                    ${DIM}# run with defaults (5 turns per plan)${RESET}
  ${DIM}$${RESET} ralphai run --turns=3          ${DIM}# 3 turns per plan${RESET}
  ${DIM}$${RESET} ralphai run --dry-run          ${DIM}# preview only${RESET}
  ${DIM}$${RESET} ralphai run --pr               ${DIM}# create branch and open PR${RESET}
  ${DIM}$${RESET} ralphai worktree               ${DIM}# run next plan in an isolated worktree${RESET}
  ${DIM}$${RESET} ralphai worktree --turns=3     ${DIM}# run in a worktree with 3 turns per plan${RESET}
  ${DIM}$${RESET} ralphai worktree list           ${DIM}# show active ralphai worktrees${RESET}
  ${DIM}$${RESET} ralphai worktree clean          ${DIM}# remove completed worktrees${RESET}
  ${DIM}$${RESET} ralphai status                 ${DIM}# show pipeline and worktree status${RESET}
  ${DIM}$${RESET} ralphai reset                  ${DIM}# move in-progress plans back to backlog${RESET}
  ${DIM}$${RESET} ralphai reset --yes            ${DIM}# reset without confirmation${RESET}
  ${DIM}$${RESET} ralphai update                 ${DIM}# update ralphai to latest${RESET}
  ${DIM}$${RESET} ralphai update beta            ${DIM}# install beta version${RESET}
  ${DIM}$${RESET} ralphai uninstall --yes        ${DIM}# remove ralphai${RESET}
`);
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
