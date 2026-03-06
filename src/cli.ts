#!/usr/bin/env node

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runRalphai } from "./ralphai.ts";
import { RESET, BOLD, DIM, TEXT } from "./utils.ts";

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
  init        Set up Ralphai in your project (interactive wizard)
  run         Start the Ralphai task runner
  update      Refresh Ralphai template files (preserves config & state)
  uninstall   Remove Ralphai from your project

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Init Options:${RESET}
  --yes, -y              Skip prompts and use defaults
  --force                Re-scaffold from scratch (deletes existing .ralphai/)
  --agent-command=CMD    Set the agent command (default: opencode run --agent build)

${BOLD}Run Options:${RESET}
  (no args)              Run with defaults (5 iterations per plan)
  -- <args>              Override: pass arguments directly to ralphai.sh

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} npx ralphai init                  ${DIM}# interactive setup${RESET}
  ${DIM}$${RESET} npx ralphai init --yes             ${DIM}# setup with defaults${RESET}
  ${DIM}$${RESET} npx ralphai run                    ${DIM}# run with defaults (5 iterations per plan)${RESET}
  ${DIM}$${RESET} npx ralphai run -- 5               ${DIM}# override: 5 iterations per plan${RESET}
  ${DIM}$${RESET} npx ralphai run -- --dry-run       ${DIM}# preview only${RESET}
  ${DIM}$${RESET} npx ralphai update --yes           ${DIM}# update templates${RESET}
  ${DIM}$${RESET} npx ralphai uninstall --yes        ${DIM}# remove ralphai${RESET}
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle top-level flags before dispatching to runRalph
  if (args.includes("--version") || args.includes("-v")) {
    console.log(getVersion());
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
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
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
