#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runRalphai } from "./ralphai.ts";
import type { MenuContext } from "./tui/menu-items.ts";
import { resolveConfig, DEFAULTS } from "./config.ts";
import type { ResolvedConfig } from "./config.ts";
import { peekGithubIssues, peekPrdIssues } from "./issues.ts";
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

${BOLD}Core${RESET}
  run          Run a plan in an isolated worktree (or 'run <issue>' / 'run <plan.md>')
  status       Show pipeline status (auto-refreshes in terminal)

${BOLD}Management${RESET}
  clean        Remove archived plans and orphaned worktrees
  config       Query resolved configuration

${BOLD}Setup & Maintenance${RESET}
  init         Set up Ralphai in your project (interactive wizard)
  update       Update ralphai to the latest (or specified) version
  uninstall    Remove Ralphai from this project (or --global to uninstall)
  doctor       Check your ralphai setup for problems

${BOLD}Plumbing${RESET}
  stop         Stop running plan(s)
  reset        Move in-progress plans back to backlog and clean up
  repos        List all known repos with pipeline summaries
  seed         Create a sample plan in the backlog

${BOLD}Options:${RESET}
  --help, -h      Show this help message
  --version, -v   Show version number
  --no-color      Disable colored output (also: NO_COLOR env var)

Run ${TEXT}'ralphai <command> --help'${RESET} for command-specific options.

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} ralphai               ${DIM}# open interactive menu${RESET}
  ${DIM}$${RESET} ralphai init          ${DIM}# set up your project${RESET}
  ${DIM}$${RESET} ralphai run           ${DIM}# auto-detect work and run${RESET}
  ${DIM}$${RESET} ralphai run 42        ${DIM}# fetch issue #42, create branch, run${RESET}
  ${DIM}$${RESET} ralphai run plan.md   ${DIM}# run a specific plan file${RESET}`);
}

// ---------------------------------------------------------------------------
// TUI helpers
// ---------------------------------------------------------------------------

/**
 * Build the MenuContext needed by the TUI main menu.
 *
 * Resolves config, peeks at GitHub issues, and assembles the context.
 * Errors in config resolution are swallowed — the menu proceeds with
 * defaults.
 */
function buildMenuContext(cwd: string): {
  menuContext: MenuContext;
  resolvedConfig: ResolvedConfig | undefined;
} {
  let hasGitHubIssues = false;
  let standaloneLabel = DEFAULTS.standaloneLabel;
  let issuePrdLabel = DEFAULTS.prdLabel;
  let issueRepo = "";
  let resolvedConfig: ResolvedConfig | undefined;

  try {
    const { config } = resolveConfig({
      cwd,
      envVars: process.env,
      cliArgs: [],
    });
    resolvedConfig = config;
    hasGitHubIssues = config.issueSource.value === "github";
    standaloneLabel = config.standaloneLabel.value;
    issuePrdLabel = config.prdLabel.value;
    issueRepo = config.issueRepo.value;
  } catch {
    // Config resolution failure — proceed with defaults
  }

  // Peek at GitHub issue count (for menu item labels)
  let githubIssueCount: number | undefined;
  if (hasGitHubIssues) {
    const regularPeek = peekGithubIssues({
      cwd,
      issueSource: "github",
      standaloneLabel,
      issueRepo,
      issuePrdLabel,
    });
    const prdPeek = peekPrdIssues({
      cwd,
      issueSource: "github",
      standaloneLabel,
      issueRepo,
      issuePrdLabel,
    });
    githubIssueCount = (regularPeek.count || 0) + (prdPeek.count || 0);
  }

  const menuContext: MenuContext = {
    hasGitHubIssues,
    githubIssueCount,
    githubConfig: hasGitHubIssues
      ? { cwd, standaloneLabel, issueRepo, issuePrdLabel }
      : undefined,
    resolvedConfig,
  };

  return { menuContext, resolvedConfig };
}

/**
 * Run the TUI loop.
 *
 * Renders the TUI main menu and handles results:
 * - "run" → dispatch to runRalphai and exit
 * - "dispatch" → run command and re-enter TUI (e.g., view-status, settings)
 * - "quit" → exit
 */
async function runTuiLoop(cwd: string): Promise<void> {
  // Dynamic imports — keeps .tsx out of the module graph for Node
  // subprocess tests that use --experimental-strip-types.
  const React = (await import("react")).default;
  const { renderTui, TuiRouter } = await import("./tui/app.tsx");
  type TuiResult = import("./tui/app.tsx").TuiResult;

  while (true) {
    // Build fresh context each iteration so state is always current
    const { menuContext, resolvedConfig } = buildMenuContext(cwd);

    // Use a fallback config for the wizard if config resolution failed
    const wizardConfig: ResolvedConfig =
      resolvedConfig ?? buildFallbackConfig();

    const result: TuiResult = await renderTui(
      React.createElement(TuiRouter, {
        initialScreen: { tag: "menu", cwd, menuContext },
        config: wizardConfig,
      }),
    );

    switch (result.action) {
      case "quit":
        return;

      case "run":
        await runRalphai(result.args);
        return;

      case "dispatch":
        // Run the command and return to the TUI menu
        await runRalphai(result.args);
        continue;
    }
  }
}

/**
 * Build a minimal fallback ResolvedConfig when config resolution fails.
 *
 * Every key uses the default value with source "default".
 */
function buildFallbackConfig(): ResolvedConfig {
  const config: Record<string, { value: unknown; source: string }> = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    config[key] = { value, source: "default" };
  }
  return config as unknown as ResolvedConfig;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
    // Interactive menu when running in a TTY
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
          // After init completes, proceed to interactive menu
        } else {
          // User declined init — fall through to interactive menu
        }
      }

      await runTuiLoop(process.cwd());
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
  // Skip after global uninstall — the cache dir would re-create ~/.ralphai.
  const isGlobalUninstall =
    args[0] === "uninstall" && args.includes("--global");
  if (!process.env.RALPHAI_NO_UPDATE_CHECK && !isGlobalUninstall) {
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
